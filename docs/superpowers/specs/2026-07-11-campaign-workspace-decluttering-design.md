# Campaign Workspace Decluttering Design

## Summary

Redesign the Campaign tab on the campaign detail page as a progressive terminal briefing. The normal view will show a concise campaign summary followed by three disclosure rows for seat order, notes, and turn protocol. Organizers will enter a focused configuration mode from one primary action and edit one section at a time.

The redesign reduces repeated information, nested card chrome, simultaneous forms, helper text, and equally weighted orange accents. It preserves the established 1990s science-fiction terminal aesthetic through monospaced typography, prompt-like labels, fine amber rules, compact status text, and restrained active-state fills.

## Goals

- Make both the read-only and organizer editing experiences in the Campaign tab calmer and easier to scan.
- Preserve all existing campaign metadata, seat-order, notes, host-transfer, validation, permission, and confirmation behavior.
- Remove information from the Campaign summary when it is already prominent in the turn command center.
- Use progressive disclosure so one secondary information group or one editor occupies attention at a time.
- Preserve keyboard accessibility and responsive containment.

## Non-goals

- No changes to the turn command center, Activity tab, or Administration tab.
- No API, database, authentication, authorization, or data-loading changes.
- No changes to the meaning or validation of campaign settings.
- No broad redesign of shared cards or the rest of the application.
- No new campaign data or workflow.

## Current problem

The Campaign tab currently presents Seat Order, Notes, and Campaign Details as independent cards. Campaign Details then renders many settings as a grid of bordered tiles. In edit mode, most settings become visible controls at once. Repeated headings, descriptions, borders, filled surfaces, and amber accents give secondary information the same visual weight as primary information.

The Campaign Details card also repeats round, active-player, and turn-timing information already presented by the persistent turn command center. The result is technically organized but visually busy in both normal and editing states.

## Selected approach

Use a **progressive briefing** rather than nested Campaign sub-tabs or a dense terminal manifest.

This approach offers the best balance between clarity and discoverability. It keeps a useful overview visible, avoids another navigation layer inside the existing Campaign tab, and retains recognizable controls for occasional users. A pure terminal manifest would be visually distinctive but would make editing and discovery less approachable.

## Normal Campaign view

### Campaign briefing

Render one restrained outer surface headed with terminal language such as `CAMPAIGN // BRIEFING`. Its flat interior contains:

- Campaign name and Overlord.
- A compact world-configuration summary for game mode, DLC, tech level, starting zones, army setup, AI inclusion, and configured player count.
- Muted `Unknown` values wherever the existing data is absent.

Do not repeat the active player, round number, or target-turn duration in this opening summary. The active player and round already appear in the turn command center. The target duration belongs in the Turn Protocol disclosure summary.

The summary uses aligned label/value text and spacing rather than a separate bordered tile for every value. It may reflow from two compact columns to one column on narrow screens.

### Disclosure rows

Place three native-button disclosure rows after the summary:

1. `SEAT ORDER · <occupied>/<total> SEATS`
2. `CAMPAIGN NOTES · RECORDED` or `CAMPAIGN NOTES · EMPTY`
3. `TURN PROTOCOL · <target>H TARGET` or an equivalent unknown-state label

Only one disclosure is open at a time. Opening another closes the previous disclosure. The default state has all three closed so the initial Campaign view remains concise.

Expanded content:

- **Seat Order:** the existing ordered seat information in read-only form, including Overlord and active-seat indicators.
- **Campaign Notes:** the existing rendered Markdown or the existing empty-state message.
- **Turn Protocol:** target hours, reminder enabled state, grace period, and repeat interval.

The world configuration remains in the briefing because it defines the campaign at a glance. The three disclosures contain information that is either longer, operational, or only occasionally needed.

### Organizer entry point

Organizers and enabled shadow-override users receive one `CONFIGURE CAMPAIGN` action after the disclosure list. Other users see no edit affordance. Separate Edit buttons are removed from the normal Campaign view.

## Configuration mode

Activating `CONFIGURE CAMPAIGN` replaces the normal briefing contents with a focused configuration workspace inside the same outer surface. It does not open every form simultaneously.

### Configuration sections

Provide five section commands:

1. **Identity & Progress** — campaign number, name, round, player count, and Overlord transfer.
2. **World Setup** — AI inclusion, DLC, game mode, tech level, starting zones, and army setup.
3. **Turn Protocol** — target hours, reminders enabled, reminder grace, and reminder repeat.
4. **Seat Order** — ordering, active seat, clear-seat, and remove-seat behavior.
5. **Notes** — campaign Markdown notes.

Show one section editor at a time. On wider screens, the section commands may form a compact vertical command list beside the editor. On narrow screens, they stack above the editor. This list is configuration navigation, not another persistent tab layer in the normal Campaign view.

