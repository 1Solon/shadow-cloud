# Web style guide

The Shadow Cloud web app looks like a terminal: one amber panel on black, monospace type, pixel lettering, and information laid out in bordered segments. This guide records the visual rules the home page dashboard settled on, so new pages and components match it. The reference implementation is the shared page frame in `apps/web/src/components/terminal-frame.tsx`, the campaign list and cards (`campaign-list.tsx`, `campaign-card.tsx`), and the shared class names in `apps/web/src/lib/terminal-styles.ts`.

## Colour

- Take every colour from the theme variables, never from Tailwind palette classes or hex values. See [ADR 0001](adr/0001-web-ui-colours-come-from-theme-variables.md); a lint rule enforces it.
- The working palette is `terminal-200` (emphasis and hover), `terminal-300` (body text), `terminal-400` (borders, fills and accents), `primary-foreground` (text on a solid `terminal-400` fill) and `destructive` (overdue and dangerous actions).
- Express hierarchy with opacity on the same hue rather than new colours: `/70` for labels and secondary text, `/60` for bar labels, `/50` for tertiary text such as campaign taglines, `/40` for placeholders, `/30` for form-field borders, `/20` for dividers and panel borders, `/10`–`/15` for tints and hover fills, `/5` for inset wells.
- Never use `text-muted-foreground`, `text-foreground` or other theme colours with a different hue for secondary text; dim `terminal-300` instead.
- Anything drawn outside CSS, such as the avatar canvas, reads its colour from the computed style when it draws, so it follows the active theme.

## Type

- Everything is monospace. Use `tabular-nums` wherever numbers stack or update.
- Field labels are `text-xs uppercase tracking-[0.16em] text-terminal-300/70`. Field values are `text-sm font-medium text-terminal-300`.
- Action text on buttons is `text-xs font-bold uppercase tracking-[0.14em]`.
- Section headings are a prompt: `> YOUR CAMPAIGNS (4)` in `text-lg`, with the count, or `shown / total` while a search or filter hides some.
- Campaign and round numbers below 10 are zero-padded to two digits (`07`, `ROUND 03`) with `padNumber`. Padding is display only; URLs and search use the plain number.

## Pixel lettering and ASCII art

- The `SHADOW-CLOUD` title is the only large pixel lettering on a signed-in page. It is built from block characters by an ascii.rest piece and glitches every few seconds.
- Small text that sits under or beside pixel art is `text-xs`, and is offset by the art's own margin (`pl-[4ch]` or `pr-[4ch]` at the art's font size) so it lines up with the glyphs, not the art's bounding box.
- Pixel art is drawn at `text-[4px]` on small screens and `text-[5px]` from `sm` up, so the title and anything matched to it scale together.
- Scramble text (`scrambleTagPiece`) is for short prompts that alternate with a value, such as the version tag switching to "Click for patch notes" while a release is unseen.
- Every animation stops under `prefers-reduced-motion`.
- The home page opens with the ascii.rest boot log and a CRT power-on once per browser session (`boot-sequence.tsx`); any key skips it, and reloads in the same session go straight to the dashboard.

## Page frame

- A page is one panel: `rounded-lg border border-terminal-400 bg-card` with a soft `shadow-terminal-400/20` glow.
- The header holds the title and version tag on the left and the account on the right, divided from the content by a `border-terminal-400` rule. There is no footer.
- The two sides of the header mirror each other: pixel art on top, small text beneath, with both rows aligned across the page. Signed in, the right side shows the user's avatar as a theme-tinted pixel portrait with their name and a chevron underneath. Signed out, it shows pixel `GUEST` with a scrambling "Click here to sign in ->" prompt.
- "Connected as" and account actions live in the account dropdown, not the header.
- On campaign pages the title links home, and a segment strip under the header reads `◀ BACK`, campaign number, `ROUND`, then the campaign name and tagline.
- Home page content is capped at `max-w-6xl` and centred. On desktop every page fits the viewport and only the content area scrolls.

## Panels

- The page frame is the only element with a bright `terminal-400` border and glow. Everything inside it is flat.
- A panel (`Card`) is `rounded-lg border border-terminal-400/20` on a transparent background, with no shadow.
- A well inside a panel, such as a drop zone or a highlighted value, is `rounded-md border border-terminal-400/20 bg-terminal-400/5`.
- A panel title is a prompt like the section headings: `> SAVE HISTORY` in uppercase `text-lg`, with no trailing colon. `CardTitle` adds the `>` itself. The description under it is `text-sm text-terminal-300/70`.
- Group labels inside a panel (`CAMPAIGN METADATA`, `HANDLE WITH CARE`) use the field label style.

