# Universal Discord Footers

## Goal

Ensure every Discord bot response has a visually complete footer with the dark divider established by the turn notification style.

## Footer Behavior

The shared Discord response renderer always renders a footer. When a response supplies meaningful metadata, such as an upload, replacement, or turn-start timestamp, the renderer preserves that metadata unchanged.

When metadata is absent or empty, the renderer generates a muted delivery timestamp in the existing Discord format:

```text
-# <t:1784299200:F>
```

The timestamp uses the time at which the bot builds the response. This fallback applies equally to public notifications, ephemeral replies, edited replies, success messages, validation messages, and errors.

## Component Order

Every response renders in this order:

1. Headline.
2. Primary message.
3. Optional details.
4. Dark horizontal divider.
5. Source metadata or generated delivery timestamp.
6. Optional action buttons.

Action messages therefore receive both a timestamp and buttons beneath one divider. Messages cannot render an empty footer.

## Fallbacks

If an event timestamp is invalid or unavailable, its builder supplies no usable metadata and the shared renderer generates the delivery timestamp. The renderer does not mix a generated timestamp with valid source metadata.

This change affects presentation only. Message content, source-event timestamps, button behavior, ephemeral flags, destination channels, and mention allowlists remain unchanged.

## Testing

Tests will fix the system clock so generated timestamps are deterministic. Automated coverage will verify:

- Responses without metadata receive the expected generated Discord timestamp.
- Valid source metadata overrides the generated timestamp.
- Invalid or unavailable source timestamps fall back to the delivery timestamp.
- Action buttons render after the timestamp.
- Every registered debug preview contains a divider and footer timestamp.
- Bot lint, type checking, tests, and build pass.
