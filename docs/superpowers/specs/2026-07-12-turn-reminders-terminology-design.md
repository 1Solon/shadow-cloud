# Turn Reminders Terminology Design

## Goal

Rename the Campaign details user-facing term **Turn Protocol** to **Turn Reminders**.

## Scope

- Update the configuration navigation label to `Turn Reminders`.
- Update the Campaign briefing disclosure label to `TURN REMINDERS`.
- Update matching user-facing test expectations and test descriptions.
- Keep the internal `turn-protocol` section identifier unchanged.

## Behavior

This is a terminology-only change. Section routing, reminder settings, API payloads,
permissions, validation, and editor behavior remain unchanged.

## Verification

Use TDD to update the relevant expectations first, confirm they fail against the old
labels, then update the production labels. Run the Campaign briefing, configuration
shell, settings editor, and workspace tests, followed by web typecheck and lint.
