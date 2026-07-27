import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { authConfig, getAuthConfigurationError } from "./config";

WebBrowser.maybeCompleteAuthSession();

const REFRESH_TOKEN_KEY = "thoughts.auth.refresh-token";
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const SCOPES = [
  "openid",
  "profile",
  "offline_access",
  authConfig.apiScope ?? "",
].filter(Boolean);

let currentTokens: AuthSession.TokenResponse | null = null;
let refreshPromise: Promise<AuthSession.TokenResponse> | null = null;
const sessionClearedListeners = new Set<() => void>();

export function subscribeToSessionCleared(listener: () => void): () => void {
  sessionClearedListeners.add(listener);
  return () => sessionClearedListeners.delete(listener);
}

async function requireDiscovery(): Promise<AuthSession.DiscoveryDocument> {
  const configurationError = getAuthConfigurationError();
  if (configurationError) throw new Error(configurationError);
  return AuthSession.fetchDiscoveryAsync(authConfig.authority!);
}

async function persistRefreshToken(token: string | undefined): Promise<void> {
  if (!token) return;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, KEYCHAIN_OPTIONS);
}

async function refreshTokens(
  refreshToken: string,
): Promise<AuthSession.TokenResponse> {
  const discovery = await requireDiscovery();
  const tokens = await AuthSession.refreshAsync(
    {
      clientId: authConfig.clientId!,
      refreshToken,
      scopes: SCOPES,
    },
    discovery,
  );
  tokens.refreshToken = tokens.refreshToken ?? refreshToken;
  currentTokens = tokens;
  await persistRefreshToken(tokens.refreshToken);
  return tokens;
}

export async function restoreSession(): Promise<boolean> {
  if (!authConfig.isAzureMode) return true;
  const refreshToken = await SecureStore.getItemAsync(
    REFRESH_TOKEN_KEY,
    KEYCHAIN_OPTIONS,
  );
  if (!refreshToken) return false;

  try {
    await refreshTokens(refreshToken);
    return true;
  } catch {
    await clearSession();
    return false;
  }
}

type IdentityProvider = "apple" | "google";

async function signInWithProvider(provider: IdentityProvider): Promise<void> {
  const discovery = await requireDiscovery();
  const request = new AuthSession.AuthRequest({
    clientId: authConfig.clientId!,
    redirectUri: authConfig.redirectUri,
    responseType: AuthSession.ResponseType.Code,
    scopes: SCOPES,
    usePKCE: true,
    extraParams: {
      domain_hint: provider,
      response_mode: "query",
    },
  });

  const result = await request.promptAsync(discovery);
  if (result.type === "cancel" || result.type === "dismiss") {
    throw new Error("Anmeldung abgebrochen.");
  }
  if (result.type !== "success") {
    const providerName = provider === "apple" ? "Apple" : "Google";
    throw new Error(
      (result.type === "error" ? result.params.error_description : undefined) ??
        `${providerName}-Anmeldung fehlgeschlagen.`,
    );
  }
  if (!result.params.code || !request.codeVerifier) {
    throw new Error("Entra hat keinen vollständigen Login-Code geliefert.");
  }

  const tokens = await AuthSession.exchangeCodeAsync(
    {
      clientId: authConfig.clientId!,
      code: result.params.code,
      redirectUri: authConfig.redirectUri,
      scopes: SCOPES,
      extraParams: { code_verifier: request.codeVerifier },
    },
    discovery,
  );
  currentTokens = tokens;
  await persistRefreshToken(tokens.refreshToken);
}

export async function signInWithApple(): Promise<void> {
  await signInWithProvider("apple");
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithProvider("google");
}

export async function getAccessToken(): Promise<string> {
  if (!authConfig.isAzureMode) {
    throw new Error("Der lokale Modus benötigt kein Access Token.");
  }
  if (
    currentTokens &&
    AuthSession.TokenResponse.isTokenFresh(currentTokens, -60)
  ) {
    return currentTokens.accessToken;
  }

  if (!refreshPromise) {
    const refreshToken =
      currentTokens?.refreshToken ??
      (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY, KEYCHAIN_OPTIONS));
    if (!refreshToken) throw new Error("Nicht angemeldet.");
    refreshPromise = refreshTokens(refreshToken).finally(() => {
      refreshPromise = null;
    });
  }

  return (await refreshPromise).accessToken;
}

export async function clearSession(): Promise<void> {
  currentTokens = null;
  refreshPromise = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, KEYCHAIN_OPTIONS);
  sessionClearedListeners.forEach((listener) => listener());
}
