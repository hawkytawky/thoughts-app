import { describe, expect, it, vi } from "vitest";
import {
  formatRecordingTime,
  isBackgroundAudioSessionError,
  metadataUriFor,
  meteringToAmplitude,
  withTimeout,
} from "./recording-utils";

describe("recording utilities", () => {
  it("formats recording durations without negative values", () => {
    expect(formatRecordingTime(-1)).toBe("00:00");
    expect(formatRecordingTime(65_999)).toBe("01:05");
  });

  it("maps metering values to a bounded visual amplitude", () => {
    expect(meteringToAmplitude(undefined)).toBe(0);
    expect(meteringToAmplitude(-50)).toBe(0);
    expect(meteringToAmplitude(-25)).toBeGreaterThan(0);
    expect(meteringToAmplitude(-10)).toBe(1);
    expect(meteringToAmplitude(5)).toBe(1);
  });

  it("derives the metadata sidecar without changing other extensions", () => {
    expect(metadataUriFor("file:///thought.m4a")).toBe(
      "file:///thought.location.json",
    );
    expect(metadataUriFor("file:///thought.webm")).toBe("file:///thought.webm");
  });

  it("recognizes retryable iOS background audio-session errors", () => {
    expect(
      isBackgroundAudioSessionError(
        new Error("Audio session could not be activated"),
      ),
    ).toBe(true);
    expect(isBackgroundAudioSessionError(new Error("Microphone denied"))).toBe(
      false,
    );
  });

  it("returns a fallback when an operation exceeds its deadline", async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<string>(() => {}), 100, "fallback");
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("fallback");
    vi.useRealTimers();
  });
});
