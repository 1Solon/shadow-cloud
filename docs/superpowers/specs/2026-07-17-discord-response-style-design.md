# Consistent Discord Response Style

## Goal

Make every Discord bot response use the visual hierarchy and concise writing style established by the existing "It is X's turn!" notification. This includes public notifications, command confirmations, validation messages, errors, and ephemeral replies.

The change must preserve useful message-specific information and existing bot behavior.

## Shared Message Model

Every Discord output will use one semantic message shape:

- `headline`: a short, sentence-style heading.
- `message`: one concise sentence describing the outcome or next action.
- `details`: optional compact context for information-heavy responses.
- `metadata`: optional muted footer text, such as a source timestamp or secondary note.
- `actions`: optional Discord buttons in the footer.
- `mentionedUserIds`: the explicit allowlist of Discord users who may be mentioned.

The existing notification, interaction reply, and edited interaction reply functions will remain transport-specific wrappers around one shared Components V2 container renderer. Public versus ephemeral delivery remains the responsibility of those wrappers.

## Visual Hierarchy

Every response uses the existing orange container accent. Individual response builders cannot omit it.

Content renders in this order:

1. Headline.
2. Primary message.
3. Optional compact details.
4. Optional footer containing metadata, secondary notes, or action buttons.

A dark horizontal divider separates the main content from the footer. The divider is rendered only when the response has real footer content. Messages without a footer do not receive an empty or decorative divider.

The turn notification remains the minimal reference implementation: headline, one instruction sentence, divider, and source timestamp. More detailed messages add compact detail lines without changing the reading order.

## Writing Conventions

Every response has a specific headline, including currently titleless responses such as `/link`. Headlines state the status or identify the required action. Exclamation marks are used only where the message naturally calls for urgency or celebration, rather than being applied to every headline.

The primary message leads with the outcome or required action, uses direct language, and does not merely repeat the headline. Information-heavy responses retain useful context as compact labeled details instead of unrelated paragraphs.

When an API error needs both approachable guidance and technical context, the primary message states what failed and what the user can do, while the API-provided text appears as a `Reason` detail. Existing fallback error text remains available when the API provides no useful message.

Links use descriptive labels rather than bare URLs. Approval-result emoji are removed because the headline already communicates the result. Discord mentions continue to use explicit user allowlists.

Only meaningful timestamps supplied by an event are shown. The bot does not generate decorative timestamps for command responses that have no source timestamp.

## Migration Scope

The implementation is limited to `apps/bot`.

The shared renderer in `apps/bot/src/notifications.ts` will define the semantic structure. Existing notification and response builders will migrate from loose `facts` and `actionLines` arrays to the shared model. The remaining responses built inline in `apps/bot/src/interaction-handler.ts` will move through the same response-building path so every production and debug output follows the contract.

Delivery behavior, API requests, command visibility, button behavior, destination channels, URLs, and mention allowlists will not change.

## Error Handling

Malformed or unavailable API responses continue to use the existing command-specific fallback messages. Errors render through the same orange-accent hierarchy as successful responses.

Changing the response structure must not widen Discord mention behavior. User mentions remain disabled unless their IDs are explicitly present in `mentionedUserIds`.

## Testing

Automated tests will verify:

- Every registered production/debug response uses the shared orange-accent Components V2 container.
- Headline, primary message, details, and footer components render in the defined order.
- The dark divider appears when and only when footer content exists.
- Existing source timestamps, action buttons, ephemeral flags, and allowed mentions are preserved.
- Representative success, error, detailed, and action-required messages follow the new copy hierarchy.
- Existing bot behavior tests remain passing.

Verification will run the bot's tests, lint, type checking, and build. Workspace-wide checks are not required because the implementation is isolated to `apps/bot` and does not change shared packages or API contracts.
