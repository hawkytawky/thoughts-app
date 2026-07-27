const dataMode = process.env.EXPO_PUBLIC_THOUGHTS_DATA_MODE ?? "local";

export const authConfig = {
  isAzureMode: dataMode === "azure",
  apiUrl: process.env.EXPO_PUBLIC_THOUGHTS_API_URL?.replace(/\/+$/, ""),
  authority: process.env.EXPO_PUBLIC_ENTRA_AUTHORITY?.replace(/\/+$/, ""),
  clientId: process.env.EXPO_PUBLIC_ENTRA_IOS_CLIENT_ID,
  apiScope: process.env.EXPO_PUBLIC_ENTRA_API_SCOPE,
  redirectUri:
    process.env.EXPO_PUBLIC_ENTRA_REDIRECT_URI ??
    "msauth.com.otto.thoughts://auth",
} as const;

export function getAuthConfigurationError(): string | null {
  if (!authConfig.isAzureMode) return null;

  const missing = [
    ["EXPO_PUBLIC_THOUGHTS_API_URL", authConfig.apiUrl],
    ["EXPO_PUBLIC_ENTRA_AUTHORITY", authConfig.authority],
    ["EXPO_PUBLIC_ENTRA_IOS_CLIENT_ID", authConfig.clientId],
    ["EXPO_PUBLIC_ENTRA_API_SCOPE", authConfig.apiScope],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return missing.length
    ? `Fehlende Konfiguration: ${missing.join(", ")}`
    : null;
}
