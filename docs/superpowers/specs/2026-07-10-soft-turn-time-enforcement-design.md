# Soft Turn Time Enforcement Design

## Goal

Add soft turn-time enforcement to Shadow Cloud. Each campaign has a target turn duration and a recurring Discord reminder policy. The system records the actual duration of every active-player turn and shows recent timing history on the campaign page.

This feature informs and nudges players; it never blocks uploads, automatically skips a player, or otherwise enforces a hard deadline.

## Campaign Policy

Add these fields to `Game`:

- `turnTargetHours Int` with a default of `24`.
- `turnReminderGraceHours Int` with a default of `12`.
- `turnReminderRepeatHours Int` with a default of `24`.
- `turnRemindersEnabled Boolean` with a default of `true`.

All durations are positive safe whole-hour values. The first reminder becomes due at:

```text
turn start + target hours + grace hours
```

After a reminder is queued, the next reminder becomes due after the configured repeat duration. The scheduler does not issue catch-up reminders for every interval missed during downtime. At most one reminder is queued when processing an overdue record, and the next due time is based on the current processing time.

The timing policy applies independently to each campaign. Editing the policy does not rewrite completed history.

## Configuration

The Discord `/init` command accepts optional positive whole-hour parameters for target, grace, and repeat duration. Omitted parameters use the `24/12/24` defaults. New campaigns start with reminders enabled.

The organizer-authorized web metadata editor exposes the same three durations and an enable/disable control. Existing organizer and Shadow-override authorization rules apply. The API, rather than UI visibility, enforces authorization.

Changing the current campaign policy recalculates the open turn's reminder state:

- Disabling reminders clears `nextReminderAt`.
- Enabling reminders with no previous reminder sets `nextReminderAt` from the turn's original `startedAt`, target, and grace.
- Changing target or grace before the first reminder performs the same calculation.
- Changing repeat duration after at least one reminder sets `nextReminderAt` from the most recent reminder time and the new cadence.
- If the resulting time is already past, one reminder is due on the next scheduler pass.

## Turn Records

Add a `TurnRecord` model and a `TurnCompletionReason` enum. A record contains:

- Campaign relation and round number.
- The active `GamePlayer` entry and user identifiers where still available.
- Snapshot values for seat number and player display name so history remains understandable after roster changes.
- `startedAt` and nullable `endedAt` timestamps.
- A nullable completion reason.
- `reminderCount`, `lastReminderAt`, and `nextReminderAt`.
- Creation and update timestamps.

Completion reasons are:

- `SAVE_UPLOADED`
- `SKIPPED`
- `RESIGNED`
- `REPLACED`
- `REASSIGNED`

Only an open record has no `endedAt`. Application-level transactional checks ensure a campaign has at most one open record. Indexes support recent-history queries and scans for due open records.

Creating a campaign creates its initial open record with the organizer as the active player, round one, and the first due time calculated from the campaign policy.

The migration adds one open record for each existing campaign with a turn state. It uses `TurnState.updatedAt` as the best available start time and the current active-player data. No earlier history is synthesized because existing audit data cannot reconstruct every turn boundary reliably.

## Turn Transitions

All operations that change the active player use one shared turn-record transition routine within the operation's existing Prisma transaction. The routine:

1. Loads and validates the open record for the current active seat.
2. Closes it with the transaction timestamp and the operation's completion reason.
3. Cancels any pending nudge delivery associated with the closed record.
4. Creates a new open record for the next active player and current resulting round.
5. Calculates the new record's first reminder time from the campaign policy.

Save upload uses `SAVE_UPLOADED`; organizer skip uses `SKIPPED`; active-player resignation uses `RESIGNED`; replacing the user occupying the active seat uses `REPLACED`; and an administrative seat-order change that selects a different active seat uses `REASSIGNED`.

Changing metadata, transferring host status, replacing an inactive player, or reordering seats while preserving the same active seat does not close or reset the current record. A save upload that wraps to the first seat closes the old record under its old round and opens the next record under the incremented round.

The active-player update and record transition must succeed or fail together. A failed upload or administrative operation leaves both `TurnState` and timing history unchanged.

