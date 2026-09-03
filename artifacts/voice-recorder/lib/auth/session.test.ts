import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => {
  let token: string | null = null;
  return {
    deleteItemAsync: vi.fn(async () => {
      token = null;
    }),
    getItemAsync: vi.fn(async () => token),
    reset(nextToken: string | null = null) {
      token = nextToken;
      this.deleteItemAsync.mockClear();
      this.getItemAsync.mockClear();
      this.setItemAsync.mockClear();
    },
    setItemAsync: vi.fn(async (_key: string, nextToken: string) => {
      token = nextToken;
    }),
    storedToken: () => token,
  };
});

const googleSignin = vi.hoisted(() => ({
  configure: vi.fn(),
  hasPlayServices: vi.fn(async () => undefined),
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "after-first-unlock",
  deleteItemAsync: secureStore.deleteItemAsync,
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
}));

vi.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: googleSignin,
  isCancelledResponse: vi.fn(() => false),
  isSuccessResponse: vi.fn(() => true),
}));

vi.mock("./config", () => ({
  authConfig: {
    apiUrl: "https://api.example.test",
    googleIosClientId: "ios-client",
    googleWebClientId: "web-client",
  },
  getAuthConfigurationError: () => null,
}));

function sessionResponse(accessToken: string, refreshToken: string): Response {
  return {
    json: async () => ({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600,
    }),
    ok: true,
    status: 200,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("authentication session", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    secureStore.reset();
    googleSignin.configure.mockClear();
    googleSignin.hasPlayServices.mockClear();
    googleSignin.signIn.mockReset();
    googleSignin.signOut.mockClear();
  });

  it("coalesces concurrent access-token refreshes", async () => {
    secureStore.reset("refresh-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sessionResponse("access-2", "refresh-2"));
    vi.stubGlobal("fetch", fetchMock);
    const { getAccessToken } = await import("./session");

    const [first, second] = await Promise.all([
      getAccessToken(),
      getAccessToken(),
    ]);

    expect(first).toBe("access-2");
    expect(second).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secureStore.storedToken()).toBe("refresh-2");
  });

  it("does not restore a refresh result after logout", async () => {
    secureStore.reset("refresh-1");
    const refresh = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return refresh.promise;
      return Promise.resolve({ ok: true, status: 204 } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { clearSession, getAccessToken } = await import("./session");

    const accessToken = getAccessToken();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example.test/auth/refresh",
        expect.any(Object),
      );
    });

    await clearSession();
    refresh.resolve(sessionResponse("stale-access", "stale-refresh"));

    await expect(accessToken).rejects.toThrow(
      "Die Sitzung wurde zwischenzeitlich beendet.",
    );
    expect(secureStore.storedToken()).toBeNull();
  });

  it("rejects malformed authentication responses", async () => {
    secureStore.reset("refresh-1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ access_token: "missing-fields" }),
        ok: true,
        status: 200,
      } as Response),
    );
    const { getAccessToken } = await import("./session");

    await expect(getAccessToken()).rejects.toThrow(
      "Die Anmeldung hat unerwartete Daten geliefert.",
    );
  });
});
