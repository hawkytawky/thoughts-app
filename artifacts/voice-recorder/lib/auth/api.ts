import { authConfig } from "./config";
import { clearSession, getAccessToken } from "./session";

export type CurrentUser = {
  user_id: string;
  display_name: string | null;
  auth_provider: string;
};

export async function backendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!authConfig.apiUrl) {
    throw new Error("EXPO_PUBLIC_THOUGHTS_API_URL ist nicht konfiguriert.");
  }

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (authConfig.isAzureMode) {
    headers.set("Authorization", `Bearer ${await getAccessToken()}`);
  }

  const response = await fetch(`${authConfig.apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (authConfig.isAzureMode && response.status === 401) {
    await clearSession();
  }
  return response;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const response = await backendFetch("/auth/me");
  if (!response.ok) {
    throw new Error(`Backend hat den Login abgelehnt (${response.status}).`);
  }
  return (await response.json()) as CurrentUser;
}

export async function deleteCurrentUser(): Promise<void> {
  const response = await backendFetch("/auth/me", { method: "DELETE" });
  if (!response.ok) {
    throw new Error(
      `Das Konto konnte nicht gelöscht werden (${response.status}).`,
    );
  }
}
