# thoughts

A calm place to record and revisit thoughts. The app is built with Expo and talks to the FastAPI backend hosted on Azure.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/thoughts dev
```

The app needs `EXPO_PUBLIC_THOUGHTS_API_URL`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

## Check

```sh
pnpm typecheck
pnpm test
```

The native folders are generated and intentionally ignored. Recreate iOS with `pnpm --filter @workspace/thoughts prebuild:ios`. EAS profiles live in [artifacts/voice-recorder/eas.json](artifacts/voice-recorder/eas.json); the Maestro smoke test runs with `pnpm --filter @workspace/thoughts e2e` after installing Maestro.