Use a restrained state label such as `[CONFIGURING: WORLD SETUP]`. Do not use a solid orange fill across the entire workspace.

### Editing and persistence

- Keep Save and Cancel local to the active section.
- Preserve the existing independent metadata, seat-order, notes, and host-transfer request flows.
- Preserve the existing field validation and server error messages.
- Preserve current confirmation dialogs and success feedback.
- Replace bordered input tiles with simple label/control rows separated by spacing or fine rules.
- In Seat Order, keep drag-and-drop and active-seat controls. Reveal clear/remove controls only for the currently selected seat so destructive actions do not repeat across every row.

### Unsaved changes

Once a user changes a value in the active editor, section switching and exiting configuration mode are blocked until the user saves or cancels that section. The interface explains this requirement next to the section actions. Save failures leave the editor open with its draft intact.

This explicit rule prevents silent data loss without introducing a new cross-section draft model.

## Visual language

- Use one outer Campaign boundary and a mostly flat interior.
- Use fine amber rules to separate major regions.
- Reserve solid amber fills for a selected disclosure or the primary action, not for every value.
- Use amber for prompts, short status labels, active controls, and focus emphasis.
- Use quieter text for helper copy and secondary values.
- Remove descriptions that merely restate a visible heading.
- Retain monospaced typography and concise command-like labels.
- Avoid decorative badges, nested cards, and repeated bordered tiles.

The intended impression is a concise system briefing that can transition into a deliberate configuration console.

## Component responsibilities

Use a Campaign workspace controller to own presentation state:

- Normal versus configuration mode.
- The currently open normal-view disclosure.
- The active configuration section.
- Whether the active editor has an unsaved draft.

Keep summary, disclosure, and editor content in focused units with explicit props. Existing metadata, seat-order, and notes logic should be adapted behind these presentation boundaries instead of combining all mutation logic into the workspace controller.

The controller does not own server data beyond the existing component inputs. Successful saves continue to refresh server-rendered campaign data through the current routing behavior.

## Accessibility

- Disclosure triggers are native buttons with `aria-expanded` and `aria-controls`.
- Configuration commands use a keyboard-operable single-selection pattern with a clear accessible name.
- After selecting a configuration section, focus moves to that editor's heading.
- The active section and current configuration state are not communicated by color alone.
- Existing form labels, validation associations, dialog semantics, and visible focus treatment remain intact.
- Reduced-motion preferences are respected; no essential state change depends on animation.

## Responsive behavior

- The campaign summary reflows to one column on small screens.
- Disclosure triggers and content remain within the page width.
- Configuration commands stack above the active editor when a side-by-side layout is no longer readable.
- Form controls and local actions wrap without horizontal page scrolling.
- Seat-order interactions retain their existing mobile and keyboard support.

## Error and empty states

- Missing world configuration values render as `Unknown` without changing disclosure availability.
- Empty notes render the existing empty-state copy and `CAMPAIGN NOTES · EMPTY` summary.
- Save errors stay within the active editor and do not close or reset it.
- Confirmation dialogs continue to interrupt only the action that requires confirmation.
- If a configuration section becomes unavailable because the user's permissions change after refresh, return to the normal Campaign view without exposing its controls.

## Testing strategy

Add or update tests for:

- The concise briefing content and removal of duplicated active-player, round, and target values from its opening summary.
- Disclosure summaries, exclusive expansion, empty states, and keyboard activation.
- Visibility of `CONFIGURE CAMPAIGN` for each existing permission case.
- Entering and exiting configuration mode.
- Rendering and focusing one configuration editor at a time.
- Blocking section changes and configuration exit while the active section is dirty.
- Save, cancel, validation, server-error, and successful-refresh behavior for each editor.
- Seat selection and conditional destructive controls.
- Accessible names, `aria-expanded`, `aria-controls`, focus movement, and non-color state indicators.
- Narrow-layout containment for the briefing, disclosures, configuration commands, and editor actions.

Run the web package's tests and typecheck, then the repository lint and formatting checks required by the workspace guide. No backend or database verification is required because the design preserves existing API contracts.

## Acceptance criteria

- The default Campaign view contains one briefing surface rather than three simultaneously expanded cards.
- The opening summary does not repeat active player, round, or target-turn duration from the command center.
- Seat order, notes, and turn protocol are available through mutually exclusive disclosures.
- Authorized users enter configuration through one action and see one editor at a time.
- Unsaved drafts cannot be silently discarded by section navigation or leaving configuration mode.
- Existing permissions, mutations, validation, confirmation, and error behavior remain functional.
- The Campaign workspace remains fully keyboard operable and contained at supported viewport widths.
- The terminal aesthetic remains recognizable with materially less border, fill, and copy density.
