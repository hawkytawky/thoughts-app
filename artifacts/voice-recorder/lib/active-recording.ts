import { useSyncExternalStore } from "react";

type ActiveRecordingSnapshot = {
  active: boolean;
  durationMs: number;
};

const EMPTY_SNAPSHOT: ActiveRecordingSnapshot = {
  active: false,
  durationMs: 0,
};

let snapshot = EMPTY_SNAPSHOT;
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

  snapshot = { active: true, durationMs: nextDurationMs };
  emit();
}

export function clearActiveRecording() {
  if (!snapshot.active && snapshot.durationMs === 0) return;
  snapshot = EMPTY_SNAPSHOT;
  emit();
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
