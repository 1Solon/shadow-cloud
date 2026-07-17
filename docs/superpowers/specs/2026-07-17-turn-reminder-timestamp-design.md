# Turn Reminder Timestamp Design

## Goal

Replace the turn reminder footer sentence with the timestamp for when the turn
started, using the same Discord timestamp presentation as the turn
notification.

## Bot Behavior

The turn reminder notification will format `turnRecord.startedAt` as a Discord
full timestamp and render it as a subdued footer:

```text
-# <t:UNIX_SECONDS:F>
```

The sentence stating that the reminder will not automatically skip the turn
will be removed. The reminder title, campaign and turn context, elapsed-time
details, and allowed mention behavior remain unchanged.

If `startedAt` is invalid, the reminder will omit the footer. This matches the
existing behavior for invalid timestamps in turn and save-correction
notifications.

## Implementation

Rename the bot's upload-specific timestamp formatter to a generic Discord
timestamp formatter. Reuse it for upload, save-correction, and turn reminder
timestamps so parsing and formatting behavior remain consistent without
duplication.

## Testing

Update the turn reminder notification test to verify that the rendered message
contains the Discord full timestamp derived from `turnRecord.startedAt` and no
longer contains the removed reminder-only copy. Existing notification tests
will continue to cover the shared formatter through upload-related messages.
