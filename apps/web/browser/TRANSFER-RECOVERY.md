# SOL-10 Transfer Recovery Verification

Implemented against the committed SOL-9 fixture and SOL-17 application state.
No commits or staging. SOL-10 remains In Progress pending main review.

The review follow-up below changes only unstaged files. Main's already-staged
implementation is preserved; no commits or full workspace run were made here.

## Review Race Fixes

Two async races were reproduced before correction:

- **P1:** An unrelated pre-transfer read delivered either before or after an
  uncertain transfer response changed `identityReadId`. Both schedules incorrectly
  enabled Save while the recovery-triggered read had never completed. The focused
  regression reported `2 failed`, with `Received element is not disabled`.
- **P2:** The real workspace unmounted its editor on `canEdit=false` or a stable
  campaign switch while a metadata PATCH was pending. Resolving that PATCH with
  200 still posted the retained transfer target. Both regressions reported
  `expected fetch to be called 1 times, but got 2 times` (`2 failed`).

Exact executed red commands (the P2 test was subsequently expanded/renamed):

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test src/components/campaign-settings-editor.test.tsx -t "background read delivered"
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test src/components/campaign-details-workspace-seat-order.test.tsx -t "pending metadata submission"
```

P1 now uses a fresh, unpredictable `transferRecovery` UUID generated when the
outcome is known. The page echoes a single well-formed UUID as `identityReadId`
only after the authoritative read. Recovery requires exact nonce, stable campaign
ID and campaign-number matches. Ordinary reads have no correlation marker; old,
unknown or superseded markers cannot unlock the editor. Every recovery/read retry
uses another nonce and replacement navigation, including repeated same-route
uncertainty. The nonce is not secret and carries no ownership or executable intent;
the notice remains a fixed enum.

P2 now invalidates an editor-local generation synchronously on unmount/campaign
change. Every awaited metadata/transfer response and body read, and both metadata
caller continuations, check that generation before another mutation, acceptance
or navigation. Already-issued metadata can still commit; the stale continuation
cannot transfer, replay, roll back or navigate. Twelve real-workspace schedules
cover metadata/transfer headers and bodies, including metadata-only saves, under
both permission loss and stable campaign switches.

The two standards comments were also addressed: a shared pure
`isKnownRejectionStatus` predicate centralizes the status list without removing
callers' distinct body validation; an editor-local `acceptSnapshot` helper keeps
accepted draft/Overlord state and refs synchronized.

Review verification commands:

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test src/components/campaign-settings-editor.test.tsx src/components/campaign-details-workspace-seat-order.test.tsx "src/app/games/[gameNumber]/page.test.tsx" "src/app/api/games/[gameNumber]/transfer-host/route.test.ts"
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser transfer-recovery.spec.ts
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web typecheck
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web lint
```

Results: **110 focused tests passed in 4 files (2.84s)**, **9 recovery browser
scenarios passed (1.4m)**, and web typecheck/lint passed. The repeated same-route browser case also
asserts distinct correlation nonces, fresh authoritative reads, cleared targets
and no automatic transfer replay. Renumber recovery still observes Notes PATCH
to `/api/games/43/metadata` returning 200 and verifies replacement history.
No full workspace suite was run in this follow-up.

## Executed Red Regression

Before changing application behavior, the browser opened campaign 42, changed
its number to 43, selected Browser Successor, saved metadata and attempted the
transfer. The adapter confirmed rejection with HTTP 409. The browser then
dismissed the dialog, cancelled the remaining transfer draft, switched to Notes,
and saved another edit.

