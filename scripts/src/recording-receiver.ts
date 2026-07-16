import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

type ReceiverConfig = {
  host: string;
  port: number;
  recordingsRoot: string;
  maxUploadBytes: number;
  uniqueNameAttempts: number;
  uploadFileMode: number;
  healthPath: string;
  recordingsPath: string;
  notesListPath: string;
  noteDaysPath: string;
  featuredNotePath: string;
  noteStatusPath: string;
  featuredRecordingRelativePath: string;
  featuredRecordingLocationLabel: string;
  openClawHookUrl: string;
  hookRetryDelaysMs: number[];
  hookRequestTimeoutMs: number;
  hookAgentTimeoutSeconds: number;
  hookAgentId: string;
  hookName: string;
};

function loadConfig(): ReceiverConfig {
  const defaultPath = resolve(
    fileURLToPath(new URL("./config.py", import.meta.url)),
  );
  const configPath = resolve(
    process.env.THOUGHTS_RECEIVER_CONFIG ?? defaultPath,
  );
  const output = execFileSync("python3", [configPath], { encoding: "utf8" });
  return JSON.parse(output) as ReceiverConfig;
}

const CONFIG = loadConfig();
const RECORDINGS_ROOT = resolve(CONFIG.recordingsRoot);
const OPENCLAW_HOOK_TOKEN = process.env.THOUGHTS_OPENCLAW_HOOK_TOKEN?.trim();

type RecordingLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  capturedAt: string;
  city?: string | null;
  suburb?: string | null;
};

type RecordingMetadata = {
  receivedAt: string;
  locationStatus: "captured" | "disabled" | "unavailable";
  location: RecordingLocation | null;
};

type ThoughtAnalysis = {
  type: string;
  title: string;
  subtitle: string;
  tags: string[];
  summary: string;
  key_points: string[];
  open_questions: string[];
  decisions: string[];
  next_steps: string[];
  people: string[];
  projects: string[];
  mentioned_locations: string[];
};

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

