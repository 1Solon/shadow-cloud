# Campaign Detail Page UX Redesign Design

## Goal

Rework the campaign detail page around the active player's most common task: understand the current turn, get the latest save, and upload the completed save. Preserve the established black-and-orange terminal identity while improving hierarchy, consistency, density, responsive behavior, and accessibility.

No API, database, authorization, or campaign-domain behavior changes are part of this redesign.

## Information Architecture

Replace the current sequence of equally weighted cards with two persistent page layers.

### Turn Command Center

The command center is always the first visible page section. It combines the information and actions needed for the current turn:

- A prominent `YOUR TURN` or `WAITING` state.
- Active lord name and seat.
- Round number.
- Current elapsed time compared with the campaign target.
- Latest save filename, uploader, and timestamp when a save exists.
- Latest-save download action when the signed-in user can use it.
- A compact inline save upload when the signed-in user is the active player.
- A concise waiting or sign-in message when upload is unavailable.

Use one outer terminal panel, a restrained status band, a compact metric row, a latest-save summary, and one action area. Avoid nested card surfaces inside the command center.

### Tabbed Workspace

Place secondary content beneath the command center in an accessible tabbed workspace:

- `Activity` is selected initially. It contains full World States history followed by Recent Turn Timing.
- `Campaign` contains Seat Order and Notes in a responsive two-column layout, followed by Campaign Details at full width.
- `Administration` contains destructive administrator actions and appears only when the current user is authorized to see those actions.

Tab panels remain mounted while inactive panels are hidden. Switching tabs must not discard in-progress Notes, Campaign Details, or Seat Order edits.

The existing terminal shell header, content scroller, bottom padding, and status bar remain. The redesign must not introduce document-level or nested vertical scrolling.

## Components

### TurnCommandCenter

Create a focused component that receives current-turn, latest-save, policy, session, and authorization-derived display props. It owns presentation only and delegates behavior to existing upload and download components.

The component must handle these states:

- Active signed-in player with a latest save.
- Active signed-in player before the first save.
- Signed-in non-active participant waiting on another lord.
- Signed-out visitor.
- Missing or malformed optional timing/file metadata without breaking layout.

Elapsed time updates without hydration mismatch by using a server-provided initial timestamp and the existing timing helpers. The display should remain compact and avoid second-level updates.

### UploadSaveForm

Add a `presentation` prop with `standard` as the default and `compact` for the command center. Compact presentation:

- Uses a shorter drop/select area.
- Keeps drag-and-drop, keyboard activation, file selection, selected-file details, submit, clear, pending, and inline error behavior.
- Removes the always-visible instruction panel.
- Uses singular copy for one `.se1` file rather than the current plural wording.

The dedicated upload page and any other existing usage retain the standard presentation unchanged.

### CampaignWorkspaceTabs

Create an accessible client component with:

- `role="tablist"`, `role="tab"`, and `role="tabpanel"` relationships.
- Stable IDs and `aria-controls`/`aria-labelledby` connections.
- Left/right and Home/End keyboard navigation.
- Visible focus treatment using the existing orange terminal palette.
- Horizontal overflow containment on narrow screens.
- Mounted tab panels hidden with semantic inactive state rather than unmounted.

The component accepts Activity, Campaign, and optional Administration panel content. It owns only selected-tab state.

## Visual System

Keep the terminal visual language:

- Black surfaces, orange foregrounds, monospaced typography, and existing Shadow override color mapping.
- Filled orange for the single primary action in a context.
- Outlined orange for secondary actions.
- Red only for destructive actions and errors.

Improve consistency through:

- Clear primary, secondary, and tertiary typography levels.
- Consistent card header padding and description treatment.
- Reduced nested borders and tinted boxes.
- Consistent section spacing and control heights.
- Tab styling that reads as terminal navigation rather than generic pills.
- Metric values that are visually stronger than labels without becoming oversized dashboard counters.

Do not add new fonts, visual assets, chart libraries, color families, gradients, or decorative effects.

## Responsive Behavior

At desktop widths:

- The command center may use two columns for status/metrics and latest-save/action content.
- Seat Order and Notes share the Campaign tab row.
- Campaign Details spans the available width below them.

At tablet and mobile widths:

- Command-center content stacks in task order: status, metrics, latest save, action.
- Tabs scroll horizontally within their own navigation row when necessary.
- All tab panels use one column.
- Buttons and file controls remain reachable without page-level horizontal overflow.
- The shell header may wrap or compact without overlapping account controls.

Verify at desktop, 375px, and 320px viewport widths.

## Data Flow And Authorization

Keep the page's existing parallel loading of session, game detail, and Shadow override state. Derive the active seat and latest file from the already loaded game payload.

Existing authorization remains authoritative:

- Only the active player may upload the current save.
- Existing download authorization remains unchanged.
- Existing organizer and Shadow override edit permissions remain unchanged.
- The Administration tab is omitted when destructive actions are unavailable.

No client-side tab or visibility decision grants permissions. Existing API checks continue to enforce every mutation.

## Errors And Feedback

- Compact upload errors remain adjacent to the compact uploader.
- Notes, details, roster, replacement, and administrator errors remain in their owning components.
- Existing terminal confirmation modals remain unchanged.
- Page-level upload redirect errors remain above the command center.
- Empty latest-save, file-history, and timing-history states use concise terminal copy and preserve layout.

## Verification

Component and page tests cover:

- Command-center active, waiting, signed-out, no-file, and latest-file states.
- Correct active seat, round, elapsed/target, latest-save, and action rendering.
- Compact uploader drag, keyboard, selected-file, validation, pending, success, and error behavior.
- Standard uploader presentation remaining unchanged.
- Tab ARIA relationships and keyboard navigation.
- Activity as the initial tab.
- Mounted panel state surviving tab changes.
- Conditional Administration tab visibility.
- Correct page section ordering and panel composition.
- Existing Notes, Campaign Details, Seat Order, upload, download, and replacement tests remaining green.

Run web lint, typecheck, tests, and production build. Rendered QA checks page identity, content, framework overlays, console health, screenshot evidence, focus order, tab interaction, upload interaction, scroll containment, and desktop/mobile layouts.

## Out Of Scope

- API or Prisma changes.
- New campaign actions or permissions.
- New timing calculations, charts, or statistics.
- Redesigning the global campaigns list.
- Redesigning the dedicated upload page beyond preserving its standard uploader.
- Replacing the terminal theme or adding a general-purpose design system.
