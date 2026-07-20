# thoughts

An organic, minimal voice recorder for capturing thoughts without friction.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/thoughts run dev` — start the Expo dev server for the mobile app
- `pnpm --filter @workspace/scripts run recordings:receive` — receive private audio uploads on `127.0.0.1:4317`
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

### Environment

- `DATABASE_URL` — Postgres connection string (required by the API server)
- `EXPO_PUBLIC_THOUGHTS_UPLOAD_URL` — private HTTPS URL (e.g. created by Tailscale Serve) the mobile app uploads recordings to
- Receiver paths, limits, ports, and OpenClaw retry settings live in `scripts/src/config.py`. Set `THOUGHTS_RECEIVER_CONFIG` only when using a different config file.
- `THOUGHTS_OPENCLAW_HOOK_TOKEN` stays an environment variable because secrets must not be stored in source-controlled config.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo / React Native (expo-router)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Layout

- `artifacts/voice-recorder` — Expo/React Native mobile app
- `artifacts/api-server` — Express API server
- `artifacts/mockup-sandbox` — Vite design/mockup sandbox
- `lib/*` — shared packages (db, api-spec, api-zod, api-client-react)
- `scripts` — operational scripts (e.g. recording receiver)
