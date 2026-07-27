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
  type CurrentUser,
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

type AuthStatus =
  "loading" | "signed-out" | "signed-in" | "configuration-error";

type AuthContextValue = {
  status: AuthStatus;
  user: CurrentUser | null;
  error: string | null;
  deleteAccount: () => Promise<void>;
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
        setUser(await fetchCurrentUser());
        setStatus("signed-in");
      })
      .catch(async () => {
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
    await clearSession();
    setUser(null);
    setError(null);
    setStatus("signed-out");
  }, []);

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
      signInWithApple,
      signInWithGoogle,
      signOut,
    }),
    [
      status,
      user,
      error,
      deleteAccount,
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
