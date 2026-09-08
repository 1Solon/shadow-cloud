# Save Inspection And Password Recovery

## Public Boundary

`apps/api/src/save-format/index.ts` exports `inspectSave(bytes, archiveKey)`.
The key is operator-supplied archive configuration, not a regime password.
The API reads its UTF-8 value from `SHADOW_CLOUD_SAVE_ARCHIVE_KEY`; provision it
through the server's secret configuration. No default key or credentials are
stored in this repository. Missing configuration returns a safe 503 response.

Inspection returns a SHA-256 source identity computed from the actual archive
bytes and an allowlist of regime IDs, names, current markers, eligibility and
reasons. Each regime ID hashes the source identity and parsed array index. It
is valid only for those bytes, not a persistent regime identifier or Cloud seat.
Passwords, their lengths, object graphs, offsets and archive names are not returned.

`GET /v1/games/:gameId/save-inspection` uses the authenticated actor and requires
the current Overlord, without an uploader or Shadow Override exception. It reads
the latest version from real storage with a size cap, then rechecks Overlord and
latest-file identity before returning. The web proxy also requires a session and
both responses disable caching. No-save is 404, denied access is 401/403,
superseded inspection is 409, format failures are 422 and unavailable storage or
configuration is 503. Inspection remains read-only; dedicated reset/undo operations
are described below. Public downloads remain unchanged.

## Format Evidence

Primary references consulted during implementation:

- [Microsoft MS-NRBF, revision 13.0](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nrbf/75b9fe09-be15-475f-85b8-ae7b7558cfe5): serialized stream header, typed classes and metadata reuse, binary arrays, primitive values, strings, references, null runs and message end.
- [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT): sections 4.3, 4.4 and 6.1, ZIP framing, CRC, data descriptors and traditional encryption.
- The previously validated local experiment recorded in SOL-18. This is evidence for one save, not a claim of compatibility with every Shadow Empire release.

Recovered temporary files were `nrbf_inspect.py`, `test_nrbf_inspect.py`,
`save_report.py` and `create_reset_test.py`. They remain untouched outside the
repository. Do not copy the report or creation script wholesale: they contain
private paths, identifying data and credentials.

Their sanitized parsing logic is preserved as the TypeScript port in
`internal/nrbf.ts`: little-endian framing; bounded 7-bit UTF-8 string lengths;
typed class metadata and ClassWithId reuse; object-ID registration; compact
primitive blocks and null runs; and one-hop reference resolution after full
framing. The port adds allocation, work and recursion limits, duplicate-name/ID
checks, missing-reference checks and static errors. It never loads assemblies,
instantiates CLR types, or invokes BinaryFormatter/.NET deserialization.

The recovered experiment's traditional-encryption algorithm and descriptor
framing are preserved in `internal/archive.ts` and the synthetic fixture writer.
The fixture writer is independently checked using Python's `zipfile` decryption
and CRC validation; it uses fresh random values, not real or stored test credentials.

Observed application layout (names and types only):

- Root: `WindowsApplication1.DataClass`.
- Root `PasswordsOn`: Boolean; false rejects inspection for reset purposes.
- Root `Turn`: Int32, the index of the current regime in `RegimeObj`.
- Root `RegimeObj`: one-dimensional, zero-based array.
- Entries: null or `WindowsApplication1.RegimeClass`.
- Regime `AI`: Boolean; true excludes the regime from returned targets.
- Regime `Name`: string; regime `PassWord`: string or null. An absent or empty password is ineligible. No Cloud-account mapping is inferred.

The production reader was run read-only on the original local experiment save:
30,313,878 decompressed bytes, 553,337 objects, 894,094 references. The observed
record tags were 0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16 and 17. The final
reader returned five human regimes, one current marker and four eligible targets
in approximately 0.7 seconds locally. It did not print names/passwords or write
the save. The original and modified saves are not repository fixtures.

## Supported Profile And Limits

The ZIP profile is deliberately narrow: one deflated, traditionally encrypted
entry, flags 9, local header at zero, signed 16-byte data descriptor, matching
central metadata and no extra fields/archive comments. ZIP64, multi-entry,
multi-volume, AES and other layouts fail closed. The archive-controlled member
name is compared as bytes but never used as a filesystem path. Decryption checks
the DOS-time check byte (bit 3), deflate consumption, exact output length and CRC.

- Archive: at most 25 MiB; decompressed payload: at most 64 MiB, enforced during inflation as well as from metadata.
- Individual strings: at most 1 MiB; cumulative decoded string bytes: at most 32 MiB.
- Objects: at most 750,000; records: at most 4,000,000; member/element work: bounded to at most 6,000,000 slots (array expansion also caps at 4,000,000).
- Nesting: at most 128; rank: at most 32; members per class: at most 4,096. Primitive blocks are bounded by remaining input bytes and never expanded into objects.
- Regime array: at most 10,000 slots, single-dimensional/zero-based; nonempty names at most 256 UTF-16 units, without control characters.

