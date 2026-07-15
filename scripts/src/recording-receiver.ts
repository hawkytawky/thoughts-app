import { createWriteStream } from "node:fs";
import { link, mkdir, unlink } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

const HOST = process.env.THOUGHTS_RECEIVER_HOST ?? "127.0.0.1";
const PORT = Number(process.env.THOUGHTS_RECEIVER_PORT ?? 4317);
const RECORDINGS_ROOT = resolve(
  process.env.THOUGHTS_RECORDINGS_DIR ??
    join(homedir(), "Documents", "thoughts", "recordings"),
);
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

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
    if (this.bytes > MAX_UPLOAD_BYTES) {
      callback(new RequestError(413, "Recording exceeds the 250 MB limit"));
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

async function moveToUniqueName(
  temporaryPath: string,
  directory: string,
  receivedAt: Date,
): Promise<string> {
  const baseName = recordingBaseName(receivedAt);

  for (let copy = 1; copy < 10_000; copy += 1) {
    const suffix = copy === 1 ? "" : `-${pad(copy)}`;
    const fileName = `${baseName}${suffix}.m4a`;
    const destination = join(directory, fileName);
    try {
      await link(temporaryPath, destination);
      await unlink(temporaryPath);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }

  throw new Error("Could not allocate a unique recording filename");
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
  if (declaredLength > MAX_UPLOAD_BYTES) {
    throw new RequestError(413, "Recording exceeds the 250 MB limit");
  }

  const receivedAt = new Date();
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
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
    if (limiter.bytes === 0) throw new RequestError(400, "Upload is empty");

    const destination = await moveToUniqueName(
      temporaryPath,
      destinationDirectory,
      receivedAt,
    );
    const relativePath = `${folderName}/${basename(destination)}`;
    console.log(
      `${receivedAt.toISOString()} saved ${relativePath} (${limiter.bytes} bytes)`,
    );
    sendJson(response, 201, { ok: true, relativePath, bytes: limiter.bytes });
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, recordingsRoot: RECORDINGS_ROOT });
      return;
    }

    if (request.method === "POST" && url.pathname === "/recordings") {
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

server.listen(PORT, HOST, () => {
  console.log(`thoughts receiver listening on http://${HOST}:${PORT}`);
  console.log(`recordings root: ${RECORDINGS_ROOT}`);
});
