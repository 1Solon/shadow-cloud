# Pi Theme-Aligned Startup Header Design

## Goal

Make the custom PI startup header visually consistent with Pi's active theme instead of rendering a hard-coded blue gradient.

## Scope

- Update the global extension at `C:/Users/Solon/.pi/agent/extensions/ui-customization/index.ts`.
- Recolor both the PI artwork and the centered directory subtitle.
- Preserve the existing artwork, spacing, centering, footer, terminal title, and theme-section hiding behavior.
- Do not change the active theme JSON or Shadow Cloud application code.

## Design

Replace the fixed RGB palette and custom truecolor escape generation with a theme-token gradient. The header renderer will receive Pi's current `Theme` object through `ctx.ui.setHeader()` and style successive non-space characters using a warm progression of semantic tokens:

1. `dim`
2. `warning`
3. `accent`
4. `text`
5. `accent`
6. `warning`

Under `bearded-black-gold-soft`, these tokens produce a brown, orange, gold, warm-white, gold progression. Because the implementation uses `theme.fg()`, the header will also adapt when another theme is selected and will respect Pi's terminal color mode.

The existing row phase offsets will remain, preserving the subtle diagonal movement through the gradient. Spaces will remain unstyled. The subtitle will use the same token-based gradient and remain bold.

## Components and Data Flow

The existing `ui-customization` extension remains the only component involved:

1. `session_start` calls `install()`.
2. `install()` registers the custom header factory.
3. Pi supplies the active `Theme` to that factory.
4. The renderer passes the theme into the gradient helper for the artwork and subtitle.
5. Theme invalidation causes the header to render with the current theme tokens.

No configuration, persistence, network access, or new dependencies are required.

## Error Handling

The gradient helper will use only valid Pi foreground tokens. Existing width-safe centering and truncation remain unchanged, so narrow terminals continue to render safely. Removing direct RGB escape generation also avoids bypassing Pi's 256-color fallback.

## Validation

Add a focused test for the header gradient helper or rendered header that verifies:

- theme foreground styling is used for visible characters;
- spaces remain unstyled;
- the expected warm semantic token progression is applied;
- the output remains width-safe;
- no hard-coded blue palette remains.

Run the `ui-customization` extension's test and typecheck scripts after implementation. A manual `/reload` or new Pi session can then confirm the final appearance in the active Black & Gold theme.
