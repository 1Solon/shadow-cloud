# Simplified Turn Reminders Design

## Goal

Reduce the turn reminder policy to two timing values that have direct, predictable meanings:

- **Target hours** controls when the first reminder is due.
- **Reminder hours** controls the interval between later reminders.

For a target of 24 hours and a reminder interval of 12 hours, reminders are due at hours 24, 36, 48, and so on while the turn remains open.

The existing reminders-enabled toggle remains unchanged. Reminders never advance or skip a turn automatically.

## Policy Model

The persisted game policy will contain:

- `turnTargetHours`, defaulting to `24`.
- `turnReminderHours`, defaulting to `24`.
- `turnRemindersEnabled`, defaulting to `true`.

The existing `turnReminderGraceHours` field will be removed. The existing `turnReminderRepeatHours` field will be renamed to `turnReminderHours` so the public API and stored model use the same simpler terminology.

All hour values remain positive safe whole numbers and retain the existing upper bound.

## Scheduling Behavior

When reminders are enabled, a newly opened turn receives:

```text
nextReminderAt = startedAt + turnTargetHours
```

After a reminder is claimed, the following reminder receives:

```text
nextReminderAt = current poll time + turnReminderHours
```

Using the current poll time preserves the existing behavior for overdue reminders: the scheduler sends one reminder and schedules forward instead of emitting a burst of missed reminders.

When reminders are disabled, `nextReminderAt` is `null`.

The existing scheduler validation, optimistic claim, outbox creation, retry behavior, active-turn checks, and pending-delivery cancellation on turn transition remain unchanged.

## Policy Updates

Changing either timing value or the enabled toggle recalculates the single open turn in the same database transaction as the game update:

- Before any reminder has been claimed, schedule from `startedAt + turnTargetHours`.
- After at least one reminder has been claimed, schedule from `lastReminderAt + turnReminderHours`.
- When reminders are disabled, clear `nextReminderAt`.

Changing `turnReminderHours` therefore affects later reminders but does not move an unreminded turn's first reminder. Changing `turnTargetHours` affects the first reminder but does not move a turn that has already been reminded.

## Data Migration

The migration will preserve campaign-specific repeat settings by moving each existing `turnReminderRepeatHours` value into `turnReminderHours`. Existing grace values will be discarded.

Open turn schedules will be recalculated under the simplified policy:

- Records with no claimed reminders use `startedAt + turnTargetHours`.
- Records with a claimed reminder and a valid `lastReminderAt` use `lastReminderAt + turnReminderHours`.
- Records belonging to games with reminders disabled use `null`.

Closed turn history, reminder counts, last-reminder timestamps, notification deliveries, and audit history remain intact.

## API, Bot, and Web Changes

The API create and metadata-update payloads will expose `turnReminderHours` and stop accepting or returning the grace and repeat fields. Query payloads and shared types will make the same replacement.

The Discord `/init` command will expose:

- `turn_target_hours`
- `turn_reminder_hours`

The web campaign settings will show:

- **Turn target hours** — when the first reminder is sent.
- **Reminder hours** — time between later reminders.
- **Turn reminders enabled** — whether scheduled messages are sent.

The campaign briefing will show the target, reminder interval, and enabled state, with no grace value.

## Compatibility

This is an intentional internal and public contract cleanup. The removed grace and repeat property names will not be maintained as aliases because retaining them would preserve the conceptual complexity this change is removing. The API, bot, and web applications are versioned and deployed together in this workspace.

## Testing

Tests will cover:

- First-reminder calculation at exactly the target.
- Repeated-reminder calculation using the reminder interval.
- Disabled reminders returning no schedule.
- New and transitioned turn-record schedules.
- Recalculation after target, reminder, and enabled-policy changes.
- Data migration preserving repeat values, removing grace, and recalculating open turns.
- API validation and query payloads using only the new fields.
- Discord command registration and request mapping.
- Web settings editing, descriptions, briefing display, and metadata proxy validation.
- Existing scheduler concurrency, stale-candidate, missing-Discord, outbox, retry, and cancellation behavior remaining green.
