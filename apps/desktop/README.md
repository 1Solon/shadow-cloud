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

SOL-32 adds the Companion's Device-session sign-in, durable non-secret
preferences, explicit Companion-root onboarding, and immutable Campaign-folder
ownership. Browser handoff and one-use pasted tokens both exchange for a scoped,
rotating Device session. The refresh secret lives in the operating-system vault;
when that vault is unavailable, the session is deliberately memory-only. SQLite
never stores credentials.

Campaign observation and save transfer are still deferred. The interface remains
truthfully empty after onboarding, and its transfer controls remain unavailable
until the observation and reconciliation slices land in SOL-33 through SOL-35.
Tray, autostart, notifications, and updater installation remain in SOL-36 and
SOL-37 under
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

Open `http://127.0.0.1:1420/?scenario=onboarding`, `active`, `offline`, `paused`,
or `update-required`. These explicitly labelled, synthetic engine adapters
exercise the production React boundary without real accounts, files, or
transfers. No query parameter activates them in a production build;
`check-bundle.mjs` verifies that their code and campaign fixtures are absent.

## Device sessions and onboarding

The Companion starts read-only and cannot send a turn before the user completes
the final onboarding review. Sign-in creates a ten-minute, single-use handoff.
The normal path opens an approval page in the system browser and polls with a
separate secret. A one-use token can instead be copied from that page and pasted
into a system that cannot open the browser. Successful exchange returns only the
three Companion scopes: observe campaigns, download saves, and submit turns.
Access tokens are short-lived; refresh secrets rotate on every use.

Signing out first persists non-secret signed-out intent, attempts server
revocation, clears both vault and in-memory credentials, and preserves the
Companion root, owned Campaign folders, saves, and non-secret preferences. If a
vault deletion fails, later protocol checks retry it without ever restoring the
retained secret. If the vault is unavailable at sign-in, a banner explains that
the session lasts only until the process exits.

## Campaign-folder ownership

Each campaign receives exactly one direct child of the configured Companion
root, named from its server number and name plus a stable ID-derived suffix. A
complete `.shadow-cloud-campaign.json` marker is written atomically and is the
only proof of ownership. A moved folder with the same marker is rediscovered;
an unrelated target, malformed marker, duplicate matching markers, path escape,
or symlink is an explicit error. Existing directories are never adopted,
renamed, merged, or overwritten. Rediscovery keys only on the immutable Campaign
ID, so later server-side name changes cannot strand a correctly marked folder.

Only canonical direct children of the canonical root are accepted. Server names
cannot supply path separators, traversal components, control characters, Windows
reserved characters, or reserved device names, so the same ownership rule holds
on Linux, macOS, and Windows.

## Ownership and protocol

`engine/` is a webview-independent Rust crate. A single native coordinator holds
it under a mutex; snapshot queries and typed commands use the same state owner.
Its watch subscription retains the latest full snapshot instead of growing an
unbounded event queue. React listens before requesting its initial snapshot,
accepts only newer revisions, and unsubscribes on unmount.

`src/engine/port.ts` is the presentation contract, mirrored by the serializable
Rust types. `src/engine/native.ts` is the only frontend module importing Tauri.
Capabilities permit event subscription only: the webview has no filesystem,
store, shell, dialog, or HTTP permission. Browser opening, directory selection,
vault access, SQLite, and network I/O all remain behind the Rust engine.

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
