# Manage Seat Modal Design

## Goal

Replace the inline seat-management controls in campaign configuration with a focused, responsive modal. Preserve the existing draft, save, ordering, permission, and API behavior.

## Terminology

The interface remains seat-centric. User-facing controls use “seat” rather than introducing “lord” or “position” terminology.

Internal contracts remain unchanged. Route paths, request fields, TypeScript identifiers, API service names, and database concepts continue to use `seat-order` and seat-entry terminology.

## Seat List

The seat list remains the primary overview and ordering surface.

- Each row continues to show the player name or open-seat state, seat number, Overlord status, and active status.
- Each editable row retains its direct drag handle. Pointer, touch, and keyboard reordering behavior remains unchanged.
- The configuration presentation keeps a `Manage seat N` trigger for every editable row.
- Selecting `Manage seat N` opens the modal for that row. Management actions are no longer expanded inline.
- The editor-level `Save order` and `Cancel` actions continue to apply to the complete draft.

Read-only presentation continues to show the list without editing, management, or save controls.

## Manage Seat Modal

The modal follows a summary-first action-card layout and the existing orange terminal visual language.

### Summary

The modal title identifies the selected seat as `Manage seat N`. Its summary shows the assigned player name or `[Open]`.

The summary does not use badges, pills, chips, tags, or other status-label elements. Redundant statuses such as `Occupied`, `Open`, `Active`, and `Not active` are not repeated in the modal. State is explained only when it affects an action.

Summary values reflect the current local draft, including unsaved active-seat and ordering changes made before the modal opens. The title and action copy use the seat’s current draft index rather than its persisted turn order.

### Actions

The modal presents three clearly separated actions:

- `Make active` sets the selected occupied seat as the active seat.
- `Clear seat` removes the assigned player while preserving the seat in the turn order.
- `Remove seat` deletes an empty seat and renumbers the remaining seats.

Each action includes concise supporting text. Unavailable actions remain visible and include a plain-text reason in their supporting copy. Reasons cover an already-active seat, an empty seat, the last occupied seat, an occupied seat, and a newly cleared seat that must be saved before removal.

`Close` is the only footer action. The header close control, Escape, and backdrop click also dismiss the modal.

### Action Flow

- `Make active` updates the existing draft, closes the modal, and returns the user to the list where the new draft state is visible.
- `Clear seat` and `Remove seat` transition from the management modal to the existing destructive confirmation dialog. The two overlays are never stacked.
- Cancelling destructive confirmation returns to the Manage Seat modal for the same entry.
- Confirming a destructive action updates the draft, clears the management selection, and returns to the list.
- Closing the management modal without an action does not modify the draft.

When the modal closes normally, focus returns to its triggering button if that button still exists. After a confirmed removal, focus moves to the `Save order` control because the trigger no longer exists.

## Responsive and Accessible Behavior

The modal uses one summary column and one action column at all sizes, with a constrained desktop width and viewport-safe mobile spacing. Long names and explanations wrap without horizontal overflow.

The modal provides:

- `role="dialog"`, `aria-modal="true"`, and a programmatic title.
- Initial focus on the first available primary action or close control.
- Escape dismissal.
- Backdrop dismissal without treating clicks inside the modal as backdrop clicks.
- Focus containment while open.
- Focus restoration on dismissal.
- Distinct `Manage seat N` accessible names for management triggers.
- Plain-text explanations for unavailable actions rather than relying on color or disabled state alone.

The existing clear/remove confirmation remains the final safeguard for destructive draft changes.

## State and Validation

`SeatOrderEditor` remains the owner of the draft, dirty state, selected entry, pending confirmation, and save request. A local `ManageSeatModal` presentation component receives the selected entry’s derived state and action callbacks. No generic dialog framework or API endpoint is added.

Existing eligibility rules remain authoritative:

- An empty seat cannot become active or be cleared.
- The active seat cannot be made active again.
- The final occupied seat cannot be cleared.
- An occupied seat cannot be removed.
- A seat cleared in the current draft cannot be removed until that clear is saved.
- Permission loss removes all editing and management controls and reports a clean external state.

Save errors remain inline in the seat-order editor. A failed save leaves the draft and dirty state intact.

## Testing

Changes follow test-driven development. Component tests are updated before production code and are observed failing for the intended missing behavior.

Coverage includes:

- Opening the modal for the correct occupied or empty seat.
- Rendering the selected player name or `[Open]` and the current draft seat number.
- Verifying that badge, pill, chip, tag, and redundant status-label elements are absent.
- Closing through visible controls, Escape, and backdrop interaction.
- Restoring focus to the triggering management button when it still exists.
- Applying `Make active` and reflecting the updated draft in the list.
- Correct action availability and explanatory copy for every eligibility rule.
- Transitioning to destructive confirmation without stacked overlays.
- Returning to management after confirmation cancellation.
- Returning to a stable editor target after confirmed removal.
- Preserving drag-and-drop behavior, exact save payloads, dirty-state reporting, permission handling, and inline save errors.

Verification runs the focused `SeatOrderEditor` and campaign configuration tests first, then web typecheck and lint, followed by the relevant broader web test suite. Browser verification checks desktop and mobile modal layout, keyboard interaction, focus behavior, and overflow.

## Out of Scope

- Renaming internal routes, services, database fields, or payload terminology.
- Changing turn-order business rules.
- Adding or inviting players.
- Replacing drag-and-drop ordering with modal-based position controls.
- Redesigning unrelated confirmation dialogs or configuration sections.