## Buttons

- Every button uses the action text style, `text-xs font-bold uppercase tracking-[0.14em]`, except ghost text links such as the version tag.
- Primary (`default`): solid `terminal-400` with `primary-foreground` text, `terminal-300` on hover. Use it for the one main action in an area.
- Standalone buttons have `rounded-md` corners. Only a button that is a cell inside a segment strip is square, because the strip supplies the rounded edge.
- Secondary (`outline`): a `terminal-400/40` border with `terminal-300` text, a `terminal-400/10` fill and `terminal-200` text on hover.
- Destructive: a `destructive` border and text, a `destructive/10` fill on hover.
- Direction glyphs such as `▼`, `▲` and `◀` are `aria-hidden`.

## Forms

- Inputs, textareas and selects share one style: `rounded-md border border-terminal-400/30 bg-background text-sm text-terminal-200`, placeholders at `terminal-300/40`.
- Field labels use the field label style; hints under a field are `text-xs text-terminal-300/70`; errors are `text-xs text-destructive`.

## Tables

- A table runs edge to edge inside its panel, with no box of its own. Its outer columns line up with the panel title. Use the `table*` classes in `terminal-styles.ts`.
- Column headers use the field label style, with no fill, between `terminal-400/20` rules. Rows are divided by `terminal-400/20` lines; cell values use the field value style, with secondary lines at `text-xs text-terminal-300/70`.
- One fact per cell: give each value its own column instead of labelling values inside a cell.
- The current or latest row has a `terminal-400/10` tint and a 2px `terminal-400` left edge, plus a screen-reader-only label such as "Current turn". Empty values are a dim `—` that reads as "None" to screen readers, not words like "None" or "In progress".
- Timestamps use the compact local format. Buttons in rows are `sm`.
- Numbers that line up in a column use `tabular-nums`, and round and campaign numbers are zero-padded.
- Below `sm`, tables stack into one bordered record per row (`history-table--stacked`).

## Dialogs

- A dialog is a flat panel on a dimmed backdrop: `rounded-lg border border-terminal-400/30 bg-popover`.
- Its title bar is a strip using the field label style on a `terminal-400/10` tint.

## Segments

Rows of related controls or values are a single bordered strip split by dividers, rather than separate boxes:

- Strip: `flex items-stretch divide-x overflow-hidden rounded-lg border`, with dividers and border at `terminal-400/20`.
- Cell: `flex items-center whitespace-nowrap px-2 py-1`.
- A label cell (`SORT`, `STATUS`, `ROUND`) uses the bar label style and is followed by its value cell.
- Selects inside a strip are borderless and square, and highlight with a `terminal-400/10` fill on hover.
- Search is a cell with a `/` prompt and a bare input.

## Campaign cards

- A card is a transparent panel with a `terminal-400/20` border and a 6px left rail that carries the card's state.
- The header strip reads campaign number, `ROUND` and round number, then the campaign name, with the Overlord's optional tagline (at most 40 characters) dimmed after it. The number and round cells have fixed widths so names line up down the list. The tagline truncates before the name does.
- The body is a four-column grid of label and value fields (two columns on small screens).
- When it is the viewer's turn, the card ends in a two-button strip: a ghost "▼ Download latest turn" and a solid `terminal-400` "▲ Upload your turn". The arrows are `aria-hidden`.
- The whole card is a link. Controls inside it stop the click from reaching the card.

## State

State is shown through colour on existing elements, not through badges or status words:

| State     | Rail              | Number cell               | Other cues                                 |
| --------- | ----------------- | ------------------------- | ------------------------------------------ |
| Your turn | `terminal-400`    | solid `terminal-400` fill | tinted header, upload and download actions |
| Overdue   | `destructive`     | `destructive` text        | red time bar and an "· 5h over" suffix     |
| Waiting   | `terminal-400/40` | `terminal-300/70` text    | none                                       |

Don't add labels or banners such as "Your turn" or "Overdue" to cards or panels; the colours, the time bar and the upload action already say it. Panels that track the current turn, such as the campaign page's turn panel, carry the same left rail as the cards.
