import { authConfig } from "./config";
import { clearSession, getAccessToken } from "./session";

export type Gender = "female" | "male" | "diverse" | "prefer_not_to_say";

export type CurrentUser = {
  user_id: string;
  display_name: string | null;
  auth_provider: string;
  given_name: string | null;
  family_name: string | null;
  email: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  onboarding_complete: boolean;
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
  headers.set("Authorization", `Bearer ${await getAccessToken()}`);

  const response = await fetch(`${authConfig.apiUrl}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401) {
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

export async function updateProfile(input: {
  date_of_birth: string;
  gender: Gender;
}): Promise<CurrentUser> {
  const response = await backendFetch("/auth/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `Dein Profil konnte nicht gespeichert werden (${response.status}).`,
    );
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
