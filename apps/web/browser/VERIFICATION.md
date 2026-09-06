# SOL-9 Verification

Executed locally on 2026-09-06. No commits or staging. No full workspace test
suite or production build was run. Existing staged SOL-17 application files
and the concurrent bot work were not edited.

## Runtime And Installation

The system runtime is Node 26.8.1 and has no pnpm command on PATH. Its browser
installer stalled after downloading, so verification used CI's Node 24.18.0
through pinned pnpm. The actual download succeeded with:

```bash
npx --yes pnpm@11.11.0 dlx node@24.18.0 apps/web/node_modules/@playwright/test/cli.js install chromium
```

Output confirmed Chrome for Testing **145.0.7632.6**, Chromium and headless shell
revision **1208**, and FFmpeg revision **1011** downloaded successfully.
Playwright warned that this Linux distribution is unsupported and selected its
Ubuntu 24.04 x64 fallback. The downloaded browser then ran successfully; no
missing-library bypass, skip or system-browser substitution was used.

The following package installation command also passed with the installed
browser. The runtime probe printed `v24.18.0`; frozen install printed
`Already up to date` and exited 0:

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser:install
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm exec node --version
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm install --frozen-lockfile
```

## Tests And Checks

These are the exact final test/check commands:

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser campaign.spec.ts --repeat-each=2
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web typecheck
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web lint
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test src/auth.test.ts src/components/campaign-notes-editor.test.tsx src/components/campaign-settings-editor.test.tsx src/components/campaign-details-workspace.test.tsx src/components/campaign-configuration-shell.test.tsx src/components/campaign-workspace-tabs.test.tsx src/components/seat-order-editor.test.tsx "src/app/games/[gameNumber]/page.test.tsx" "src/app/api/games/[gameNumber]/metadata/route.test.ts" "src/app/api/games/[gameNumber]/seat-order/route.test.ts"
git diff --check
```

Results:

| Command                                         | Actual result                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `test:browser`                                  | `9 passed (14.8s)`: 1 Chromium scenario, 8 HTTP adapter checks        |
| `test:browser campaign.spec.ts --repeat-each=2` | `2 passed (25.1s)`, fresh server/context/snapshot for each repetition |
| `typecheck`                                     | `Types generated successfully`, tsc exit 0                            |
| `lint`                                          | `eslint .`, exit 0 with no diagnostics                                |
| Selected Vitest files                           | `Test Files 10 passed (10)`, `Tests 187 passed (187)`, duration 4.46s |
| `git diff --check`                              | Exit 0, no whitespace errors                                          |

## Observations

Each successful browser run printed:

```text
SSR authenticated; signed proxy PATCH 200; document reload retained notes; anonymous SSR read-only and PATCH 401.
```

The scenario verified the initial document's authenticated editing control,
real NextAuth session user `browser-overlord` with `isShadowOverride: false`,
and one metadata PATCH authenticated by the real proxy's verified HS256 token.
It changed `Initial browser campaign notes.` to
`Notes committed through the real browser proxy.`, saw the existing success
confirmation, performed a document reload, and read the same saved text in the
rendered page and reopened Notes textarea. After clearing cookies, initial HTML
had no editing control and the metadata proxy rejected the mutation before it
reached the adapter.

Before implementing adapter persistence, this same browser test deliberately
returned HTTP 200 without saving. It failed at the post-reload visible-notes
assertion (`element(s) not found`), demonstrating sensitivity to persistence
rather than merely the success response. Adding persistence made it pass.
The transfer adapter response check also caught missing production-contract
fields (`gameId` and `player`); the adapter response was corrected before the
final 9/9 run.

## Cleanup

The failed persistence probe and final successful runs logged teardown. After
completion, filesystem checks confirmed these snapshots did not exist:

```text
/tmp/shadow-cloud-browser-uyV2uk  (intentional failing persistence probe)
/tmp/shadow-cloud-browser-dRLxvG (9/9 run)
/tmp/shadow-cloud-browser-zIJKH4 (repeat 1)
/tmp/shadow-cloud-browser-vc20LQ (repeat 2)
```

Independent TCP connection attempts to each of their Next/upstream port pairs
returned `ECONNREFUSED`:

```text
35339 / 37607
37113 / 40755
40699 / 39469
35921 / 45353
```

`git diff -- apps/web/src apps/api` was empty: the pre-existing staged SOL-17
work was preserved, without unstaged application changes from this ticket.

## CI And Scope

The existing `.github/workflows/ci.yml` now installs Chromium with
`pnpm --filter @shadow-cloud/web test:browser:install --with-deps` and executes
`pnpm --filter @shadow-cloud/web test:browser`. The remote workflow itself was
not dispatched; local execution validated the same package runner on its
pinned Node version. Existing workflow checks remain unchanged.

This proves browser/Next/auth/proxy integration with an owned in-memory HTTP
adapter. It does not prove production Prisma/SQLite persistence, OAuth account
provisioning, production-build behavior, or SOL-10 transfer recovery.
