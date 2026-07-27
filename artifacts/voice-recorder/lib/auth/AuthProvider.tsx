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
import { authConfig, getAuthConfigurationError } from "./config";
import {
  clearSession,
  restoreSession,
  signInWithApple as startAppleSignIn,
  subscribeToSessionCleared,
} from "./session";

type AuthStatus =
  "loading" | "signed-out" | "signed-in" | "configuration-error";

type AuthContextValue = {
  status: AuthStatus;
  user: CurrentUser | null;
  error: string | null;
  deleteAccount: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>(
    authConfig.isAzureMode ? "loading" : "signed-in",
  );
  const [user, setUser] = useState<CurrentUser | null>(
    authConfig.isAzureMode
      ? null
      : {
          user_id: "local",
          display_name: "Lokaler Modus",
          auth_provider: "local",
        },
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authConfig.isAzureMode) return;

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

  const signOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setError(null);
    setStatus("signed-out");
  }, []);

  const deleteAccount = useCallback(async () => {
    await deleteCurrentUser();
    await clearSession();
    setUser(null);
    setError(null);
    setStatus("signed-out");
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      error,
      deleteAccount,
      signInWithApple,
      signOut,
    }),
    [status, user, error, deleteAccount, signInWithApple, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error("useAuth muss innerhalb des AuthProvider laufen.");
  return context;
}
