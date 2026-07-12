# Turn Reminders Guidance Design

## Goal

Explain what the Turn Reminders section controls and what each setting means,
without making the Campaign configuration workspace visually busy again.

## Scope

Only the `Turn Reminders` configuration editor receives new guidance. Identity &
Progress, World Setup, Seat Order, Notes, and the read-only Campaign briefing are
unchanged.

## Presentation

Add a compact terminal-style briefing immediately above the Turn Reminders fields:

> Sets the expected turn pace and controls when automated reminder messages are sent.

The briefing uses subdued orange terminal text, a small uppercase cue such as
`REMINDER SCHEDULE`, and no new card, filled panel, or heavy border.

Each field receives a short description beneath its label:

- **Target turn hours:** The expected time allowed for each player's turn.
- **Reminder grace hours:** Extra time after the target before the first reminder.
- **Reminder repeat hours:** Time between later reminders while the turn remains open.
- **Turn reminders enabled:** Send automated reminder messages using this schedule.

Descriptions remain visible rather than hidden in tooltips so they are easy to scan,
work on touch devices, and do not require discovery.

## Accessibility

Each description has a stable ID and its corresponding input uses
`aria-describedby`. The section briefing is ordinary visible text associated with
the Turn Reminders editor through its existing section heading and document order.

## Responsive Behavior

Descriptions wrap within the existing field-label column. They must not widen the
editor or introduce horizontal scrolling at narrow widths.

## Behavior And Data

This is explanatory UI only. Values, validation, dirty-state handling, endpoints,
payloads, permissions, saves, and reminder scheduling behavior remain unchanged.

## Verification

Use TDD to assert the briefing text, all four descriptions, and every
`aria-describedby` relationship before changing production code. Run the Campaign
settings editor, configuration shell, and details workspace suites, then web lint,
typecheck, and formatting checks.