type Transcript = {
  text: string;
  segments: TranscriptSegment[];
  language: string;
};

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class UploadSizeLimiter extends Transform {
  bytes = 0;

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    this.bytes += chunk.length;
    if (this.bytes > CONFIG.maxUploadBytes) {
      callback(new RequestError(413, "Recording exceeds the upload limit"));
      return;
    }
    callback(null, chunk);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayFolder(date: Date): string {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function recordingBaseName(date: Date): string {
  return `rec-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(body));
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function formatLocationLabel(location: RecordingLocation): string {
  return (
    [location.city, location.suburb].filter(Boolean).join(", ") ||
    "Standort erfasst"
  );
}

async function loadNote(
  recordingRelativePath: string,
  locationLabel?: string,
): Promise<Record<string, unknown>> {
  const recordingDirectory = resolve(RECORDINGS_ROOT, recordingRelativePath);
  const recordingsPrefix = `${RECORDINGS_ROOT}/`;
  if (!recordingDirectory.startsWith(recordingsPrefix)) {
    throw new Error("Featured recording path is outside recordings root");
  }

  const recordingName = basename(recordingDirectory);
  const [thought, transcript, location, audioStats] = await Promise.all([
    readJsonFile<ThoughtAnalysis>(
      join(recordingDirectory, `${recordingName}.thought.json`),
    ),
    readJsonFile<Transcript>(
      join(recordingDirectory, `${recordingName}.transcript.json`),
    ),
    readJsonFile<RecordingMetadata>(
      join(recordingDirectory, `${recordingName}.location.json`),
    ),
    stat(join(recordingDirectory, `${recordingName}.m4a`)),
  ]);

  const durationSeconds = transcript.segments.reduce(
    (longest, segment) => Math.max(longest, segment.end),
    0,
  );
  const wordCount = transcript.text.trim()
    ? transcript.text.trim().split(/\s+/).length
    : 0;

  return {
    id: recordingName,
    relativePath: `${recordingRelativePath}/${recordingName}.m4a`,
    type: thought.type,
    title: thought.title,
    subtitle: thought.subtitle,
    tags: thought.tags,
    summary: thought.summary,
    keyPoints: thought.key_points,
    openQuestions: thought.open_questions,
    decisions: thought.decisions,
    nextSteps: thought.next_steps,
    people: thought.people,
    projects: thought.projects,
    mentionedLocations: thought.mentioned_locations,
    recordedAt: location.location?.capturedAt ?? audioStats.mtime.toISOString(),
    locationStatus: location.locationStatus,
    location: location.location,
    locationLabel: location.location
      ? formatLocationLabel(location.location)
      : (locationLabel ?? "Ohne Standort"),
    durationSeconds,
    wordCount,
    audioBytes: audioStats.size,
    transcript: {
      text: transcript.text.trim(),
      language: transcript.language,
      segments: transcript.segments.map(({ start, end, text }) => ({
        start,
        end,
        text: text.trim(),
      })),
    },
  };
}

async function loadFeaturedNote(): Promise<Record<string, unknown>> {
  return loadNote(
    CONFIG.featuredRecordingRelativePath,
    CONFIG.featuredRecordingLocationLabel,
  );
}

function apiDateToDayFolder(apiDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(apiDate);
  if (!match) throw new RequestError(400, "Date must use YYYY-MM-DD");

  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new RequestError(400, "Invalid date");
  }
  return `${day}-${month}-${year}`;
}

function noteCard(note: Record<string, unknown>): Record<string, unknown> {
  return {
    id: note.id,
    relativePath: note.relativePath,
    type: note.type,
    title: note.title,
    subtitle: note.subtitle,
    tags: note.tags,
    recordedAt: note.recordedAt,
    locationStatus: note.locationStatus,
    locationLabel: note.locationLabel,
    durationSeconds: note.durationSeconds,
  };
}

async function loadNotesForDate(apiDate: string): Promise<{
  notes: Record<string, unknown>[];
  processingCount: number;
}> {
  const folder = apiDateToDayFolder(apiDate);
  const dayDirectory = join(RECORDINGS_ROOT, folder);
  let entries;
  try {
    entries = await readdir(dayDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { notes: [], processingCount: 0 };
    }
    throw error;
  }

  const recordingFolders = entries
    .filter(
      (entry) =>
        entry.isDirectory() && /^rec-\d{2}-\d{2}(?:-\d{2})?$/.test(entry.name),
    )
    .map((entry) => entry.name);
  const results = await Promise.allSettled(
    recordingFolders.map(async (recordingFolder) => {
      const relativeDirectory = `${folder}/${recordingFolder}`;
      const locationLabel =
        relativeDirectory === CONFIG.featuredRecordingRelativePath
          ? CONFIG.featuredRecordingLocationLabel
          : undefined;
      return noteCard(await loadNote(relativeDirectory, locationLabel));
    }),
  );

  const notes: Record<string, unknown>[] = [];
  let processingCount = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      notes.push(result.value);
      continue;
    }
    processingCount += 1;
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    console.log(
      `${new Date().toISOString()} note not ready for ${folder}: ${message}`,
    );
  }

  notes.sort((left, right) =>
    String(right.recordedAt).localeCompare(String(left.recordedAt)),
  );
  return { notes, processingCount };
}

function parseApiMonth(apiMonth: string): { year: string; month: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(apiMonth);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new RequestError(400, "Month must use YYYY-MM");
  }
  return { year: match[1], month: match[2] };
}

async function loadThoughtDaysForMonth(
  apiMonth: string,
): Promise<{ date: string; count: number }[]> {
  const { year, month } = parseApiMonth(apiMonth);
  const entries = await readdir(RECORDINGS_ROOT, { withFileTypes: true });
  const matchingDays = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      new RegExp(`^\\d{2}-${month}-${year}$`).test(entry.name),
  );

  const days = await Promise.all(
    matchingDays.map(async (entry) => {
      const recordings = await readdir(join(RECORDINGS_ROOT, entry.name), {
        withFileTypes: true,
      });
      const count = recordings.filter(
        (recording) =>
          recording.isDirectory() &&
          /^rec-\d{2}-\d{2}(?:-\d{2})?$/.test(recording.name),
      ).length;
      const day = entry.name.slice(0, 2);
      return { date: `${year}-${month}-${day}`, count };
    }),
  );

  return days
    .filter(({ count }) => count > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function recordingDirectoryFromAudioPath(relativeAudioPath: string): string {
  if (!relativeAudioPath.endsWith(".m4a")) {
    throw new RequestError(400, "Note path must point to an m4a file");
  }
  const parts = relativeAudioPath.split("/");
  if (parts.length !== 3 || parts.some((part) => !part || part === "..")) {
    throw new RequestError(400, "Invalid note path");
  }
  const [day, recordingFolder, audioFile] = parts;
  if (
    !/^\d{2}-\d{2}-\d{4}$/.test(day) ||
    !/^rec-\d{2}-\d{2}(?:-\d{2})?$/.test(recordingFolder) ||
    audioFile !== `${recordingFolder}.m4a`
  ) {
    throw new RequestError(400, "Invalid note path");
  }
  return `${day}/${recordingFolder}`;
}

function parseOptionalNumber(
  request: IncomingMessage,
  headerName: string,
): number | null {
  const raw = request.headers[headerName];
  if (raw === undefined || raw === "") return null;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(value)) {
    throw new RequestError(400, `Invalid ${headerName} header`);
  }
  return value;
}

function parseOptionalText(
  request: IncomingMessage,
  headerName: string,
): string | null {
  const raw = request.headers[headerName];
  if (raw === undefined || raw === "") return null;
  const encoded = Array.isArray(raw) ? raw[0] : raw;
  let value: string;
  try {
    value = decodeURIComponent(encoded).trim();
  } catch {
    throw new RequestError(400, `Invalid ${headerName} header`);
  }
  if (!value || value.length > 120 || /[\r\n]/.test(value)) {
    throw new RequestError(400, `Invalid ${headerName} header`);
  }
  return value;
}

function recordingMetadata(
  request: IncomingMessage,
  receivedAt: Date,
): RecordingMetadata {
  const rawStatus = request.headers["x-thoughts-location-status"];
  const locationStatus =
    (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus) ?? "unavailable";
  if (!["captured", "disabled", "unavailable"].includes(locationStatus)) {
    throw new RequestError(400, "Invalid location status");
  }

  if (locationStatus !== "captured") {
    return {
      receivedAt: receivedAt.toISOString(),
      locationStatus,
      location: null,
    } as RecordingMetadata;
  }

  const latitude = parseOptionalNumber(request, "x-thoughts-latitude");
  const longitude = parseOptionalNumber(request, "x-thoughts-longitude");
  const accuracy = parseOptionalNumber(request, "x-thoughts-location-accuracy");
  const altitude = parseOptionalNumber(request, "x-thoughts-location-altitude");
  const capturedAtHeader = request.headers["x-thoughts-location-captured-at"];
  const capturedAt = Array.isArray(capturedAtHeader)
    ? capturedAtHeader[0]
    : capturedAtHeader;
  const city = parseOptionalText(request, "x-thoughts-city");
  const suburb = parseOptionalText(request, "x-thoughts-suburb");

  if (latitude === null || latitude < -90 || latitude > 90) {
    throw new RequestError(400, "Invalid or missing latitude");
  }
  if (longitude === null || longitude < -180 || longitude > 180) {
    throw new RequestError(400, "Invalid or missing longitude");
  }
  if (accuracy !== null && accuracy < 0) {
    throw new RequestError(400, "Invalid location accuracy");
  }
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) {
    throw new RequestError(400, "Invalid or missing location timestamp");
  }

  return {
    receivedAt: receivedAt.toISOString(),
    locationStatus: "captured",
    location: {
      latitude,
      longitude,
      accuracy,
      altitude,
      capturedAt,
      city,
      suburb,
    },
  };
}

async function moveToUniqueRecordingFolder(
  temporaryPath: string,
  dayDirectory: string,
  receivedAt: Date,
): Promise<{ destination: string; recordingDirectory: string }> {
  const baseName = recordingBaseName(receivedAt);

  for (let copy = 1; copy <= CONFIG.uniqueNameAttempts; copy += 1) {
    const suffix = copy === 1 ? "" : `-${pad(copy)}`;
    const recordingName = `${baseName}${suffix}`;
    const recordingDirectory = join(dayDirectory, recordingName);
    try {
      await mkdir(recordingDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }

    const destination = join(recordingDirectory, `${recordingName}.m4a`);
    try {
      await copyFile(temporaryPath, destination);
      await unlink(temporaryPath);
      return { destination, recordingDirectory };
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      await rmdir(recordingDirectory).catch(() => undefined);
      throw error;
    }
  }

  throw new Error("Could not allocate a unique recording folder");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function triggerOpenClaw(
  recordingPath: string,
  relativePath: string,
  metadataPath: string,
  metadata: RecordingMetadata,
): Promise<void> {
  if (!CONFIG.openClawHookUrl || !OPENCLAW_HOOK_TOKEN) {
    console.log(`${new Date().toISOString()} OpenClaw hook is not configured`);
    return;
  }

  const payload = JSON.stringify({
    message: [
      "A new voice thought has been saved locally.",
      `Audio path: ${recordingPath}`,
      `Metadata path: ${metadataPath}`,
      metadata.location
        ? `Location: ${formatLocationLabel(metadata.location)}`
        : `Location: ${metadata.locationStatus}`,
      "Use the transcribe-thought skill now to transcribe this exact file locally.",
      "Preserve the original audio and the generated transcript files.",
    ].join("\n"),
    name: CONFIG.hookName,
    agentId: CONFIG.hookAgentId,
    idempotencyKey: `thought-recording:${relativePath}`,
    wakeMode: "now",
    deliver: false,
    timeoutSeconds: CONFIG.hookAgentTimeoutSeconds,
  });

  let lastError: unknown;
  for (const delay of CONFIG.hookRetryDelaysMs) {
    if (delay > 0) await wait(delay);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CONFIG.hookRequestTimeoutMs,
    );
    try {
      const response = await fetch(CONFIG.openClawHookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENCLAW_HOOK_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OpenClaw hook returned HTTP ${response.status}`);
      }
      console.log(
        `${new Date().toISOString()} queued OpenClaw processing for ${relativePath}`,
      );
      return;
    } catch (error) {
      lastError = error;
      console.error(
        `${new Date().toISOString()} OpenClaw hook attempt failed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error(
    `${new Date().toISOString()} OpenClaw processing was not queued for ${relativePath}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function receiveRecording(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const contentType = request.headers["content-type"] ?? "";
  if (
    !contentType.startsWith("audio/") &&
    contentType !== "application/octet-stream"
  ) {
    throw new RequestError(415, "Only audio uploads are accepted");
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > CONFIG.maxUploadBytes) {
    throw new RequestError(413, "Recording exceeds the upload limit");
  }

  const receivedAt = new Date();
  const metadata = recordingMetadata(request, receivedAt);
  const folderName = dayFolder(receivedAt);
  const destinationDirectory = join(RECORDINGS_ROOT, folderName);
  await mkdir(destinationDirectory, { recursive: true });

  const temporaryPath = join(
    destinationDirectory,
    `.upload-${randomUUID()}.tmp`,
  );
  const limiter = new UploadSizeLimiter();

  try {
    await pipeline(
      request,
      limiter,
      createWriteStream(temporaryPath, {
        flags: "wx",
        mode: CONFIG.uploadFileMode,
      }),
    );
    if (limiter.bytes === 0) throw new RequestError(400, "Upload is empty");

    const { destination, recordingDirectory } =
      await moveToUniqueRecordingFolder(
        temporaryPath,
        destinationDirectory,
        receivedAt,
      );
    const recordingFolderName = basename(recordingDirectory);
    const relativePath = `${folderName}/${recordingFolderName}/${basename(destination)}`;
    const metadataPath = destination.replace(/\.m4a$/, ".location.json");
    const relativeMetadataPath = `${folderName}/${recordingFolderName}/${basename(metadataPath)}`;
    try {
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: CONFIG.uploadFileMode,
      });
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      await rmdir(recordingDirectory).catch(() => undefined);
      throw error;
    }
    console.log(
      `${receivedAt.toISOString()} saved ${relativePath} (${limiter.bytes} bytes)`,
    );
    sendJson(response, 201, {
      ok: true,
      relativePath,
      relativeMetadataPath,
      bytes: limiter.bytes,
    });
    void triggerOpenClaw(destination, relativePath, metadataPath, metadata);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === CONFIG.healthPath) {
      sendJson(response, 200, { ok: true, recordingsRoot: RECORDINGS_ROOT });
      return;
    }

    if (request.method === "GET" && url.pathname === CONFIG.featuredNotePath) {
      sendJson(response, 200, { ok: true, note: await loadFeaturedNote() });
      return;
    }

    if (request.method === "GET" && url.pathname === CONFIG.notesListPath) {
      const date = url.searchParams.get("date");
      if (!date) throw new RequestError(400, "Missing date");
      const result = await loadNotesForDate(date);
      sendJson(response, 200, { ok: true, date, ...result });
      return;
    }

    if (request.method === "GET" && url.pathname === CONFIG.noteDaysPath) {
      const month = url.searchParams.get("month");
      if (!month) throw new RequestError(400, "Missing month");
      const days = await loadThoughtDaysForMonth(month);
      sendJson(response, 200, { ok: true, month, days });
      return;
    }

    if (request.method === "GET" && url.pathname === CONFIG.noteStatusPath) {
      const relativeAudioPath = url.searchParams.get("path");
      if (!relativeAudioPath) throw new RequestError(400, "Missing note path");
      const recordingDirectory =
        recordingDirectoryFromAudioPath(relativeAudioPath);
      try {
        const note = await loadNote(recordingDirectory);
        sendJson(response, 200, { ok: true, status: "ready", note });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          sendJson(response, 200, { ok: true, status: "processing" });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === CONFIG.recordingsPath) {
      await receiveRecording(request, response);
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  })().catch((error: unknown) => {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`${new Date().toISOString()} upload failed: ${message}`);
    if (!response.headersSent)
      sendJson(response, status, { ok: false, error: message });
    else response.destroy();
  });
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(
    `thoughts receiver listening on http://${CONFIG.host}:${CONFIG.port}`,
  );
  console.log(`recordings root: ${RECORDINGS_ROOT}`);
  console.log(
    `OpenClaw hook: ${CONFIG.openClawHookUrl && OPENCLAW_HOOK_TOKEN ? "configured" : "disabled"}`,
  );
});
