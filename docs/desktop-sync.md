# Desktop Save Replacements

Password reset and undo replace the canonical save without advancing the turn
or changing its file-version ID. Desktop sync observes `contentRevision`, with
the existing `replacedAt` comparison retained for previously stored state.
The original uploader is not exempt from replacement handling.

## Obtaining the Updated Save

When local files are known, unchanged downloads or uploads, normal sync obtains
the replacement. It preserves the canonical filename when available and uses
the existing numbered suffix on collisions, leaving old files untouched. The
download status and completed download ledger record the actual local filename
when a collision requires a suffix. Use the newly
downloaded copy, not an older file with the unsuffixed name.

When unrecognized local bytes exist, sync leaves them untouched and pauses that
campaign's replacement/upload with a visible explanation:

> The latest save changed. Your local files have been preserved. Pause sync and move unfinished saves outside the campaign folder, then sync again to obtain the updated save, or open the campaign page and download it. Stop and restart the current turn from the updated save. Uploading a turn played from the old copy could undo this password reset.

Restart means replay the current turn from the updated save, not merely relaunch
Shadow Empire. Keep preserved unfinished copies outside the synced campaign
folder. The Overlord shares the replacement password privately; desktop does
not reveal or separately store it.

## Conflicts and Recovery

- A server upload conflict (HTTP 409) blocks automatic resubmission of the same
  local bytes, even after polling obtains a newer save baseline. Refreshing a
  baseline is not conflict resolution.
- Replacement detection checks unknown local bytes regardless of modification
  time, including while another player is active.
- Failed downloads or atomic writes do not advance the downloaded revision or
  mark the bytes as synchronized. Subsequent sync retries against current detail.
- Download bytes are checked against the server content hash before writing.
  A replacement racing the download therefore cannot be recorded under the
  wrong revision when its bytes differ; sync reports the failure and retries
  on a later poll.
- Rapid resets and undo are ordinary observable revisions, even if their
  timestamps and file IDs are identical. Sync may skip superseded revisions.

Downloads remain public. These safeguards do not prove save ancestry or enforce
passwords in future uploads. A player can still submit work based on an old
copy through a later deliberate upload; coordination remains necessary.

## Verification

`apps/desktop/src/sync/sync-engine.test.ts` exercises the approved desktop
boundary (`runSyncOnce`, returned state, file/download bytes and upload requests).
Coverage includes same-ID reset/undo sequences, rapid revisions, original
uploaders, active/waiting players, preserved copies, pending work and recovery,
409 retry suppression, network/write failures, and download revision races.
The API adapter and sync-file tests provide adjacent contract coverage.

This is desktop regression evidence, not Shadow Empire compatibility acceptance.
In-game release verification remains tracked by SOL-24.