References and cycles do not cause recursive graph traversal. Shared password
values are ineligible for reset; names aliasing password objects are rejected.
Unsupported or ambiguous layouts fail closed rather than falling back to a byte
search. These are safety ceilings, not assertions about the game's format limits.
The synchronous reader's CPU work is finite but can block the API event loop;
production load should be monitored before raising any ceilings.

## SOL-21 Handoff

`replacePassword(bytes, archiveKey, { sourceId, regimeId, password })` now returns
verified encrypted archive bytes. No password, old length or offsets are returned.
It re-resolves eligibility and ownership from the actual bytes. The implementation
uses the following preserved experimental method, rather than hardcoded offsets.

Preserved experimental patch method: the NRBF BinaryObjectString stores an object
ID followed by a 7-bit encoded UTF-8 byte length and string body. Record the prefix
and body bounds while parsing, verify the target's ownership/reference safety,
then replace only that length/body span. Equal-byte-length edits must preserve
every byte outside the body; differing lengths must preserve the prefix/suffix
sequences outside the complete string encoding. No experimental IDs, indices,
offsets, names or password lengths belong in production selection logic.

Rebuild by deflating the patched payload, computing CRC32, encrypting a fresh
12-byte encryption header plus compressed bytes, updating the local/central
size and CRC fields, the signed descriptor and the end record's central offset.
Preserve member naming and supported archive metadata. Independently decrypt,
CRC-check and fully reparse output before staging publication. This summarizes
the recovered creation script without retaining credentials or save-specific data.

The prior user-confirmed in-game result establishes only an equal-length reset of
one current regime. Non-current targets, shorter/longer passwords, valid character
rules, save/reopen, passing the turn and undo remain SOL-21/SOL-18 release checks.
Do not invent those constraints from synthetic fixtures or the prior experiment.

## Password Input Evidence (SOL-21)

On 2026-09-07 the locally installed `ShadowEmpire.exe` was inspected statically
with `dnfile`/`dncil`, without executing game code or deserializing any save.
Executable SHA-256: `60d7bb341acbf9c7108cd80c6b0ed6933b024e7bfedbe434853027055b68c29f`.
`GameLoopMainWindowClass2.HandleMouseClick` records version 132 / subversion `a`.
Its login branch reads `PasswordsOn`, then `RegimeObj[RealTurn].PassWord`:

- IL 0x02d2-0x0316: an absent password is assigned the result of VB `InputBox` directly.
- IL 0x0320-0x036b: existing-password entry uses `InputBox`, applies VB `UCase` to the entry and stored value, then calls `CompareString` with text-compare false.
- There is no fixed-length check, trim, or character filter in that branch. Comparison is case-insensitive via uppercasing; a case-only change is not evidence that an old password stops working.

This is primary code evidence for variable-length text, not a completed in-game
compatibility test. The first application profile accepts **1-128 printable ASCII
characters (U+0020-U+007E)**, unchanged, including spaces. The 128-character ceiling
is an application safety/usability cap, not a discovered game limit. Non-ASCII,
controls, empty values and longer entries are rejected; no claims are made about
their in-game compatibility. ASCII avoids unverified input-method, normalization
and locale-sensitive Unicode behavior. SOL-24 must check spaces, punctuation,
case behavior and boundary lengths in the installed game before release.

Automated tests independently decrypt rebuilt output using Python `zipfile`
(including its CRC check), compare the complete expected payload, and verify
shorter/equal/longer edits including a two-byte NRBF length prefix. Production
also decrypts/CRC-checks rebuilt bytes with the bounded reader, compares the
entire patched payload, and reparses the output before staging. No Python or
game executable is a production dependency.

## Reset API And Lifecycle

`POST /v1/games/:gameId/password-reset` accepts `{ fileVersionId, sourceId,
expectedSaveBaseline, regimeId, password, confirmed: true }`. Inspection now
supplies `expectedSaveBaseline` as well as byte-scoped source/target identities.
Use the authenticated actor, never an actor supplied in the body. Reset does not
grant the Overlord generic-replacement permission. Errors are static and the web
proxy allowlists response fields instead of forwarding arbitrary upstream data.

The first transactional write fences `organizerId`, `turnRevision` and
`saveRevision`. Under that lock reset checks the latest version/path/revision,
rehashes actual source bytes and verifies staged bytes. Publication updates the
existing FileVersion path/hash, increments `contentRevision` and `saveRevision`,
and sets `replacedAt`/`replacedById`; turn state, records and clocks are untouched.
Audit uses `FILE_REPLACED` with `operation: password-reset`, reset/source/output
identities and regime metadata only. The existing `SAVE_REPLACED` notification
adds `replacement.passwordRecovery: { operation: reset, regimeName }`; the bot
explains fresh download and replay. The password is shared privately, not delivered.

