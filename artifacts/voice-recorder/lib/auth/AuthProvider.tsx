import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  deleteCurrentUser,
  fetchCurrentUser,
  updateProfile,
  type CurrentUser,
  type Gender,
} from "./api";
import { getAuthConfigurationError } from "./config";
import {
  clearSession,
  restoreSession,
  signInWithApple as startAppleSignIn,
  signInWithGoogle as startGoogleSignIn,
  subscribeToSessionCleared,
} from "./session";
import { clearLocalUserData } from "@/lib/local-user-data";
import {
  clearFeedBootstrapPrefetch,
  clearFeedCache,
  prefetchFeedBootstrap,
} from "@/lib/feed-bootstrap";

type AuthStatus =
  "loading" | "signed-out" | "signed-in" | "configuration-error";

type AuthContextValue = {
  status: AuthStatus;
  user: CurrentUser | null;
  error: string | null;
  deleteAccount: () => Promise<void>;
  saveProfile: (input: {
    date_of_birth: string;
    gender: Gender;
  }) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const configurationError = getAuthConfigurationError();
    if (configurationError) {
      setError(configurationError);
      setStatus("configuration-error");
      return;
    }

    void restoreSession()
      .then(async (restored) => {
        if (!restored) {
          setStatus("signed-out");
          return;
        }
        // Kick the feed requests off now so they overlap with /auth/me
        // instead of waiting for the feed screen to mount behind it.
        prefetchFeedBootstrap();
        setUser(await fetchCurrentUser());
        setStatus("signed-in");
      })
      .catch(async () => {
        clearFeedBootstrapPrefetch();
        await clearSession();
        setUser(null);
        setStatus("signed-out");
      });
  }, []);

  useEffect(
    () =>
      subscribeToSessionCleared(() => {
        setUser(null);
        setStatus("signed-out");
      }),
    [],
  );

  const signInWithApple = useCallback(async () => {
    setError(null);
    try {
      await startAppleSignIn();
      setUser(await fetchCurrentUser());
      setStatus("signed-in");
    } catch (caught) {
      await clearSession();
      const message =
        caught instanceof Error ? caught.message : "Anmeldung fehlgeschlagen.";
      setError(message);
      setStatus("signed-out");
      throw caught;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      await startGoogleSignIn();
      setUser(await fetchCurrentUser());
      setStatus("signed-in");
    } catch (caught) {
      await clearSession();
      const message =
        caught instanceof Error ? caught.message : "Anmeldung fehlgeschlagen.";
      setError(message);
      setStatus("signed-out");
      throw caught;
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearFeedCache();
    await clearSession();
    setUser(null);
    setError(null);
    setStatus("signed-out");
  }, []);

  const saveProfile = useCallback(
    async (input: { date_of_birth: string; gender: Gender }) => {
      const updated = await updateProfile(input);
      setUser(updated);
    },
    [],
  );

  const deleteAccount = useCallback(async () => {
    await deleteCurrentUser();
    try {
      await clearLocalUserData();
    } finally {
      await clearSession();
      setUser(null);
      setError(null);
      setStatus("signed-out");
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      error,
      deleteAccount,
      saveProfile,
      signInWithApple,
      signInWithGoogle,
      signOut,
    }),
    [
      status,
      user,
      error,
      deleteAccount,
      saveProfile,
      signInWithApple,
      signInWithGoogle,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error("useAuth muss innerhalb des AuthProvider laufen.");
  return context;
}
