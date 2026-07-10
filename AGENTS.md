# Repository Guide

## Workspace

- Use Node.js 22+ and the pinned `pnpm@11.11.0`. The workspace is driven by Turbo; package filters are `@shadow-cloud/api`, `@shadow-cloud/web`, `@shadow-cloud/bot`, and `@shadow-cloud/desktop`.
- `apps/api` is the NestJS API (`src/main.ts`) with the global `/v1` prefix. Its Prisma schema, migrations, and SQLite development database live under `apps/api/prisma`, with Prisma configuration at `apps/api/prisma.config.mjs`; there is no current `packages/database` package.
- `apps/web` is a Next.js App Router app rooted at `src/app`. `next.config.ts` proxies browser requests from `/v1/*` to `SHADOW_CLOUD_API_URL`; configure that variable as the API origin without a trailing `/v1`.
- `apps/bot` is a NodeNext ESM Discord bot. Keep `.js` extensions on relative imports in its TypeScript sources.
- `apps/desktop` is a React/Vite frontend plus the Rust Tauri shell in `src-tauri`. Its frontend entrypoint is `src/main.tsx`; native behavior and native tests are in `src-tauri/src`.

## Commands

- Install exactly as CI does with `pnpm install --frozen-lockfile`.
- Run the CI-equivalent checks in order with `pnpm lint && pnpm typecheck && pnpm test`. Use `pnpm build` separately when build output is relevant.
- `pnpm pr` includes in-place formatting, lint, typecheck, test, and build in one Turbo run with `--continue=always`; inspect its formatting changes before keeping them.
- Scope any task with `pnpm --filter @shadow-cloud/<app> <script>`, for example `pnpm --filter @shadow-cloud/api typecheck`.
- Run one Vitest file without invoking the whole workspace using `pnpm --filter @shadow-cloud/api exec vitest run test/api-port.test.ts`. Web and desktop tests are under `src/**/*.test.ts`; API and bot tests are under `test/**/*.test.ts`.
- Root `pnpm lint` does not lint `apps/desktop` because that package has no lint script. After desktop frontend changes, run its `format`, `typecheck`, and `test` scripts explicitly.
- Root `pnpm test` only runs JavaScript/TypeScript tests. After Rust changes, also run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

## Development And Data

- All local app launchers read the root `.env`. API Prisma commands also load that file; a relative `DATABASE_URL` is resolved beneath `apps/api/prisma`, not the repository root.
- API build, lint, and typecheck regenerate the Prisma client. After changing `apps/api/prisma/schema.prisma`, create/apply a development migration with `pnpm --filter @shadow-cloud/api prisma:migrate`; use `prisma:push` only when a migration is intentionally not needed.
- Root `pnpm dev` runs every package with a `dev` script, including the desktop app. It therefore needs Rust/Tauri prerequisites; use package filters when only API, web, or bot work is needed.
- The web and bot dev launchers wait up to 60 seconds for the API. Set `SHADOW_CLOUD_SKIP_API_WAIT=1` only when intentionally running either without a reachable API. Desktop dev waits for both API and web before starting Tauri.
- Docker Compose publishes web at `http://localhost:38080` and API at `http://localhost:38081/v1`, despite the root README listing `3000` and `3001` in its Docker section. SQLite data and uploaded saves persist in the `shadow-cloud-data` volume.

## Repository Constraints

- Keep tracked text files LF-only; `.gitattributes` enforces `eol=lf` even on Windows.
- Treat the root manifests, app scripts, and CI workflow as authoritative. `apps/web/README.md` is untouched create-next-app boilerplate and does not describe this monorepo's actual startup flow.
