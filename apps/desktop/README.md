# Shadow Cloud Companion

The greenfield Tauri 2 application lives here. Its identity is
`com.shadowcloud.companion`; it does not import the previous desktop application's
state, tokens, or sync implementation. User save folders are never migrated or
removed by this foundation.

The accepted interface is Variant A at `0abb6c9` on `prototype/sol-30`, recorded in
[SOL-30](https://linear.app/1solon/issue/SOL-30/01-prototype-and-approve-the-companion-interface).
That branch remains a disposable design reference. Production has one compact
web-style card layout, not the prototype's variants or switcher. Application
icons are generated from `apps/web/src/app/favicon.ico`.

## Current slice

SOL-31 establishes the shell, protocol handshake, revisioned engine boundary,
presentation, and native build definitions. It does **not** implement device
sign-in, persistent preferences, campaign discovery, save transfer, tray,
autostart, or updater installation. The native application is truthfully signed
out with no campaigns. Preferences last for the process lifetime. Those features
remain in SOL-32 through SOL-37 under
[SOL-29](https://linear.app/1solon/issue/SOL-29/spec-rebuild-shadow-cloud-companion-as-a-greenfield-cross-platform-app).

## Development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @shadow-cloud/desktop dev
```

The native shell starts even if the API is unavailable. Its development launcher
loads the root environment and defaults `SHADOW_CLOUD_API_URL` to
`http://127.0.0.1:3001`. Release builds use HTTPS and the hosted service unless a
different HTTPS base URL is supplied at compile time. React does not receive
that URL, access credentials, touch files, or make HTTP requests.

For deterministic Linux browser checks:

```sh
pnpm --filter @shadow-cloud/desktop dev:ui
```

Open `http://127.0.0.1:1420/?scenario=active`, `offline`, `paused`, or
`update-required`. These explicitly labelled, synthetic engine adapters exercise
the production React boundary without real accounts, files, or transfers. No
query parameter activates them in a production build; `check-bundle.mjs` verifies
that their code and campaign fixtures are absent.

## Ownership and protocol

`engine/` is a webview-independent Rust crate. A single native coordinator holds
it under a mutex; snapshot queries and typed commands use the same state owner.
Its watch subscription retains the latest full snapshot instead of growing an
unbounded event queue. React listens before requesting its initial snapshot,
accepts only newer revisions, and unsubscribes on unmount.

`src/engine/port.ts` is the presentation contract, mirrored by the serializable
Rust types. `src/engine/native.ts` is the only frontend module importing Tauri.
Capabilities permit event subscription only: no frontend filesystem, store,
shell, dialog, or HTTP plugin. Future side effects belong behind the engine.

The root `package.json` release is the protocol source for both the Rust build
and `GET /v1/companion/protocol`. Only an exact match connects. Missing or invalid
responses fail closed; a known mismatch remains read-only through later network
failures. A match never silently resumes a paused application or changes upload
preferences. The endpoint is not an authorization mechanism; future transfer
endpoints must enforce device scopes and the same protocol gate server-side.

## Checks and distributions

```sh
pnpm --filter @shadow-cloud/desktop test
pnpm --filter @shadow-cloud/desktop test:engine
pnpm --filter @shadow-cloud/desktop typecheck
pnpm --filter @shadow-cloud/desktop build
node apps/desktop/scripts/check-release.mjs
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
pnpm --filter @shadow-cloud/desktop build:native --bundles appimage
```

`build` produces the frontend without requiring native libraries, keeping the
monorepo build portable. `build:native` packages the application. The native CI
matrix targets Windows x64 NSIS, universal macOS DMG, and Linux x64 AppImage on
Ubuntu 22.04. Native process startup checks do not claim installer UX, rendering,
tray, vault, notification, or game compatibility coverage; full native acceptance
remains SOL-37.

OS publisher signing and macOS notarization are deferred. Release updater
artifacts still require the existing separate Tauri signing key; this does not
make the application publisher-signed. Publication validates, rather than
rewrites, the release version. Bump the root manifest and native Cargo manifest
and lockfile together before tagging. Publish all matching desktop artifacts
before activating the matching server protocol; rollout gating is completed in
the release milestone, not by this foundation.

AppImages built on a newer rolling-release host are local smoke artifacts, not
proof of Ubuntu 22.04 compatibility. The baseline distribution must be built on
[the oldest supported Linux base](https://v2.tauri.app/distribute/appimage/).