## Reminder Scheduling

The API runs a short-interval polling worker following the lifecycle pattern already used by `BotNotificationsService`. It selects open records whose `nextReminderAt` is due and whose campaign still has reminders enabled.

For each candidate, a transaction rechecks that:

- The record remains open.
- The record still matches the campaign's active player entry.
- Reminders remain enabled.
- `nextReminderAt` is still due.

If valid, the transaction creates a `TURN_NUDGE` `NotificationDelivery`, increments `reminderCount`, records `lastReminderAt`, and sets `nextReminderAt` to the processing time plus the repeat duration. This atomic update prevents repeated polling from enqueuing the same interval twice. The existing notification-delivery claim and retry behavior handles bot or Discord outages.

The nudge payload identifies the turn record, campaign, active player, elapsed hours, target hours, round, and campaign URL. The bot posts the reminder in the campaign's Discord thread, mentions the active player's Discord identity when available, and states how long the turn has been active relative to its target.

If the active player has no Discord identity or the campaign has no linked thread, the worker advances the reminder schedule without creating an undeliverable queue entry and logs the reason. Add `CANCELLED` to `NotificationDeliveryStatus`; closing a turn marks still-pending nudge deliveries for that record as cancelled so obsolete reminders are not retried after the turn advances. A delivery already being processed may race with a transition, but no later reminder is scheduled for the closed record.

## API And Web UI

Game list and detail payloads expose the campaign timing policy and current turn start time so callers can show deadline state. The game-detail payload additionally includes the open record and the 25 most recent completed records, newest first.

The campaign page adds a recent-turn timing table with:

- Round.
- Seat and player snapshot.
- Start time.
- Finish time, or `In progress` for the open record.
- Duration, calculated from timestamps.
- Completion reason.
- Number of reminders queued.

The active row calculates elapsed time against the current time. The table remains readable on narrow screens using the existing campaign-page visual language rather than introducing a separate dashboard design.

The metadata editor shows target, grace, repeat cadence, and reminder status. Successful updates refresh the campaign data. Validation and authorization failures remain inline and do not alter the displayed policy.

## Error Handling And Concurrency

DTO and web-proxy validation reject non-integers, zero, negative values, and values outside JavaScript's safe integer range. The API returns existing authentication and authorization responses for unauthorized policy edits.

Turn transitions validate that the open record corresponds to the active turn state. A mismatch fails the transaction with a conflict rather than silently manufacturing history. Reminder polling treats stale candidates as no-ops.

Notification failure never rolls back a completed turn transition or policy edit. Nudge deliveries follow the existing bounded retry policy. A permanently failed delivery remains visible in notification-delivery state, while the turn record retains the number of reminders that were scheduled.

## Verification

Prisma and API tests cover:

- Schema defaults and migration of an existing active turn.
- Initial record creation.
- Positive whole-hour validation.
- Organizer and Shadow-override policy authorization.
- Policy updates and open-record due-time recalculation.
- Every completion reason and resulting next-round value.
- No reset for metadata edits, inactive-player replacement, host transfer, or harmless reorder.
- Transaction rollback when a turn transition fails.
- One queued reminder per due interval under concurrent or repeated polling.
- No catch-up flood after downtime.
- Disabled reminders, missing Discord identity, and missing thread behavior.
- Pending nudge cancellation when a turn closes.

Bot tests cover endpoint authentication, payload parsing, active-player mentions, elapsed/target wording, campaign links, and missing-thread handling.

Web tests cover API payload mapping, proxy validation, policy editing, inline failures, active elapsed-time rendering, completion labels, the 25-record limit, and responsive table behavior.

Run the repository CI-equivalent checks in order:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Run `pnpm build` because the change affects API payloads, Next.js server rendering, and bot command registration.

## Out Of Scope

- Bonus-time balances, accrual, or spending.
- Donut charts, graphs, and aggregate player statistics.
- Hard deadlines, blocked uploads, or automatic skips.
- Per-player timing policies within one campaign.
- Direct messages or notification destinations outside the campaign thread.
- Reconstructing timing history from before this feature is deployed.
