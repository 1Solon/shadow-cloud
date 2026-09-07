# Password Reset Release Acceptance

[SOL-24](https://linear.app/1solon/issue/SOL-24) is the release gate for
[SOL-18](https://linear.app/1solon/issue/SOL-18). **Human acceptance is pending.**
Passing automation does not authorize deployment or closing either issue.

## Evidence Boundaries

- Prior human evidence: one equal-length reset of one current regime in one real
  save allowed access. Old-password rejection, other regimes, save/reopen, turn
  handoff and undo were not established. Its exact game/save version was not
  recorded; do not assign it the version of the separately inspected executable.
- Static evidence: the installed executable inspected on 2026-09-07 records
  version 132/subversion a; SHA-256 and IL references are in
  [save-format.md](save-format.md#password-input-evidence-sol-21). Its login
  branch compares uppercased strings without trimming or a fixed-length check.
  This is not an in-game result or a compatibility claim for other builds.
- Application profile: 1-128 printable ASCII characters, U+0020-U+007E, including
  spaces. 128 is our cap, not an established game maximum. Empty, control,
  non-ASCII and longer inputs are rejected by the application; their game
  behavior is unverified. Case-only replacement cannot prove old-value rejection.
- Automated fixtures are synthetic data, not playable game saves. API tests use
  real temporary SQLite/storage; browser tests use isolated Next with synthetic
  upstream responses and intercepted reset/undo requests, not a live API/game.
  Independent ZIP/CRC and exact payload comparisons establish structural
  preservation for tested fixtures, not general in-game compatibility.

## Private Preparation

No playable artifacts were prepared in this session. Existing documentation
names private temporary experiment scripts, but supplies no safe source location
or secret-loading procedure. Do not search for credentials, run the old creation
script blindly, or copy private reports into the checkout. No production service,
campaign or migration should be touched for this exercise.

1. In a private local directory outside the checkout and desktop sync folders,
   create a fresh disposable Shadow Empire game with password protection and at
   least two human regimes. Keep all players under the tester's control. Record
   the displayed game version, executable SHA-256, platform, save creation
   version and any known save-format metadata; mark unavailable metadata unknown.
2. Give both human regimes known disposable baseline credentials using the game.
   Keep values only in a private note, never tickets, filenames, URLs, screenshots,
   logs or repository files. Use a baseline length between 1 and 128 so shorter,
   equal and longer cases are possible. Confirm both original logins before
   freezing a baseline save. If the game cannot produce this baseline, stop and
   report that preparation blocker rather than reusing a real campaign.
3. Keep an immutable private baseline and its SHA-256. Use neutral names such as
   `baseline.se1` and `C-short-reset.se1`; names must not contain credentials or
   identifying real-campaign data. Keep a private case-to-credential manifest.
4. Have an operator provide an isolated Shadow Cloud API/web/desktop environment,
   disposable accounts/campaign and notification destination, temporary database
   and storage. Apply migrations `20260907130000_add_save_revision` and
   `20260907140000_password_reset_recovery` only to that isolated database through
   the normal migration process. Provision `SHADOW_CLOUD_SAVE_ARCHIVE_KEY` using
   existing secret configuration, never command-line literals or repository edits.
   Lack of that environment/key is a blocker, not a reason to publish a key.
5. Seed a separate disposable campaign from the same baseline for each independent
   case through the normal setup/upload flow. Capture its turn baseline after
   seeding: active seat/player, round, current turn record and timing. Ordinary
   upload advances the turn; do not use it to simulate a same-turn reset or undo.
6. Use the campaign Saves panel as its Overlord: Inspect regimes, verify the
   current marker, choose the intended eligible regime, enter the private test
   value, check the target/restart confirmation, then Reset password. Exercise
   Cancel first and confirm no replacement. Never infer regime identity from a
   Cloud seat. Coordinate stopping any current play before confirming.
7. Download the new canonical `.se1` using the normal public download link.
   Compare its SHA-256 with the published content hash and record the replacement
   revision privately. Copy only this disposable artifact into the installed
   game's normal saved-games directory (use the location where that installation
   just saved the baseline; no universal OS path is assumed). In Shadow Empire's
   load-game UI select the exact new filename, not a cached/older copy.
8. For each login attempt reload a fresh copy of the reset artifact so an already
   authenticated session does not mask rejection. For a non-current target, play
   onward in a disposable branch until its login is reached. Keep the unchanged
   canonical reset output available separately for the immediate-undo case.

Do not attach any saves or credential manifests to Linear, even disposable ones.
Public downloads are an intentional product policy: use only disposable data in
the isolated campaign. Delete private artifacts/notes and isolated storage after
observations are captured and recovery cleanup has been checked.

## Human Matrix

All rows below are **NOT RUN in this session**. Each reset case starts from its
own baseline; new and old values must differ beyond case. Record pass/fail for
each observation, not just whether a save opened.

| Case | Operation | Required observations |
| --- | --- | --- |
| C-short / C-equal / C-long | Current human regime; shorter/equal/longer than its known baseline | New login accepted; old rejected on fresh load; current marker correct; other regime credentials unchanged |
| N-short / N-equal / N-long | Non-current human regime; same three length relations | Reach target by playing onward; new accepted and old rejected; intervening regimes keep original access |
| ASCII | Repeat for current and non-current targets | Test lengths 1, 127 and 128; leading/trailing/internal spaces, punctuation, mixed case, and a value covering all 95 printable ASCII characters. Record each result separately, including case variants; no trimming/truncation |
| State | For all reset cases, then representative current/non-current save/reopen and handoff | Cloud turn baseline unchanged by reset; map, units, resources, diplomacy, round and unrelated regimes match baseline before play; save/reopen retains access; pass turn onward and return to target with reset preserved |
| Undo | Immediate undo of unchanged latest reset output | Warning and explicit confirmation; downloaded archive SHA-256 equals original baseline; original login restored and reset login rejected; Cloud turn/records/timing unchanged; second undo unavailable |
| Stale undo | Separate runs: later generic replacement, ordinary turn upload, second reset | Old undo unavailable/conflicts without changing latest bytes or turn state; second reset has only its own immediate-source undo, not a history stack |
| Web / download / notification | Complete reset and undo using isolated services | Target and restart warning, Cancel, confirmation, success after refresh; public unauthenticated download yields canonical bytes; audit/notification identifies operation/regime and contains no password |
| Desktop | Original uploader and another player; active and waiting states | Same-ID reset/undo revisions detected; safe local files preserved and updated download obtained; verify actual collision-suffixed filename; unknown unfinished bytes pause sync/upload and remain byte-identical |
| Desktop recovery | Follow [desktop-sync.md](desktop-sync.md) | Pause sync, move unfinished copy outside campaign folder, resume and load actual new download; replay turn, not just relaunch game; no automatic retry of rejected old upload after 409 |
| Cleanup | Isolated operator checks after undo, supersession and expired staging | Obsolete recovery paths deleted by worker (startup/30-second interval), failed deletion retried; canonical/active recovery preserved; abandoned staging lease is one hour; record counts/states only, no paths or file contents |
| Rejection | Disposable unsupported/malformed inputs and invalid password profile | Static error; no canonical bytes/revision/turn change; distinguish API parser/resource-limit rejection from an actual game load rejection. Do not treat a game-rejected output as acceptable merely because CRC passes |

The state comparison before play must not confuse normal changes caused by
passing turns with reset-induced changes. For byte evidence, automation compares
decompressed payload sequences outside the selected encoded string and validates
rebuilt archives independently; encrypted archive equality is expected for undo,
not for reset. Real-save structural preservation remains unobserved here; any
private comparison must report only pass/fail, never dump the decoded graph.

## Returning Observations

Reply on SOL-24 using this safe template, one row per case/variant:

| Date / tester | Case | Game build / executable SHA-256 / platform | Save creation version / known format | New accepted / old rejected | Other access / state | Reopen / handoff | Undo / turn unchanged | Result / safe failure summary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pending | pending | pending | pending | NOT RUN | NOT RUN | NOT RUN | NOT RUN | Human verification outstanding |

Use credential labels and lengths/character categories only for these disposable
tests. Do not report actual values, real campaign password lengths, archive keys,
private paths, save contents or unredacted screenshots. Record unsupported build
results separately; never broaden the supported profile from a parser-only pass.

## Automated Validation (2026-09-07)

Commands below ran from the repository root. `pnpm` was absent from PATH, so the
wrapper selects the repository-pinned version. `TURBO_FORCE=true` bypassed cache;
each repository task reported zero cache hits.

```sh
TURBO_FORCE=true npm exec --yes pnpm@11.11.0 -- pnpm typecheck
npm exec --yes pnpm@11.11.0 -- pnpm --filter @shadow-cloud/web test:browser
TURBO_FORCE=true npm exec --yes pnpm@11.11.0 -- pnpm lint
TURBO_FORCE=true npm exec --yes pnpm@11.11.0 -- pnpm test
```

| Check | Exact result |
| --- | --- |
| Repository typecheck | 4/4 package tasks passed |
| Applicable lint | 3/3 tasks passed: API, bot, web; desktop has no lint script |
| Full browser suite | 20/20 passed, zero retries; includes reset/undo refresh and 1280px/390px inspection checks |
| Full repository tests, run exactly once | 1,151 passed, 2 failed / 1,153 tests; 92 passed, 1 failed / 93 files |
| API in that run | 568 passed, 2 failed / 570 tests; 34 passed, 1 failed / 35 files |
| Web in that run | 428/428 tests, 38/38 files passed |
| Bot in that run | 78/78 tests, 8/8 files passed |
| Desktop in that run | 77/77 tests, 12/12 files passed |

Both failures were in `apps/api/test/seat-order-baseline.test.ts`: upload draft
invalidation and same-seat upload/replay. Its storage stub ignored `prepare`, so
publication's required `saveCleanup.delete` found no staging lease. The narrow
fix makes that stub call `input.prepare` with its returned path and implement
`removeFileOrThrow`, matching the current storage contract. No production guard,
assertion or behavior was weakened.

```sh
npm exec --yes pnpm@11.11.0 -- pnpm --filter @shadow-cloud/api exec vitest run test/seat-order-baseline.test.ts
npm exec --yes pnpm@11.11.0 -- pnpm --filter @shadow-cloud/api exec prettier --check test/seat-order-baseline.test.ts
npm exec --yes pnpm@11.11.0 -- pnpm --filter @shadow-cloud/api typecheck
git diff --check
git diff --no-index --check /dev/null docs/password-reset-acceptance.md
```

Targeted rerun: **59/59 tests, 1/1 file passed**. Post-fix API typecheck, Prettier
and diff checks passed.
At this validation checkpoint the full suite had not been rerun after the
test-only correction; its original result was not all-green. The required commit
hook subsequently reran the repository test task, as recorded below.
Expected injected transport/JSON/configuration logs appeared in passing tests;
Playwright also emitted Node's `module.register()` deprecation warning.

The production save-format, real database/storage reset/undo/concurrency, web
workflow and desktop conflict suites passed in the full run. Actual connected
game/API/bot/desktop acceptance, playable artifact preparation, real-save byte
checks and every human matrix observation remain release blockers. No campaign
saves, credentials or archive key were read into new artifacts or published. No
deployment, production migration or human acceptance was performed.

### Commit-hook verification

Implementation commit `4cdb688` passed the existing pre-commit lint and test
hooks. The first commit attempt stopped because `pnpm` was absent from PATH;
retrying through `npm exec --yes --package=pnpm@11.11.0 -- git commit ...`
supplied the pinned tool without bypassing hooks.

The hook's repository test task passed all four packages: API reran uncached
with **570/570 tests in 35 files passing**; unchanged web, bot and desktop tasks
reused the successful results above. Final aggregate: **1,153/1,153 tests in
93 files passing**, with three package cache hits. Lint passed all three tasks
(API uncached, web/bot cached). Human acceptance remains pending.
