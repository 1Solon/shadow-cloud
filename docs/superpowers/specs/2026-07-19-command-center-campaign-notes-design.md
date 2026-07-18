# Command Center Campaign Notes Design

## Goal

Replace the turn command center's viewer-specific instructional status message with the campaign notes so every viewer can see the notes alongside the current-turn metrics.

## Scope

- Pass the campaign's existing notes value from the game detail page to `TurnCommandCenter`.
- Add a concise `Campaign notes` label in the current status-message area.
- Render non-empty notes with the existing `GameNotesMarkdown` component so Markdown support remains consistent with Campaign Briefing.
- Render `No campaign notes recorded.` when the value is empty or whitespace-only.
- Show this notes area to active players, waiting signed-in players, and signed-out visitors.
- Keep the existing Campaign Notes disclosure in Campaign Briefing unchanged.
- Keep upload and download controls unchanged.

No API, persistence, authorization, or database changes are required.

## Component and Data Flow

The game detail page already receives `game.notes`. It will pass that value into a new `notes` prop on `TurnCommandCenter`. The command center will determine whether notes are non-empty after trimming whitespace and choose between the shared Markdown renderer and the empty-state message.

## Presentation

The notes occupy the left column beneath the turn metrics, replacing the current upload, waiting, and sign-in prose. A small uppercase label distinguishes the content from the metrics. Existing terminal styling and responsive layout are preserved.

## Testing

- Update `TurnCommandCenter` tests to verify that populated Markdown notes appear for the active-player view and that the removed upload instruction is absent.
- Verify notes remain visible for waiting and signed-out viewers instead of their former status prose.
- Verify whitespace-only notes render the exact empty-state message.
- Update the game page test to verify `game.notes` is passed into `TurnCommandCenter`.
- Run the focused tests, then lint and type checking for the web app.
