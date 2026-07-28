import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import { authConfig, getAuthConfigurationError } from "./config";

const REFRESH_TOKEN_KEY = "thoughts.auth.refresh-token";
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const REFRESH_MARGIN_MS = 60_000;

type Session = { accessToken: string; expiresAt: number };

type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

let googleConfigured = false;
let currentSession: Session | null = null;
let currentRefreshToken: string | null = null;
let refreshPromise: Promise<Session> | null = null;
const sessionClearedListeners = new Set<() => void>();

export function subscribeToSessionCleared(listener: () => void): () => void {
  sessionClearedListeners.add(listener);
  return () => sessionClearedListeners.delete(listener);
}

function ensureConfigured(): void {
  const configurationError = getAuthConfigurationError();
  if (configurationError) throw new Error(configurationError);
  if (googleConfigured) return;
  GoogleSignin.configure({
    iosClientId: authConfig.googleIosClientId!,
    webClientId: authConfig.googleWebClientId!,
  });
  googleConfigured = true;
}

function apiUrl(path: string): string {
  if (!authConfig.apiUrl) {
    throw new Error("EXPO_PUBLIC_THOUGHTS_API_URL ist nicht konfiguriert.");
  }
  return `${authConfig.apiUrl}${path}`;
}

async function requestSession(
  path: string,
  body: unknown,
): Promise<SessionPayload> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Anmeldung fehlgeschlagen (${response.status}).`);
  }
  return (await response.json()) as SessionPayload;
}

async function persistRefreshToken(token: string): Promise<void> {
  currentRefreshToken = token;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, KEYCHAIN_OPTIONS);
}

function adoptSession(payload: SessionPayload): Session {
  currentSession = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  return currentSession;
}

async function refreshSession(): Promise<Session> {
  if (!currentRefreshToken) throw new Error("Nicht angemeldet.");
  const payload = await requestSession("/auth/refresh", {
    refresh_token: currentRefreshToken,
  });
  await persistRefreshToken(payload.refresh_token);
  return adoptSession(payload);
}

export async function restoreSession(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(
    REFRESH_TOKEN_KEY,
    KEYCHAIN_OPTIONS,
  );
  if (!refreshToken) return false;

  currentRefreshToken = refreshToken;
  try {
    if (!refreshPromise) {
      refreshPromise = refreshSession().finally(() => {
        refreshPromise = null;
      });
    }
    await refreshPromise;
    return true;
  } catch {
    await clearSession();
    return false;
  }
}

export async function signInWithGoogle(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices();

  const result = await GoogleSignin.signIn();
  if (isCancelledResponse(result)) {
    throw new Error("Anmeldung abgebrochen.");
  }
  if (!isSuccessResponse(result) || !result.data.idToken) {
    throw new Error("Google hat keinen Login-Token geliefert.");
  }

  const payload = await requestSession("/auth/google", {
    id_token: result.data.idToken,
  });
  await persistRefreshToken(payload.refresh_token);
  adoptSession(payload);
}

export async function signInWithApple(): Promise<void> {
  throw new Error("Apple-Login ist bald verfügbar.");
}

export async function getAccessToken(): Promise<string> {
  if (
    currentSession &&
    currentSession.expiresAt - REFRESH_MARGIN_MS > Date.now()
  ) {
    return currentSession.accessToken;
  }

  if (!currentRefreshToken) {
    currentRefreshToken = await SecureStore.getItemAsync(
      REFRESH_TOKEN_KEY,
      KEYCHAIN_OPTIONS,
    );
  }
  if (!currentRefreshToken) throw new Error("Nicht angemeldet.");

  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => {
      refreshPromise = null;
    });
  }

  return (await refreshPromise).accessToken;
}

export async function clearSession(): Promise<void> {
  const refreshToken = currentRefreshToken;
  currentSession = null;
  currentRefreshToken = null;
  refreshPromise = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, KEYCHAIN_OPTIONS);

  if (refreshToken) {
    try {
      await fetch(apiUrl("/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      // Logout is best effort; the local session is already cleared.
    }
  }

  try {
    await GoogleSignin.signOut();
  } catch {
    // Signing out of Google is best effort.
  }

  sessionClearedListeners.forEach((listener) => listener());
}
