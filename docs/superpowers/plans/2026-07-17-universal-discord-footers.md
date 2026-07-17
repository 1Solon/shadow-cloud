# Universal Discord Footers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Discord bot response a dark-divider footer by generating a delivery timestamp whenever source metadata is unavailable.

**Architecture:** Keep footer policy inside `buildDiscordResponseContainer`, where all notification, reply, and edit-reply transports already converge. Preserve nonempty caller-supplied metadata; otherwise derive one muted Discord timestamp from `Date.now()`, then render the divider, timestamp, and optional action row in that order.

**Tech Stack:** TypeScript 6, Node.js 22+, discord.js 14 Components V2, Vitest fake timers, pnpm 11

---

## File Map

- Modify `apps/bot/src/notifications.ts`: apply the universal footer fallback in the shared renderer.
- Modify `apps/bot/test/notifications.test.ts`: test generated timestamps, source precedence, invalid-source fallback, and button order.
- Modify `apps/bot/test/debug-previews.test.ts`: require a divider and timestamp in every registered preview.

### Task 1: Make The Shared Footer Universal

**Files:**
- Modify: `apps/bot/src/notifications.ts:130-180`
- Test: `apps/bot/test/notifications.test.ts`
- Test: `apps/bot/test/debug-previews.test.ts`

- [ ] **Step 1: Add deterministic fake-timer cleanup**

Change the Vitest import in `apps/bot/test/notifications.test.ts` and add cleanup immediately after the compile-time type assertions:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});
```

- [ ] **Step 2: Replace the no-footer expectation with a failing fallback-timestamp test**

Replace `omits the divider when there is no footer content` in `apps/bot/test/notifications.test.ts` with:

```ts
it("generates a delivery timestamp when metadata is absent", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));

  const rendered = JSON.stringify(
    buildDiscordNotification({
      headline: "Registration failed",
      message: "Shadow Cloud could not submit your registration.",
      details: ["**Reason** The game is full."],
    }),
  );

  expect(rendered).toContain(`"type":${ComponentType.Separator}`);
  expect(rendered).toContain("-# <t:1784289600:F>");
});
```

- [ ] **Step 3: Strengthen the source-metadata precedence test**

At the start of `renders headline, message, details, divider, metadata, and actions in order`, freeze time to a value different from the supplied metadata:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
```

After the existing metadata assertion, add:

```ts
expect(rendered).not.toContain("-# <t:1784289600:F>");
```

This proves that source metadata replaces rather than supplements the generated delivery time.

- [ ] **Step 4: Require a timestamp before action-only buttons**

At the start of `renders the divider for action-only footers`, freeze the same clock:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
```

Replace its final ordering assertion with:

```ts
expect(rendered).toContain("-# <t:1784289600:F>");
expect(rendered.indexOf(`"type":${ComponentType.Separator}`)).toBeLessThan(
  rendered.indexOf("-# <t:1784289600:F>"),
);
expect(rendered.indexOf("-# <t:1784289600:F>")).toBeLessThan(
  rendered.indexOf('"label":"Reject"'),
);
```

- [ ] **Step 5: Add a failing invalid-event-timestamp fallback test**

Add this test to `production notification style` in `apps/bot/test/notifications.test.ts`:

```ts
it("falls back to delivery time when an event timestamp is invalid", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));

  const rendered = JSON.stringify(
    buildSaveNotificationMessage(
      {
        ...saveUploadedPayload,
        upload: {
          ...saveUploadedPayload.upload,
          uploadedAt: "not-a-date",
        },
      },
      "https://shadow.example",
    ),
  );

  expect(rendered).toContain(`"type":${ComponentType.Separator}`);
  expect(rendered).toContain("-# <t:1784289600:F>");
});
```

- [ ] **Step 6: Run the focused notification test and verify the footer tests fail**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: FAIL because responses with absent or invalid metadata render no timestamp. The source-metadata test remains passing.

- [ ] **Step 7: Implement the renderer-level fallback**

Replace the conditional footer section of `buildDiscordResponseContainer` in `apps/bot/src/notifications.ts` with:

```ts
const footerMetadata =
  metadata.length > 0
    ? metadata
    : [`-# <t:${Math.floor(Date.now() / 1000)}:F>`];

container
  .addSeparatorComponents((separator) =>
    separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  )
  .addTextDisplayComponents((textDisplay) =>
    textDisplay.setContent(footerMetadata.join("\n")),
  );

if (actionRow) {
  container.addActionRowComponents(actionRow);
}
```

Delete the old `if (metadata.length > 0 || actionRow)` and `if (metadata.length > 0)` blocks. Leave headline, message, details, and action-row behavior otherwise unchanged.

- [ ] **Step 8: Run the notification tests and verify they pass**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: all notification tests PASS.

- [ ] **Step 9: Add the all-preview footer contract**

In `apps/bot/test/debug-previews.test.ts`, freeze time at the start of `renders every registered preview as ephemeral Components V2` and restore real timers after each test:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

// At the start of the all-preview test:
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
```

Extend the serialized component type and assertions inside its existing preview loop:

```ts
const serialized = JSON.parse(JSON.stringify(preview.message)) as {
  components: Array<{
    accent_color: number;
    components: Array<{ type: number; content?: string }>;
  }>;
};
const [container] = serialized.components;
const componentTypes = container?.components.map(({ type }) => type) ?? [];
const timestamp = container?.components.find(
  ({ content }) => content?.includes("<t:"),
);

expect(container?.accent_color).toBe(ACCENT_COLOR);
expect(container?.components[0]?.type).toBe(ComponentType.TextDisplay);
expect(container?.components[1]?.type).toBe(ComponentType.TextDisplay);
expect(componentTypes).toContain(ComponentType.Separator);
expect(timestamp?.content).toMatch(/^-# <t:\d+:F>$/);
```

This accepts both source-event and generated delivery timestamps while requiring every registered preview to have a complete footer.

- [ ] **Step 10: Run the debug preview test and bot type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/debug-previews.test.ts
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: the debug preview tests and type checking PASS.

- [ ] **Step 11: Commit the universal footer behavior**

```bash
git add apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts apps/bot/test/debug-previews.test.ts
git commit -m "style(bot): add footers to every Discord response"
```

### Task 2: Final Bot Verification

**Files:**
- Verify only; no planned source changes

- [ ] **Step 1: Run the package-level CI sequence**

Run:

```bash
pnpm --filter @shadow-cloud/bot lint
pnpm --filter @shadow-cloud/bot typecheck
pnpm --filter @shadow-cloud/bot test
pnpm --filter @shadow-cloud/bot build
```

Expected: all four commands PASS, with all eight bot test files green.

- [ ] **Step 2: Inspect the final diff and worktree**

Run:

```bash
git diff HEAD~1 -- apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts apps/bot/test/debug-previews.test.ts
git diff --check HEAD~1
git status --short
```

Expected: the implementation diff is limited to the shared renderer and its two test files. The visual-companion `.superpowers/` directory may remain untracked and must not be staged.
