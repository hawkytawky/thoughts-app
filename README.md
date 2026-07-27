# thoughts

An organic, minimal voice recorder for capturing thoughts without friction.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/thoughts run dev` — start the Expo dev server for the mobile app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

### Environment

- `DATABASE_URL` — Postgres connection string (required by the API server)
- `EXPO_PUBLIC_THOUGHTS_API_URL` — public HTTPS URL of the Azure Thoughts API
- `EXPO_PUBLIC_ENTRA_AUTHORITY` — Microsoft Entra External ID authority
- `EXPO_PUBLIC_ENTRA_IOS_CLIENT_ID` — public iOS application client ID
- `EXPO_PUBLIC_ENTRA_API_SCOPE` — delegated Thoughts API scope
- `EXPO_PUBLIC_ENTRA_REDIRECT_URI` — native iOS authentication redirect URI

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
- `scripts` — workspace operational scripts
