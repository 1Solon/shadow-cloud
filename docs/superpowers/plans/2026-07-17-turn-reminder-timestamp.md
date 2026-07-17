# Turn Reminder Timestamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the turn reminder's explanatory footer with the Discord full timestamp for when the turn started.

**Architecture:** Keep timestamp parsing and Discord markup construction in the existing notification module, but rename the upload-specific helper so upload, save-correction, and reminder notifications can share it accurately. The turn reminder derives its footer from `turnRecord.startedAt` and follows the existing behavior of omitting invalid timestamps.

**Tech Stack:** TypeScript, discord.js message components, Vitest, pnpm

---

## File Structure

- Modify `apps/bot/test/notifications.test.ts` to specify the reminder timestamp footer and removal of the old explanatory copy.
- Modify `apps/bot/src/notifications.ts` to generalize the timestamp formatter and render the reminder's `startedAt` value.

### Task 1: Render The Turn Start Timestamp In Reminder Notifications

**Files:**
- Modify: `apps/bot/test/notifications.test.ts:90-108`
- Modify: `apps/bot/src/notifications.ts:217-225,337,367,386-411`
- Test: `apps/bot/test/notifications.test.ts`

- [ ] **Step 1: Write the failing notification assertion**

In the first `buildTurnNudgeNotificationMessage` test, replace the two assertions for the old reminder sentence with assertions for the exact timestamp footer and absence of the removed copy:

```typescript
    expect(rendered).toContain("**25 hours**");
    expect(rendered).toContain("**24 hours**");
    expect(rendered).toContain("-# <t:1783684800:F>");
    expect(rendered).not.toContain("This is a reminder only");
    expect(rendered).not.toContain("will not automatically skip the turn");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: FAIL in `builds an allowlisted soft reminder with campaign and turn context` because the rendered reminder does not contain `-# <t:1783684800:F>`.

- [ ] **Step 3: Generalize the Discord timestamp formatter**

In `apps/bot/src/notifications.ts`, rename `formatUploadedAt` to `formatDiscordTimestamp`, make its parameter name generic, and update both existing callers:

```typescript
function formatDiscordTimestamp(timestamp: string) {
  const parsedDate = new Date(timestamp);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return `<t:${Math.floor(parsedDate.getTime() / 1000)}:F>`;
}
```

```typescript
  const uploadedAtLabel = formatDiscordTimestamp(payload.upload.uploadedAt);
```

```typescript
  const replacedAt = formatDiscordTimestamp(payload.replacement.replacedAt);
```

- [ ] **Step 4: Render the turn start timestamp**

In `buildTurnNudgeNotificationMessage`, format `turnRecord.startedAt` before constructing the notification:

```typescript
  const startedAt = formatDiscordTimestamp(payload.turnRecord.startedAt);
```

Replace the explanatory `actionLines` value with the optional subdued timestamp footer:

```typescript
    actionLines: startedAt ? [`-# ${startedAt}`] : [],
```

Keep the title, facts, elapsed and target hour formatting, game link, and `mentionedUserIds` unchanged.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: PASS with all notification tests green.

- [ ] **Step 6: Run bot verification**

Run:

```bash
pnpm --filter @shadow-cloud/bot lint
pnpm --filter @shadow-cloud/bot typecheck
pnpm --filter @shadow-cloud/bot test
```

Expected: all commands exit successfully with no lint errors, type errors, or failing bot tests.

- [ ] **Step 7: Review and commit the implementation**

Review the patch:

```bash
git diff --check
git diff -- apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts
```

Expected: no whitespace errors, and the diff contains only the shared formatter rename, reminder footer change, and focused test update.

Commit:

```bash
git add apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts
git commit -m "fix(bot): timestamp turn reminders"
```
