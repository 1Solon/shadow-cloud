# Discord Debug Command Design

## Goal

Add a `/debug` Discord slash command for safely previewing the bot's production notifications and responses. The command must support previewing all messages by default or a caller-selected list, without requiring a game thread or a reachable Shadow Cloud API.

## Command Contract

`/debug` has one optional string option named `notifications`. Its value is a comma-separated list of preview IDs, for example:

```text
/debug notifications:turn-reminder,turn-notification
```

Names are case-insensitive. Surrounding whitespace is ignored, and duplicate names are emitted once in registry order. Omitting the option, or supplying only whitespace, selects every registered preview.

If any supplied name is unknown, the command emits one ephemeral validation response that identifies the unknown names and lists every valid name. It does not emit a partial set of previews.

The command is available in guild channels. It bypasses the game-command forum-thread, forum-parent, and bot API token checks. It does not call the API, join a thread, send a public channel message, pin or unpin a message, rename a thread, or mutate application data.

## Preview Registry

The registry uses the same production message builders as live bot behavior. Inline response construction currently in the interaction handler will be moved into named builders where necessary so debug previews and live responses cannot drift apart.

The registry covers these current message outcomes:

- `game-initialized`
- `turn-notification`
- `save-replaced`
- `turn-reminder`
- `registration-approval`
- `registration-approved`
- `registration-rejected`
- `registration-submitted`
- `resignation-complete`
- `resignation-announcement`
- `seat-filled`
- `seat-filled-announcement`
- `turn-skipped`
- `turn-advanced`
- `game-link`
- `message-pinned`
- `message-unpinned`
- `wrong-channel`
- `bot-misconfigured`
- `initialization-failed`
- `registration-failed`
- `resignation-failed`
- `replacement-failed`
- `skip-failed`
- `link-failed`
- `pin-failed`
- `unpin-failed`
- `invalid-message`
- `discord-pin-failed`
- `shadow-cloud-unavailable`
- `approval-failed`
- `rejection-failed`

Game initialization has no separate success response because its live interaction reply is deleted after the event notification is delivered.

The registry has a deterministic order. `/debug` with no arguments and explicitly selected previews both use that order, not caller input order, to keep output predictable.

## Synthetic Data And Safety

Previews use visibly synthetic values such as `Debug World`, fixed example turn/save data, and URLs derived from the configured web base URL. User-specific examples use the invoking user's display name and Discord ID where live behavior would identify or mention a user.

Every preview is sent ephemerally. Mention allowlists remain present so the preview exercises production rendering, but ephemeral delivery prevents other users from being notified. Registration approval buttons use the production approval layout but are disabled, so clicking a preview can never invoke an approval API request.

## Interaction Flow

The interaction handler recognizes `debug` before resolving or joining a thread and before checking the API token. It defers an ephemeral reply, parses the optional list, builds the selected previews, edits the deferred reply with the first preview, and sends the remaining previews as ephemeral follow-ups.

Rendering failures are handled by the existing top-level interaction error behavior or a debug-specific unavailable response. No successfully parsed debug request enters the normal API-backed command path.

## Testing

Tests will be written before production changes and will verify:

- `/debug` is registered and has the optional `notifications` string option.
- Omitted or whitespace-only input selects all previews.
- Comma-separated names are case-insensitive, trimmed, deduplicated, and returned in registry order.
- Unknown names reject the entire selection and expose the valid names.
- Every registry entry renders a Components V2 payload from a production builder.
- Approval buttons in the debug fixture are disabled.
- The handler runs `/debug` outside a thread and without a bot API token.
- The handler does not call the API or attempt thread resolution for `/debug`.
- Selected previews and all previews are delivered ephemerally.

The bot package's focused tests, lint, typecheck, and build will be run after implementation. Workspace-wide checks will be run if the focused checks pass and time permits.
