# Discord Response Copy Polish

## Goal

Refine specific Discord notification content and remove the duplicate successful `/skip` response while preserving the shared response hierarchy and universal footer behavior.

## World-Ready Details

The world-ready notification replaces its inline Markdown details with one aligned plain code block. The table always includes `Game:`, `Seats:`, and `Overlord:`. The Overlord row uses the organizer's display name rather than a Discord mention because mentions do not render inside code blocks.

Available game settings follow as additional rows. Unset settings are omitted, except seats continue to display `Not set yet` when unavailable. Labels include colons and values align to one value column:

```text
Game:      #42
Seats:     4
Overlord:  Solon
DLC:       Both
Mode:      FFA+AI
Tech:      4
Zones:     2 Zone Start
Armies:    1 Army per Zone
AI:        Yes
```

The world-ready notification no longer allowlists or pings the organizer because its only organizer reference is plain text inside the code block.

## Notification Copy

- Save-replacement details use the bold label `Corrected by:`.
- Turn-attention notifications retain the player headline, elapsed-versus-target sentence, and timestamp footer. They remove the world, round, and seat details.
- Resignation announcements begin `**Seat 2** is now empty and will be skipped during turn rotation.`
- Organizer resignation guidance reads `They remain the Overlord until campaign control is transferred in the webui.`
- Error details use the bold label `Reason:`.
- Bot configuration details use the bold label `Missing setting:`.
- Pin-failure guidance uses the bold label `Next step:`.

For each bold detail label, the colon appears inside the bold formatting.

## Skip Command Flow

A successful `/skip` sends only the public turn-advanced announcement. Its headline identifies the next player, and its primary message retains the skipped player's name, skipped seat, and game name. It has no trailing detail for the next player's seat.

The bot sends the public announcement before deleting the deferred ephemeral command reply. If public delivery fails, the deferred reply remains available for the existing error response. Once public delivery succeeds, the bot deletes the deferred reply.

The obsolete `buildTurnSkippedReply` builder and `turn-skipped` debug preview are removed. The debug registry remains an exhaustive list of production response outcomes.

## Preserved Behavior

The shared Components V2 renderer, orange accent, universal timestamp footer, mention allowlists, API requests, command authorization, and destination channels remain unchanged. The public turn-advanced announcement still allowlists the next player's mention when a Discord ID is available.

## Testing

Automated tests will verify:

- World-ready details render as an aligned code-block table with `Overlord: Solon` and omit unavailable settings.
- Corrected-by, reason, missing-setting, and next-step labels include colons inside bold formatting.
- Turn-attention messages contain no world, round, or seat detail rows.
- Resignation messages bold the seat label, use `webui`, and do not contain `web app`.
- A successful `/skip` sends one public announcement and deletes the deferred reply after delivery.
- Turn advancement retains skipped-player context and omits the next-seat detail.
- The `turn-skipped` debug preview is removed while all remaining previews satisfy the shared response contract.
- Bot lint, type checking, tests, and build pass.
