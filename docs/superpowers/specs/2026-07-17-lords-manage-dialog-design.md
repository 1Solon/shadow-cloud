# Lords And Manage Lord Dialog Design

## Goal

Rename the user-facing Seat Order feature to Lords and replace the inline seat-management controls in campaign configuration with a focused, responsive Manage Lord dialog. Preserve the existing draft, save, ordering, permission, and API behavior.

## Terminology

All user-facing references to the feature use "Lords." This includes configuration navigation, headings, card titles, action labels, status text, save confirmation copy, and supporting descriptions.

Internal contracts remain unchanged. Route paths, request fields, TypeScript identifiers, API service names, and database concepts continue to use `seat-order` and seat-entry terminology. This avoids an unrelated contract migration.

Within the interface:

- An occupied entry is a lord.
- An unoccupied entry is an open position.
- The lord whose turn is current is the active lord.
- Reordering changes the lords' turn order.

## Lords List

The Lords list remains the primary overview and ordering surface.

- Each row shows the lord name or open-position state, order position, Overlord status, and active status.
- Each editable row retains its direct drag handle. Pointer, touch, and keyboard reordering behavior remains unchanged.
- The configuration presentation replaces `Manage seat N` with `Manage lord`. Its accessible name identifies the lord or open position so similarly named controls remain distinguishable.
- Selecting `Manage lord` opens the dialog for that row. Management actions are no longer expanded inline.
- The editor-level `Save lords` and `Cancel` actions continue to apply to the complete draft.

Read-only presentation continues to show the list without editing, management, or save controls.

## Manage Lord Dialog

The dialog follows the approved summary-first action-card direction and the existing orange terminal visual language.

### Summary

The header and summary identify the selected record and show:

- Lord name, or that the position is open.
- Current order position.
- Overlord status when applicable.
- Active or inactive status.
- Occupied or open-position status.

Summary values reflect the current local draft, including unsaved active-lord and ordering changes.

### Actions

The dialog presents three clearly separated actions:

- `Make active lord` is the primary action. It is unavailable when the position is open or the lord is already active.
- `Clear lord` is a secondary action. Its supporting copy explains that the lord is removed while the position remains open in the turn order.
- `Remove open position` is destructive. Its supporting copy explains that remaining positions will be renumbered.

Unavailable actions remain visible and include a concise reason. Reasons cover already-active lords, open positions, the last occupied lord, occupied positions, and newly cleared positions that must be saved before removal.

`Close` is the only footer action. The header close control, Escape, and backdrop click also dismiss the dialog.

### Action Flow

- `Make active lord` updates the existing draft, closes the dialog, and returns the user to the list where the new draft state is visible.
- `Clear lord` and `Remove open position` transition from the management dialog to the existing destructive confirmation dialog. The two dialogs are never stacked.
- Cancelling destructive confirmation returns to the Manage Lord dialog for the same entry.
- Confirming a destructive action updates the draft, clears the management selection, and returns to the list.
- Closing the management dialog without an action does not modify the draft.

When the Manage Lord dialog closes normally, focus returns to its triggering button if that button still exists. After a confirmed removal, focus moves to the Lords editor heading or another stable editor control because the trigger no longer exists.

## Responsive And Accessible Behavior

The dialog uses one summary column and one action column at all sizes, with a constrained desktop width and viewport-safe mobile spacing. Long names and explanations wrap without horizontal overflow.

The dialog provides:

- `role="dialog"`, `aria-modal="true"`, and a programmatic title.
- Initial focus on the close control or first available primary action.
- Escape dismissal.
- Focus containment while open.
- Focus restoration on dismissal.
- Distinct accessible names for management triggers.
- Text explanations for unavailable actions rather than color or disabled state alone.

The existing clear/remove confirmation remains the final safeguard for destructive draft changes.

## State And Validation

`SeatOrderEditor` remains the owner of the draft, dirty state, selected entry, pending confirmation, and save request. A local `ManageLordDialog` presentation component receives the selected entry's derived state and action callbacks. No generic dialog framework or API endpoint is added.

Existing eligibility rules remain authoritative:

- An open position cannot become active or be cleared.
- The active lord cannot be made active again.
- The final occupied lord cannot be cleared.
- An occupied position cannot be removed.
- A position cleared in the current draft cannot be removed until that clear is saved.
- Permission loss removes all editing and management controls and reports a clean external state.

Save errors remain inline in the Lords editor. A failed save leaves the draft and dirty state intact.

## Testing

Changes follow test-driven development. Component tests are updated before production code and are observed failing for the intended missing behavior.

Coverage includes:

- All relevant user-facing Seat Order labels becoming Lords terminology.
- Opening the dialog for the correct occupied or open entry.
- Rendering name, position, Overlord, active, and open states from the current draft.
- Closing through visible controls, Escape, and backdrop interaction.
- Restoring focus to the triggering management button when it still exists.
- Applying `Make active lord` and reflecting the updated draft in the list.
- Correct availability and explanatory copy for every eligibility rule.
- Transitioning to destructive confirmation without stacked dialogs.
- Returning to management after confirmation cancellation.
- Returning to a stable editor target after confirmed removal.
- Preserving drag-and-drop behavior, exact save payloads, dirty-state reporting, permission handling, and inline save errors.

Verification runs the focused SeatOrderEditor and campaign configuration tests first, then web typecheck and lint, followed by the relevant broader web test suite. Browser verification checks desktop and mobile dialog layout, keyboard interaction, focus behavior, and overflow.

## Out Of Scope

- Renaming internal route, service, database, or payload terminology.
- Changing turn-order business rules.
- Adding or inviting lords.
- Replacing drag-and-drop ordering with dialog-based position controls.
- Redesigning unrelated confirmation dialogs or configuration sections.
