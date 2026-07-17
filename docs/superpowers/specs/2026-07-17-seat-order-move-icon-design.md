# Seat Order Move Icon Design

## Goal

Replace the visible `Move` label on editable web seat rows with a vertical move-arrows icon and place the drag handle after every other row action.

## UI Behavior

- Render a compact square outline button containing an inline vertical move-arrows SVG.
- Keep the existing `Move seat N` accessible label and hide the decorative SVG from assistive technology.
- Preserve the existing pointer, touch, and keyboard drag behavior, including disabled and focus states.
- Render the move button last in the seat action container in both card and configuration presentations.

## Implementation

Update `SortableSeatRow` in `apps/web/src/components/seat-order-editor.tsx`. Reuse the existing `Button` component and drag activator properties; no new component or icon dependency is needed.

## Testing

Update `apps/web/src/components/seat-order-editor.test.tsx` with a regression test that verifies the move control has no visible `Move` text, contains the decorative icon, and is the rightmost button in its row. Keep the existing keyboard reordering test as coverage that drag-handle behavior remains intact.

Run the focused seat-order editor test, then the web lint and typecheck commands.
