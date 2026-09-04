export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });
  const result = await Promise.race([promise, timeoutResult]);
  if (timeout) clearTimeout(timeout);
  return result;
}

export function isBackgroundAudioSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /background|audio session could not be activated/i.test(message);
}

export function metadataUriFor(localUri: string): string {
  return localUri.replace(/\.m4a$/, ".location.json");
}

export function meteringToAmplitude(decibels: number | undefined): number {
  if (decibels === undefined || !Number.isFinite(decibels)) return 0;

  const silenceFloor = -40;
  const loudSpeech = -10;
  if (decibels <= silenceFloor) return 0;

  const normalized = Math.min(
    1,
    (decibels - silenceFloor) / (loudSpeech - silenceFloor),
  );
  const eased = normalized * normalized * (3 - 2 * normalized);
  return Math.pow(eased, 1.18);
}

export function formatRecordingTime(milliseconds: number): string {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
