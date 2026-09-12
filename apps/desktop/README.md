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

SOL-32 added the Companion's Device-session sign-in, durable non-secret
preferences, explicit Companion-root onboarding, and immutable Campaign-folder
ownership. Browser handoff and one-use pasted tokens both exchange for a scoped,
rotating Device session. The refresh secret lives in the operating-system vault;
when that vault is unavailable, the session is deliberately memory-only. SQLite
never stores credentials.

SOL-33 adds campaign discovery and automatic save reception after the final setup
review. Activation starts with the current Canonical save; later publications
are received in order, including turns published while this Companion was
offline or paused. Campaign cards show reception progress, actionable failures,
and cumulative archive content received. A missing current save can be explicitly
redownloaded. SOL-34 adds content provenance and explicit manual Turn submission.
SOL-35 adds cancellable automatic submission and native notifications.
Conflict resolution and recovery remain in SOL-36; tray, autostart, updater
installation, and full native acceptance remain in SOL-37 under
[SOL-29](https://linear.app/1solon/issue/SOL-29/spec-rebuild-shadow-cloud-companion-as-a-greenfield-cross-platform-app).

## Development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Keep the API, WebUI, and bot running, then start the Companion in another terminal:

```sh
pnpm --filter @shadow-cloud/desktop dev
```

The native shell starts even if the API is unavailable. Tauri development mode
uses the same root `.env` as `pnpm run dev`, including when launched directly with
`pnpm tauri dev` from this directory. API requests use `SHADOW_CLOUD_API_URL`, or
`http://localhost:<PORT or API_PORT or 3001>`. Browser approval uses
`SHADOW_CLOUD_WEB_URL`, then `AUTH_URL`, then `http://localhost:<WEB_PORT or 3000>`.
Restart Tauri dev after changing these settings. Only the resolved service URLs
are embedded in development builds, not other root environment values.

Packaged builds always use `https://shadow-cloud.solonsstuff.com` for both the API
and browser approval, ignore development URL overrides, and require HTTPS. This
follows Tauri's dev/build mode rather than Rust's debug/release optimization mode:
`tauri build --debug` still uses the hosted service. React does not receive these
URLs, access credentials, touch files, or make HTTP requests.

Development keeps its database under `development/` in the app data directory and
uses a separate operating-system vault entry, so local and hosted sessions cannot
be reused across environments. Existing packaged state and credentials are left
untouched; development signs in separately.

For deterministic Linux browser checks:

```sh
pnpm --filter @shadow-cloud/desktop dev:ui
```

Open `http://127.0.0.1:1420/?scenario=onboarding`, `active`, `receiving`, `offline`,
`paused`, `manual`, `automatic`, or `update-required`. These explicitly labelled, synthetic engine adapters
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

Settings also offers **Reset Companion**, with a confirmation step. It signs out
this Device session, forgets the selected Companion root, restores default
preferences, and returns to Welcome. Local saves, Campaign-folder ownership,
other sync-tracking records, and cloud campaigns are retained. Setup must be
completed again before transfers can resume. The settings reset and signed-out
intent commit in one SQLite transaction; a failed write leaves setup unchanged,
and a failed vault deletion cannot restore the previous session after restart.

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
it under a mutex; typed commands use that state owner, while snapshot queries
read its latest published projection without waiting for network or file work.
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
preferences. Campaign observation, ordered publication polling, and exact save
downloads enforce device scopes, campaign membership, and the same protocol gate
server-side. Access-token expiry refreshes the session once before retrying;
revocation requires sign-in again.

## Receiving saves

The API exposes `GET /v1/companion/campaigns`,
`GET /v1/companion/campaigns/:id/publications?after=N`, and an exact-content
download at `GET /v1/companion/campaigns/:id/saves/:fileId?revision=N&hash=...`.
File versions supply durable publication order independently of the website's
display retention limit. A replacement keeps its publication number and changes
the content revision. Pages contain at most 100 publications; each receive tick
handles one page per campaign and reports progress while a backlog remains.

Before receiving, SQLite records the activation baseline, publication identity,
content hash, and staging intent. Downloaded bytes must match the declared size
and SHA-256 digest. The engine flushes the staged file before atomically linking
it to a collision-free visible filename, then commits reception and the cursor
together. Interrupted work can resume from its durable intent; cleanup of hidden
staging aliases is also durable and retryable. Existing saves are never replaced.

Identical content can reuse a received file even after the player renames it.
Publication history remains in SQLite, so deleting an older file does not cause
it to reappear. Only the explicit current-save action restores deleted current
content. The archive figure counts distinct bytes received over time, including
content subsequently deleted by the player; it is not current disk usage. The
Companion does not prune player files.

Reception runs in Rust, with content discovery and hashing on a native worker.
Pause and other commands interrupt read-only receive requests and scans; rotating
credential exchanges finish before the next command. Missing or changed owned
folders require player attention. Signing out removes campaign projections and
stops reception while preserving files and durable receive history.

## Manual Turn submission

Complete scans classify `.se1` files by SHA-256 identity. Received or accepted
contents remain known after a rename, copy, or account change in the same Campaign
folder. Ignore decisions, authorization, cursors, and pending operations remain
account-specific. Two matching complete observations and a full read establish
stability; an incomplete scan preserves candidates and blocks sending. Candidate
cards show filename, modification time, size, and explicit Send, Ignore, or Restore.

Send rechecks the reviewed Campaign baseline and exact contents, records a random
operation key, and flushes immutable staging bytes before dispatch. The API commits
an immutable receipt in the same transaction as the Save publication and turn
advance. Replays bind account, Campaign, baseline, filename, size, and content hash;
replacement of the Canonical save cannot alter that receipt. A lost response is
resolved through authenticated read-only receipt lookup, with any retry retaining
the original operation key and staging bytes. A queued command interrupts receipt
lookups and prevents starting another POST; an already dispatched POST finishes.
Only resolved engine staging copies are reclaimed. Original player files remain
in place, including files edited while a submission is in flight.

The receive observation includes `baseline` and `canSubmit` facts owned by Rust.
Submission uses multipart `POST /v1/companion/campaigns/:id/submissions/:operationKey`
with `baseline`, `contentHash`, UTF-8 `filename`, and `file`. Receipt recovery uses
`GET /v1/companion/submissions/:operationKey`, including after Campaign membership
loss. The forward `companion_submission_receipts` migration is required for these
endpoints; historical migrations remain intact.

## Automatic Turn submission

Automatic sending defaults on globally. Each Campaign can inherit that preference
or explicitly use Automatic or Manual. One stable, unignored Turn candidate during
the player's current turn starts a visible 15-second countdown and a native
notification with Cancel. Native notification actions and sleep monitoring must be
available before a countdown can start; manual Send remains available otherwise.

Cancel retains the ordinary candidate and suppresses automatic sending for its
exact contents. It takes effect immediately even if recording it in SQLite fails;
the coordinator retries that write. Changed contents start from a new full window,
but cannot silently acquire a newer turn, Seat, or Canonical-save baseline.
Multiple candidates require the player to select or ignore contents. Existing
local work requires explicit Send after switching accounts.

Sleep, a stalled reconciliation, restart, or reconnection invalidates an elapsed
window. Reconciliation checks the account, current turn, baseline, and exact
contents again before staging. Undispatched automatic stages are abandoned after
restart; dispatched operations retain their immutable bytes and receipt identity.
Native Cancel callbacks carry the exact authorization and interrupt work before
waiting for the coordinator. No webview timer or notification handler can send a
file directly.

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
