# Seat Order Manage Button Label Design

## Goal

Shorten the visible action label on each Seat Order entry from `Manage seat X` to `Manage`.

## Scope

- Change only the Manage button rendered for Seat Order entries.
- Keep the seat-specific accessible name (`Manage seat X`) so assistive technology can distinguish otherwise identical buttons.
- Keep the modal title (`Manage seat X`) unchanged so the selected seat remains clear.
- Update focused component tests to verify the visible label and accessible name.

## Implementation

Render `Manage` as the button's visible text and provide `aria-label={`Manage seat ${index + 1}`}` on the same button. Existing behavior, modal state, focus restoration, and seat actions remain unchanged.

## Verification

Run the focused Seat Order editor test suite and confirm that tests can still select individual seat-management buttons by their accessible names while the rendered button text is `Manage`.
