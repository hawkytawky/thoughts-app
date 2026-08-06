import { Platform } from "react-native";
import * as LiveActivity from "expo-live-activity";

// The recorder screen owns exactly one activity at a time. Keeping the id at
// module scope means a remote stop can end it without routing through React.
let activityId: string | null = null;

// The patched widget reads `progressBar.date` as the stopwatch START, so the
// Dynamic Island counts up on its own and needs no updates from JS. That is
// what keeps the timer correct even once iOS suspends the app.
const CONFIG: LiveActivity.LiveActivityConfig = {
  backgroundColor: "#2E5E8C",
  titleColor: "#FFFFFF",
  subtitleColor: "#C7D8E6",
  progressViewLabelColor: "#FFFFFF",
  timerType: "digital",
  deepLinkUrl: "thoughts://record",
};

export function startRecordingActivity(startedAtMs: number): void {
  if (Platform.OS !== "ios" || activityId) return;

  try {
    activityId =
      LiveActivity.startActivity(
        {
          title: "thoughts",
          subtitle: "Aufnahme läuft",
          progressBar: { date: startedAtMs },
        },
        CONFIG,
      ) ?? null;
  } catch (error) {
    // Live Activities are unavailable below iOS 16.2 or when the user turned
    // them off. The recording itself must not care.
    console.warn("live activity start failed:", error);
    activityId = null;
  }
}

export function stopRecordingActivity(): void {
  if (Platform.OS !== "ios" || !activityId) return;

  const id = activityId;
  activityId = null;
  try {
    LiveActivity.stopActivity(id, {
      title: "thoughts",
      subtitle: "Aufnahme beendet",
    });
  } catch (error) {
    console.warn("live activity stop failed:", error);
  }
}