Migration `20260907140000_password_reset_recovery` adds `PasswordReset` and
`SaveCleanup`. Immediate pre-reset bytes stay at their prior immutable path.
There is one ACTIVE opportunity, not a rollback stack. Subsequent resets, generic
replacements and turn transitions close recovery inside their successful
transaction and queue the source path for deletion. Failed mutations roll back
closure. Cleanup checks canonical/active references under a database write lock,
treats absent files as already cleaned, and retains failed deletions for retry.
The GamesFileService worker runs at startup and every 30 seconds, including when
the undo UI is never opened. It also reconciles deleted campaigns and superseded
turns. Staged reset output is registered for cleanup **before writing** with a
one-hour lease, removed from the queue only in the publication transaction, and
made due immediately on failure. Never republish a recovery path directly.

All in-game release acceptance beyond the prior single equal-length experiment
remains unverified in SOL-24: non-current regimes, different lengths, new access /
old rejection (not merely case differences), unchanged other regimes, save/reopen,
turn handoff and undo. Public save downloads and coordination-only acceptance of
later uploads are intentional and unchanged.

## Undo Contract (SOL-22)

`GET /v1/games/:gameId/password-reset` is current-Overlord-only and no-store.
It returns `{ undo: null }` or `{ undo: { resetId, outputId, outputRevision,
expectedSaveBaseline, regimeName } }`. Availability checks the latest file,
revision, active turn record and actual source/output hashes, then rechecks
ownership and the baseline after I/O. Unavailable storage returns a static 503,
not a password or recovery path. This operation needs no archive key: recovery
restores a byte-exact archive already validated when the reset was created.

`POST /v1/games/:gameId/password-reset/undo` requires those identity/baseline
fields and `confirmed: true`. It revalidates current ownership, latest output,
ACTIVE recovery and current turn under the same first-write fence. Both source
and output are rehashed at commit. The source is copied to a new staged path,
verified again, and published with incremented replacement metadata. Recovery
is consumed and source/old-output deletion is queued in that same transaction.
The restored staged path is never a cleanup target. A second reset's undo
restores only its immediate source; there is no reactivation of older records.

The campaign's Saves panel checks availability automatically, then provides the
previous-password warning, explicit confirmation, Cancel, success and retryable
error/conflict states.
The audit operation is `password-reset-undo`; replacement notifications use
`passwordRecovery.operation: undo`. Responses and messages contain no passwords.

## Focused Verification (2026-09-07)

No full suite, production migration, deployment or commit was performed.
The following commands passed in the shared checkout; `npm exec` was used because
`pnpm` was not on the shell PATH.

```sh
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/api exec vitest run test/save-format.test.ts test/games-save-inspection.test.ts test/games-file-replacement.test.ts test/games-save-concurrency.test.ts test/games-turn-upload-safety.test.ts test/turn-mutations-upload.test.ts test/games-turn-records.test.ts test/games-controller-file-replacement.test.ts
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/web exec vitest run src/components/save-password-reset.test.tsx src/components/save-password-undo.test.tsx src/components/save-regime-inspection.test.tsx 'src/app/api/games/[gameNumber]/save-inspection/route.test.ts' 'src/app/api/games/[gameNumber]/password-reset/route.test.ts'
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts test/notification-server.test.ts
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/desktop exec vitest run src/sync/sync-engine.test.ts src/api/shadowCloudApi.test.ts
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/web exec playwright test browser/save-inspection.spec.ts
```

Results: API **142 tests / 8 files**, web **19 / 5**, bot **26 / 2**, desktop
**33 / 2**, and **1 Playwright test** covering both 1280px and 390px layouts.
The API transport-unavailable log is expected fault-injection coverage, not a
test failure. Initial red runs, lint errors and an outdated ambiguous browser
selector were fixed before these green runs.

```sh
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/api typecheck
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/web typecheck
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/bot typecheck
npm exec --yes pnpm@11.11.0 -- --filter @shadow-cloud/desktop typecheck
```

All four passed. Focused ESLint checks on changed API/web production files and
`git diff --check` also passed. Review was performed locally; no independent
review agent was available in this session. Release still requires SOL-24's
actual human game-acceptance evidence and full regression checks, and SOL-23's
desktop feature acceptance. Apply the recovery migration alongside SOL-19's
revision migration before deploying the API. Archive configuration remains
`SHADOW_CLOUD_SAVE_ARCHIVE_KEY` as documented above.
