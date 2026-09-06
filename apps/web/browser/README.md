# Authenticated Campaign Browser Tests

For the implementation's executed commands and results, see
[SOL-9 verification](VERIFICATION.md).

## Fresh Checkout

Use Node **24.18.0** (the version in CI) and the root `packageManager` pin,
**pnpm 11.11.0**. Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @shadow-cloud/web test:browser:install --with-deps
pnpm --filter @shadow-cloud/web test:browser
```

`--with-deps` installs Chromium's OS libraries on supported Linux distributions
and may require sudo. On a machine with those libraries already installed, use
`test:browser:install` without the flag. The pinned Playwright package downloads
its own matching Chromium; no system browser, existing browser profile or
running development server is used. Missing libraries or a missing browser are
errors, not skipped tests. Network access is needed for dependency/browser
installation and the application's existing Google font loading.

If pnpm/Node 24 are not on PATH, the following runs the same package command
without changing the system runtime:

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser:install
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser
```

Use Node 24 here: the local Node 26.8.1 installation stalled during Playwright
1.58.2 browser extraction; installation succeeded on Node 24.18.0. On the local
unsupported Linux distribution, Playwright's downloaded Ubuntu 24.04 fallback
Chromium ran successfully with the available system libraries.

## What Runs

`campaign.spec.ts` opens the real `/games/42` route in Chromium, verifies the
authenticated initial HTML and `/api/auth/session`, edits Notes through the
existing UI and Next metadata proxy, then performs `page.reload()` and reopens
Notes to verify the committed value. Removing the session cookie must remove
the SSR editing control and make the same proxy return 401 without forwarding
another mutation. No browser request interception or mocked router is involved.

`upstream.spec.ts` checks the owned HTTP adapter's metadata and transfer
outcomes against fresh authoritative HTTP reads. These fast contract checks
do not launch Chromium or Next. Run only the browser scenario, or repeat it:

```bash
pnpm --filter @shadow-cloud/web test:browser campaign.spec.ts
pnpm --filter @shadow-cloud/web test:browser campaign.spec.ts --repeat-each=2
pnpm --filter @shadow-cloud/web test:browser upstream.spec.ts
```

The existing CI workflow installs Chromium **with OS dependencies** and runs
`test:browser` after the existing fast checks. Browser tests remain separate
from Vitest's `src/**/*.test.*` suite. Web lint/typecheck include this fixture.
Failures retain a trace, screenshot and Next log in the ignored
`apps/web/test-results/` directory; the next run replaces these diagnostics.

## Isolation And Auth

- Each browser test gets a new browser context, random auth secret, in-memory
  upstream, temporary source snapshot and two OS-assigned loopback ports.
- Next runs via its custom-server API in development/webpack mode, using the
  actual app config, layout, page, auth callbacks and route handlers. This
  verifies route integration, not a production build or standalone deployment.
- Only `src`, `public`, the app package/config files, root package version and
  base tsconfig are copied. `.env*` files are excluded; no root personal env,
  `.next`, database or developer session is copied. Installed `node_modules`
  are linked for resolution. Source changes are snapshotted as they exist in
  the worktree, including the current `seatOrderBaseline` response contract.
- The Next child receives an explicit environment allowlist, temporary HOME
  and TMPDIR, dummy OAuth identifiers, a fresh `AUTH_SECRET`, and the owned
  upstream URL. Inherited `NODE_OPTIONS`, database URLs, auth settings and
  developer API URLs are not forwarded. Do not use the app's dev/build/start
  dotenv wrappers here.
- The cookie is produced by **NextAuth v4's real `encode`**: an authenticated,
  encrypted JWT (JWE), with normal issued/expiry claims and `userId` matching
  the real callbacks. It is not a plaintext session or an auth-policy bypass.
  OAuth identity provisioning is outside this scenario. The real proxy mints
  an HS256 API token; the upstream verifies its signature, expiry, required
  claims and current Overlord subject before accepting a mutation.
- Fixture teardown waits for Next to exit, closes upstream connections and
  deletes the snapshot, including `.next`, on success and assertion/setup
  failure. The child also handles SIGTERM, SIGINT and parent IPC disconnect;
  teardown has a bounded hard-kill fallback. Playwright owns and closes its
  browser/context. Diagnostic artifacts are intentionally retained on failure.
  As with any process cleanup, simultaneous SIGKILL or machine failure cannot
  run cleanup handlers.

## SOL-10 Adapter Use

Import `test` and `expect` from `./fixture`, then configure the per-test
`campaign.upstream` before navigating or taking an action:

```ts
campaign.upstream.metadata.push({ kind: "success" });
campaign.upstream.transfer.push({
  kind: "confirmed-failure",
  status: 409,
  message: "Overlord transfer rejected.",
});
await page.goto(`${campaign.url}/games/42`);
// Perform the real identity edit in the UI; assert the recovery destination.
```

The two outcome queues are consumed independently, one entry per authorized
mutation, with success as the default. Both accept:

- `{ kind: "success" }`: commit and return a successful JSON response.
- `{ kind: "confirmed-failure", status?: number, message?: string }`: reject
  without committing (default HTTP 409).
- `{ kind: "ambiguous", committed: true | false }`: choose whether the change
  commits, then destroy the upstream response connection. The unchanged Next
  proxy currently exposes this as a server/transport error, not a confirmed
  domain rejection. SOL-10 must reconcile authoritative state, not auto-retry.

`campaign.upstream.game` is the authoritative typed `GameDetail`; customize or
replace it to arrange a scenario. SSR page/layout reads and forwarded writes
use this same state. A metadata renumber immediately moves the detail and
mutation endpoints to the new number; the old number returns 404. Transfer
changes Overlord identity, seat roles and baseline revision. Notes edits do
not advance the seat baseline. `requests` records HTTP method/path and verified
mutation subject/body (never tokens), for checking obsolete-number writes or
accidental retries alongside visible browser behavior.

The adapter intentionally implements only campaign detail, metadata and
transfer HTTP endpoints. It has no remotely accessible fixture-control route,
database, production failure-injection hook or generic scenario framework.
It models only what these browser cases need, not all API validation or turn
rules. It is **not proof of Prisma/SQLite behavior**, and SOL-9 does not
implement SOL-10 recovery or change SOL-17 editor semantics.