Exact command:

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser transfer-recovery.spec.ts
```

Actual failure on port 38263:

```text
PATCH /api/games/42/metadata 200
POST /api/games/43/transfer-host 409
PATCH /api/games/42/metadata 404
Expected: http://127.0.0.1:38263/api/games/43/metadata
Received: http://127.0.0.1:38263/api/games/42/metadata
1 failed
```

This was an executed subsequent-action failure, not merely a stale field or a
router-spy assertion. The test was then strengthened to verify replacement
history navigation, the destination notice, current ownership, fresh target
selection and a persisted Notes edit at the new number.

Further executed red checks exposed:

- Missing post-transfer authoritative reads for same-route uncertainty.
- The proxy treating malformed responses as success/rejection, and throwing on
  a lost upstream connection (7 failing route checks before correction).
- Metadata responses with missing/invalid numbers proceeding to transfer, and
  metadata transport failures escaping the editor (5 failing editor checks).
- Disabled dialog buttons losing focus in Chromium during a confirmed retry,
  causing Escape not to dismiss the dialog.
- Settled reconciliation failures falling through to Next's generic error
  screen rather than retaining the uncertainty explanation.

Each correction was followed by focused passing checks. During initial test
authoring, locator fixes were also needed for the select's full accessible name,
Next's separate route-announcer alert, and hydration after document reload.
Those setup failures were not counted as application regressions.

## Behavior Decisions

- The existing metadata operation still precedes the separate transfer. A
  confirmed metadata rejection prevents transfer. A valid returned campaign
  number, not the typed draft number, addresses the transfer.
- Completed metadata is removed from the pending transfer payload and retained
  as the committed draft. Same-number confirmed rejection refreshes server
  props while retaining the dialog and transfer-only retry. Cancellation,
  section unmounts and later edits do not replay committed metadata.
- The proxy labels only well-formed 400/401/403/404/409/422 rejections as
  `outcome: rejected`. Unknown statuses, malformed bodies, empty success
  responses and connection failures become HTTP 502 / `outcome: unconfirmed`.
  The client also checks successful transfer campaign ID, returned number and
  intended new Overlord against the active attempt.
- Confirmed rejection after renumbering replaces the current history entry
  with the new numbered URL and `transferOutcome=metadata-saved-transfer-failed`.
  Recovery never refreshes the obsolete numbered route or creates an alias.
- Uncertainty clears the target and dialog, locks editing/section changes and
  reconciles through the current numbered route using the exact correlation nonce
  described above. An unequal marker or changed field values alone cannot unlock
  the editor; each attempt requests a new nonce-bearing URL with `router.replace`.
- The read marker is not a domain revision and is never a React workspace key.
  SOL-17's stable campaign key and Seat Order baseline/revision remain intact.
  Existing draft reconciliation protects sibling section drafts.
- Only three fixed notice enum values are accepted. Notices contain no raw
  upstream messages, transfer target or executable retry intent. The page uses
  authoritative data and permissions, never notice-derived ownership.
- A parent campaign error boundary catches both layout and page read failures.
  It retains a whitelisted outcome summary without falsely claiming ownership
  was reloaded. Its only action is a document reload; it cannot retry a mutation.
- If metadata itself has an unconfirmed result, transfer is not attempted and
  metadata is not replayed. Editing stays locked until a deliberate document
  reload. If the number changed but the response was lost, the former URL may
  404; discovering an unknown new number or providing old-number aliases is
  outside this ticket.
- Successful transfers retain the existing success navigation/refresh behavior.
  The dialog holds focus while controls are disabled and restores meaningful
  focus for dismissal, retry and completed reconciliation.

## Initial Verification

All package checks used the pinned Node 24.18.0 / pnpm 11.11.0 execution path:

```bash
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test:browser
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web typecheck
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web lint
npx --yes pnpm@11.11.0 --package=node@24.18.0 --package=pnpm@11.11.0 dlx pnpm --filter @shadow-cloud/web test src/auth.test.ts src/components/campaign-notes-editor.test.tsx src/components/campaign-settings-editor.test.tsx src/components/campaign-details-workspace.test.tsx src/components/campaign-details-workspace-seat-order.test.tsx src/components/campaign-configuration-shell.test.tsx src/components/campaign-workspace-tabs.test.tsx src/components/seat-order-editor.test.tsx "src/app/games/[gameNumber]/page.test.tsx" src/app/games/error.test.tsx "src/app/api/games/[gameNumber]/metadata/route.test.ts" "src/app/api/games/[gameNumber]/transfer-host/route.test.ts" "src/app/api/games/[gameNumber]/seat-order/route.test.ts"
git diff --check
```

| Check                     | Actual result                                                         |
| ------------------------- | --------------------------------------------------------------------- |
| Complete Playwright suite | `18 passed (1.6m)`                                                    |
| Selected fast suite       | `Test Files 13 passed (13)`, `Tests 254 passed (254)`, duration 4.28s |
| Web typecheck             | Route types generated, tsc exit 0                                     |
| Web lint                  | `eslint .`, exit 0, no diagnostics                                    |
| Whitespace check          | Exit 0                                                                |

These are the initial pre-review results, not a full-suite rerun after the race
fixes. The follow-up commands/results are recorded above.

## Browser Matrix

The nine tests in `transfer-recovery.spec.ts` passed again after review. Recovery
URLs now additionally carry `transferRecovery=<nonce>`:

| Scenario                              | Observed result                                                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renumber + confirmed rejection        | URL becomes `/games/43?transferOutcome=metadata-saved-transfer-failed`; history length unchanged; Back reaches the preceding session URL, not obsolete `/games/42`                                              |
| Subsequent action in that scenario    | No restored target; cancellation, exit/re-entry and section switching work; Notes PATCH goes to `/api/games/43/metadata` with 200; notes and notice survive document reload; owner unchanged; only one transfer |
| Same-number confirmed rejection       | In-dialog retry sends transfer only; dismissal restores focus; committed name survives section unmount; later Notes edit and freshly selected successful transfer do not repeat the name write                  |
| Uncertain, not committed, same number | Fresh authoritative read; target cleared; another Notes edit succeeds at 42; no automatic transfer retry                                                                                                        |
| Uncertain, committed, same number     | Fresh authoritative read removes former-Overlord editing controls; no automatic retry                                                                                                                           |
| Uncertain, not committed, renumbered  | Fresh read at 43; cleared target; subsequent Notes edit succeeds at 43; no automatic retry                                                                                                                      |
| Uncertain, committed, renumbered      | Fresh read at 43; former-Overlord editing controls removed; no automatic retry                                                                                                                                  |
| Repeated same-route uncertainty       | Each explicit user attempt requires another authoritative read and fresh selection; distinct nonces are verified even when the number, outcome and ownership values are unchanged                               |
| Failed reconciliation, same number    | Explicit read-failure/uncertainty explanation, no editable or retryable transfer controls; user reload recovers without another transfer                                                                        |
| Failed reconciliation, renumbered     | Same safe failure and user-reload behavior at 43, including the campaign layout's read failure                                                                                                                  |

The original SOL-9 browser scenario and all eight adapter contract checks also
passed in the initial 18-test run. The nine-test matrix has ten rows because subsequent-action assertions
are part of the renumbered confirmed-rejection test, not a separate test.

## Scope And Remaining Review

All application changes are within `apps/web`: the settings editor, transfer
proxy, passive page/error notices and read-marker pass-through. The fixture only
adds an in-process `detailFailure` switch. ESLint ignores Playwright's generated
`test-results` directory to avoid a race with its replacement during a run.

No backend, auth policy, stable-ID routing, old-number alias, combined mutation,
global draft store, dependency or CI changes were required. The existing CI
browser command discovers all new scenarios automatically. Fixtures retained
their isolated auth credentials, source snapshots and OS-assigned ports; each
run logged process/connection/snapshot cleanup, including failure probes.
After the complete run, independent connection attempts to all 20 recorded
Next/upstream ports returned `ECONNREFUSED`. Filesystem checks confirmed the
original stale-number failure snapshot and the final renumbered/same-route
failure-recovery snapshots were absent. The git index was empty at the initial
handoff; the review follow-up preserves main's subsequently staged implementation.

Main's review of these follow-up fixes remains pending. Main reported the full
workspace passing before these fixes; it was not rerun here.
No full workspace suite, production build or remote CI run was executed here.
This is browser/Next/auth/proxy integration evidence with a controlled HTTP
adapter, not proof of production Prisma/SQLite transactions or live OAuth.
