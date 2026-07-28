export const authConfig = {
  apiUrl: process.env.EXPO_PUBLIC_THOUGHTS_API_URL?.replace(/\/+$/, ""),
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
} as const;

export function getAuthConfigurationError(): string | null {
  const missing = [
    ["EXPO_PUBLIC_THOUGHTS_API_URL", authConfig.apiUrl],
    ["EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID", authConfig.googleIosClientId],
    ["EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", authConfig.googleWebClientId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return missing.length
    ? `Fehlende Konfiguration: ${missing.join(", ")}`
    : null;
}
