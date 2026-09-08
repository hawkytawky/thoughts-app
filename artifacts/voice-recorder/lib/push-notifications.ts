import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { backendFetch } from "./auth/api";

const INSTALLATION_ID_KEY = "@thoughts/push-installation-id";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function createInstallationId(): string {
  return `ios-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function getInstallationId(): Promise<string> {
  const stored = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (stored) return stored;
  const created = createInstallationId();
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, created);
  return created;
}

function getProjectId(): string | undefined {
  const configured = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (configured) return configured;
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined)
  );
}

function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
}

export async function registerCurrentPushInstallation(): Promise<boolean> {
  if (Platform.OS !== "ios" || !Device.isDevice) return false;

  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === "undetermined"
      ? await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        })
      : existing;
  if (permission.status !== "granted") return false;

  const projectId = getProjectId();
  const token = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();
  const installationId = await getInstallationId();
  const response = await backendFetch("/notifications/installations/current", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installation_id: installationId,
      expo_push_token: token.data,
      platform: "ios",
      timezone: currentTimezone(),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Benachrichtigungen konnten nicht registriert werden (${response.status}).`,
    );
  }
  return true;
}

export async function unregisterCurrentPushInstallation(): Promise<void> {
  const installationId = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (!installationId) return;
  const response = await backendFetch(
    `/notifications/installations/${encodeURIComponent(installationId)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Benachrichtigungen konnten nicht abgemeldet werden (${response.status}).`,
    );
  }
}

export function isWeeklyBriefingNotification(
  response: Notifications.NotificationResponse | null,
): boolean {
  const data = response?.notification.request.content.data;
  return (
    typeof data?.url === "string" && data.url.startsWith("thoughts://overview")
  );
}
