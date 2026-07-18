# Pi Bearded Black & Gold Soft Theme Design

## Goal

Create and activate a global pi theme that faithfully adapts Bearded Theme Black & Gold Soft from its Zed theme definition.

## Scope

- Install one theme at `~/.pi/agent/themes/bearded-black-gold-soft.json`.
- Set `theme` to `bearded-black-gold-soft` in `~/.pi/agent/settings.json` while preserving all unrelated settings.
- Do not modify application code or project-local pi configuration.

## Palette and Mapping

Use the source theme's warm base (`#221f1d`), gold accent (`#c7910c`), primary foreground (`#d5d1cf`), secondary foreground (`#bdb8b4`), and muted brown-gray (`#665e59`). Preserve its supporting syntax colors: cyan for functions, green for strings and success, ruby for variables, red for numbers and errors, purple for types, and orange for warnings.

Map pi-specific surfaces to the closest Bearded UI surfaces. Selection, user-message, custom-message, and tool backgrounds use the source theme's warm elevated shades. Pending, success, and error tool surfaces remain visually distinct while staying within the warm palette. Markdown and diff tokens follow the same semantic syntax and status colors. Thinking-level borders progress from muted neutral through the source accent colors, and bash mode uses the source green.

Add an `export` section using the source base and elevated surfaces for visually consistent HTML exports.

## Compatibility Constraint

Pi themes color TUI tokens but cannot set the terminal's overall background. Exact fidelity requires the terminal profile itself to use `#221f1d`; the theme remains readable when the terminal uses another dark background.

## Validation

- Parse both modified JSON files.
- Validate the theme against pi's installed theme schema.
- Confirm all required color tokens are present and all variable references resolve.
- Confirm the active global theme setting equals the theme's `name`.
- Preserve a copy of the existing global settings content until the update succeeds so a failed write cannot silently discard unrelated configuration.
