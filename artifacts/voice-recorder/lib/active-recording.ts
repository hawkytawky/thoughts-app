import { useSyncExternalStore } from "react";

type ActiveRecordingSnapshot = {
  active: boolean;
  durationMs: number;
  // The recorder screen can sit unfocused in the navigation stack while its
  // recording keeps running. Consumers use this to reuse that screen instead
  // of pushing a second copy on top of it.
  recorderMounted: boolean;
};

let snapshot: ActiveRecordingSnapshot = {
  active: false,
  durationMs: 0,
  recorderMounted: false,
};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function publishActiveRecording(durationMs: number) {
  const nextDurationMs = Math.max(0, durationMs);
  if (
    snapshot.active &&
    Math.floor(snapshot.durationMs / 1_000) ===
      Math.floor(nextDurationMs / 1_000)
  ) {
    return;
  }

  snapshot = { ...snapshot, active: true, durationMs: nextDurationMs };
  emit();
}

export function clearActiveRecording() {
  if (!snapshot.active && snapshot.durationMs === 0) return;
  snapshot = { ...snapshot, active: false, durationMs: 0 };
  emit();
}

type RecorderControls = {
  stop: () => void;
  startNext: () => void;
};

let controls: RecorderControls | null = null;

// The recorder screen owns the audio session, so stopping from elsewhere in
// the app has to go through that screen rather than around it.
export function registerRecorderControls(next: RecorderControls | null) {
  controls = next;
  const recorderMounted = next !== null;
  if (snapshot.recorderMounted === recorderMounted) return;
  snapshot = { ...snapshot, recorderMounted };
  emit();
}

export function requestStopRecording() {
  controls?.stop();
}

export function requestStartNextRecording() {
  controls?.startNext();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useActiveRecording() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
