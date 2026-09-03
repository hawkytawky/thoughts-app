import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { authConfig, getAuthConfigurationError } from "./config";

const REFRESH_TOKEN_KEY = "thoughts.auth.refresh-token";
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const REFRESH_MARGIN_MS = 60_000;

type Session = { accessToken: string; expiresAt: number };

const sessionPayloadSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;

let googleConfigured = false;
let currentSession: Session | null = null;
let currentRefreshToken: string | null = null;
let refreshPromise: Promise<Session> | null = null;
let sessionGeneration = 0;
let tokenMutationChain: Promise<void> = Promise.resolve();
const sessionClearedListeners = new Set<() => void>();

class SessionChangedError extends Error {
  constructor() {
    super("Die Sitzung wurde zwischenzeitlich beendet.");
  }
}

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
  const payload = sessionPayloadSchema.safeParse(await response.json());
  if (!payload.success) {
    if (__DEV__) {
      console.error("Invalid authentication response", payload.error.issues);
    }
    throw new Error("Die Anmeldung hat unerwartete Daten geliefert.");
  }
  return payload.data;
}

async function persistRefreshToken(
  token: string,
  expectedGeneration: number,
): Promise<void> {
  const mutation = tokenMutationChain.then(async () => {
    if (sessionGeneration !== expectedGeneration)
      throw new SessionChangedError();
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, KEYCHAIN_OPTIONS);
    if (sessionGeneration !== expectedGeneration)
      throw new SessionChangedError();
    currentRefreshToken = token;
  });
  tokenMutationChain = mutation.catch(() => undefined);
  await mutation;
}

async function loadRefreshToken(): Promise<string | null> {
  await tokenMutationChain;
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY, KEYCHAIN_OPTIONS);
}

async function deleteRefreshToken(): Promise<void> {
  const mutation = tokenMutationChain.then(() =>
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, KEYCHAIN_OPTIONS),
  );
  tokenMutationChain = mutation.catch(() => undefined);
  await mutation;
}

function adoptSession(
  payload: SessionPayload,
  expectedGeneration: number,
): Session {
  if (sessionGeneration !== expectedGeneration) throw new SessionChangedError();
  currentSession = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
  return currentSession;
}

async function refreshSession(): Promise<Session> {
  const refreshToken = currentRefreshToken;
  const expectedGeneration = sessionGeneration;
  if (!refreshToken) throw new Error("Nicht angemeldet.");
  const payload = await requestSession("/auth/refresh", {
    refresh_token: refreshToken,
  });
  await persistRefreshToken(payload.refresh_token, expectedGeneration);
  return adoptSession(payload, expectedGeneration);
}

export async function restoreSession(): Promise<boolean> {
  const expectedGeneration = sessionGeneration;
  const refreshToken = await loadRefreshToken();
  if (sessionGeneration !== expectedGeneration) return false;
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
    if (sessionGeneration === expectedGeneration) await clearSession();
    return false;
  }
}

export async function signInWithGoogle(): Promise<void> {
  ensureConfigured();
  const expectedGeneration = ++sessionGeneration;
  currentSession = null;
  currentRefreshToken = null;
  refreshPromise = null;
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
  await persistRefreshToken(payload.refresh_token, expectedGeneration);
  adoptSession(payload, expectedGeneration);
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
    const expectedGeneration = sessionGeneration;
    const storedRefreshToken = await loadRefreshToken();
    if (sessionGeneration !== expectedGeneration)
      throw new SessionChangedError();
    currentRefreshToken = storedRefreshToken;
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
  sessionGeneration += 1;
  currentSession = null;
  currentRefreshToken = null;
  refreshPromise = null;
  await deleteRefreshToken();

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
