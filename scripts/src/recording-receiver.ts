import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
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
};

type RecordingMetadata = {
  receivedAt: string;
  locationStatus: "captured" | "disabled" | "unavailable";
  location: RecordingLocation | null;
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
  });
  response.end(JSON.stringify(body));
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

function recordingMetadata(
  request: IncomingMessage,
  receivedAt: Date,
): RecordingMetadata {
  const rawStatus = request.headers["x-thoughts-location-status"];
  const locationStatus = (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus) ??
    "unavailable";
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
  const accuracy = parseOptionalNumber(
    request,
    "x-thoughts-location-accuracy",
  );
  const altitude = parseOptionalNumber(
    request,
    "x-thoughts-location-altitude",
  );
  const capturedAtHeader = request.headers["x-thoughts-location-captured-at"];
  const capturedAt = Array.isArray(capturedAtHeader)
    ? capturedAtHeader[0]
    : capturedAtHeader;

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
    location: { latitude, longitude, accuracy, altitude, capturedAt },
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
        ? `Location: ${metadata.location.latitude}, ${metadata.location.longitude} (accuracy ${metadata.location.accuracy ?? "unknown"} m)`
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
