# Anmeldung

Die App meldet Nutzer direkt mit Google an. Das Google-ID-Token wird vom
Thoughts-Backend geprüft und gegen eine interne Sitzung getauscht. Apple-Login
ist vorbereitet, aber noch nicht verfügbar.

## Ablauf

```mermaid
sequenceDiagram
    actor User
    participant App as iPhone App
   participant Google
    participant API as Thoughts API

   User->>App: Mit Google anmelden
   App->>Google: Google Sign-In
   Google-->>App: ID-Token
   App->>API: POST /auth/google
   API-->>App: Access- und Refresh-Token
    App->>API: GET /auth/me + Bearer Token
   API-->>App: Nutzerprofil
```

Das Refresh-Token liegt im iOS-Keychain (`expo-secure-store`). Das kurzlebige
Access-Token bleibt im Speicher und wird über `/auth/refresh` erneuert. Bei einer
ungültigen Sitzung werden die lokalen Anmeldedaten entfernt.

## Konfiguration

Benötigt werden `EXPO_PUBLIC_THOUGHTS_API_URL`,
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` und `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
Die App enthält kein Client-Secret.
