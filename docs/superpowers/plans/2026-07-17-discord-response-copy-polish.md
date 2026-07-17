# Discord Response Copy Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the requested Discord notification copy, render world details as an aligned code-block table, and make successful `/skip` emit only the public turn-advanced announcement.

**Architecture:** Keep message-specific formatting in the existing notification and response builders. Add one focused world-details table formatter, simplify turn reminders, standardize detail-label punctuation, and remove the obsolete turn-skipped response path from the command handler and debug registry.

**Tech Stack:** TypeScript 6, Node.js 22+, discord.js 14 Components V2, Vitest, pnpm 11

---

## File Map

- Modify `apps/bot/src/notifications.ts`: format the world-ready table, simplify turn reminders, and punctuate corrected-by.
- Modify `apps/bot/src/response-messages.ts`: update detail labels and resignation copy; remove the obsolete turn-skipped builder and next-seat detail.
- Modify `apps/bot/src/interaction-handler.ts`: send one successful skip announcement and then delete the deferred reply.
- Modify `apps/bot/src/debug-previews.ts`: remove the obsolete preview and update affected builder calls.
- Modify `apps/bot/test/notifications.test.ts`: cover the table, simplified reminder, and corrected-by label.
- Modify `apps/bot/test/response-messages.test.ts`: cover punctuation, resignation copy, and turn-advanced content.
- Modify `apps/bot/test/interaction-handler.test.ts`: cover successful skip delivery order and absence of the duplicate reply.
- Modify `apps/bot/test/debug-previews.test.ts`: keep the registry exhaustive after removing `turn-skipped`.

### Task 1: Polish API-Originated Notifications

**Files:**
- Modify: `apps/bot/src/notifications.ts:240-410`
- Test: `apps/bot/test/notifications.test.ts`

- [ ] **Step 1: Add failing world-table assertions**

Replace `uses the concise hierarchy for initialized games` in `apps/bot/test/notifications.test.ts` with:

```ts
it("renders initialized-game details as an aligned code-block table", () => {
  const message = buildGameInitNotificationMessage(
    {
      ...gameInitializedPayload,
      game: {
        ...gameInitializedPayload.game,
        hasAiPlayers: true,
        dlcMode: "BOTH",
        gameMode: "FFA_AI",
        techLevel: 4,
        zoneCount: "TWO_ZONE_START",
        armyCount: "ONE_PER_ZONE",
      },
    },
    "https://shadow.example",
  );
  const serialized = JSON.parse(JSON.stringify(message)) as {
    components: Array<{ components: Array<{ content?: string }> }>;
  };
  const details = serialized.components[0]?.components.find(({ content }) =>
    content?.startsWith("```"),
  );

  expect(details?.content).toBe(
    [
      "```",
      "Game:      #42",
      "Seats:     4",
      "Overlord:  Solon",
      "DLC:       Both",
      "Mode:      FFA+AI",
      "Tech:      4",
      "Zones:     2 Zone Start",
      "Armies:    1 Army per Zone",
      "AI:        Yes",
      "```",
    ].join("\n"),
  );
  expect(message.allowedMentions).toBeUndefined();
  expect(JSON.stringify(message)).not.toContain("<@discord-1>");
});

it("omits unavailable world settings from the code-block table", () => {
  const rendered = JSON.stringify(
    buildGameInitNotificationMessage(
      gameInitializedPayload,
      "https://shadow.example",
    ),
  );

  expect(rendered).toContain("Game:");
  expect(rendered).toContain("Seats:");
  expect(rendered).toContain("Overlord:");
  expect(rendered).toContain("AI:");
  expect(rendered).not.toContain("DLC:");
  expect(rendered).not.toContain("Mode:");
  expect(rendered).not.toContain("Tech:");
  expect(rendered).not.toContain("Zones:");
  expect(rendered).not.toContain("Armies:");
});
```

- [ ] **Step 2: Add failing corrected-by and reminder assertions**

In the save-replacement test, add:

```ts
expect(message).toContain("**Corrected by:** <@discord-1>");
expect(message).not.toContain("**Corrected by**");
```

In `builds an allowlisted soft reminder with campaign and turn context`, remove the positive world/round/seat assertions and add:

```ts
expect(rendered).not.toContain("**World**");
expect(rendered).not.toContain("**Round**");
expect(rendered).not.toContain("**Seat**");
```

- [ ] **Step 3: Run the focused notification tests and verify the old format fails**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: FAIL on the code-block table, corrected-by colon, removed reminder details, and organizer mention behavior.

- [ ] **Step 4: Replace the inline settings formatter with a table formatter**

Delete `formatGameSetting` and `buildGameSettingsLine` from `apps/bot/src/notifications.ts`. Add this formatter after `formatEnumLabel`:

```ts
function buildGameDetailsTable(
  game: GameInitializedNotificationPayload["game"],
  organizerName: string,
) {
  const rows: Array<[string, string | number | null]> = [
    ["Game", `#${game.gameNumber}`],
    ["Seats", game.playerCount ?? "Not set yet"],
    ["Overlord", organizerName],
    [
      "DLC",
      formatEnumLabel(game.dlcMode, {
        NONE: "None",
        OCEANIA: "Oceania",
        REPUBLICA: "Republica",
        BOTH: "Both",
      }),
    ],
    [
      "Mode",
      formatEnumLabel(game.gameMode, {
        TEAMS: "Teams",
        TEAMS_AI: "Teams+AI",
        FFA: "FFA",
        FFA_AI: "FFA+AI",
      }),
    ],
    ["Tech", game.techLevel],
    [
      "Zones",
      formatEnumLabel(game.zoneCount, {
        CITY_STATE: "City State",
        TWO_ZONE_START: "2 Zone Start",
        THREE_ZONE_START: "3 Zone Start",
      }),
    ],
    [
      "Armies",
      formatEnumLabel(game.armyCount, {
        MILITIA_ONLY: "Militia Only",
        ONE_PER_ZONE: "1 Army per Zone",
        TWO_PER_ZONE: "2 Armies per Zone",
      }),
    ],
    [
      "AI",
      game.hasAiPlayers == null ? null : game.hasAiPlayers ? "Yes" : "No",
    ],
  ].filter(
    (row): row is [string, string | number] => row[1] != null,
  );
  const labelWidth = Math.max(
    ...rows.map(([label]) => `${label}:`.length),
  );

  return [
    "```",
    ...rows.map(
      ([label, value]) => `${`${label}:`.padEnd(labelWidth + 2)}${value}`,
    ),
    "```",
  ].join("\n");
}
```

- [ ] **Step 5: Use the table and simplify the affected notifications**

Update `buildGameInitNotificationMessage` to use the organizer display name and remove the organizer allowlist:

```ts
const gameUrl = new URL(
  `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
  webBaseUrl,
).toString();

return buildDiscordNotification({
  headline: `${payload.game.name} is ready!`,
  message: `Review the [world page](${gameUrl}), then use /register in this thread to claim an open seat.`,
  details: [
    buildGameDetailsTable(payload.game, payload.organizer.displayName),
  ],
});
```

Update the save-replacement detail:

```ts
details: [`**Corrected by:** ${correctedBy}`],
```

Remove the `gameUrl` construction and `details` property from `buildTurnNudgeNotificationMessage`. Rename its now-unused second parameter to `_webBaseUrl` so existing internal callers remain unchanged:

```ts
export function buildTurnNudgeNotificationMessage(
  payload: TurnNudgeNotificationPayload,
  _webBaseUrl: string,
): MessageCreateOptions {
  const player = formatDiscordActor(
    payload.turnRecord.activePlayer.displayName,
    payload.turnRecord.activePlayer.discordId,
  );
  const hours = (value: number) => `${value} hour${value === 1 ? "" : "s"}`;
  const startedAt = formatDiscordTimestamp(payload.turnRecord.startedAt);

  return buildDiscordNotification({
    headline: `${player}, your turn needs attention`,
    message: `This turn has been active for **${hours(payload.turnRecord.elapsedHours)}**, against a target of **${hours(payload.turnRecord.targetHours)}**.`,
    metadata: startedAt ? [`-# ${startedAt}`] : [],
    mentionedUserIds: [payload.turnRecord.activePlayer.discordId],
  });
}
```

- [ ] **Step 6: Run notification tests, lint, and type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
pnpm --filter @shadow-cloud/bot lint
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the notification formatting changes**

```bash
git add apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts
git commit -m "style(bot): polish Discord notification details"
```

### Task 2: Standardize Labels And Resignation Copy

**Files:**
- Modify: `apps/bot/src/response-messages.ts:75-165,240-260`
- Test: `apps/bot/test/response-messages.test.ts`

- [ ] **Step 1: Add failing punctuation assertions**

Update the command-error and approval-failure expectations in `apps/bot/test/response-messages.test.ts`:

```ts
expect(renderedMessage).toContain("**Reason:** The game is full.");
expect(renderedMessage).not.toContain("**Reason**");

expect(renderedMessage).toContain("**Reason:** The request expired.");
expect(renderedMessage).not.toContain("**Reason**");
```

Add this focused test:

```ts
it("punctuates configuration and next-step labels", () => {
  const misconfigured = rendered(buildBotMisconfiguredReply());
  const pinFailure = rendered(buildDiscordPinFailureReply("pin"));

  expect(misconfigured).toContain("**Missing setting:** BOT_API_TOKEN");
  expect(misconfigured).not.toContain("**Missing setting**");
  expect(pinFailure).toContain("**Next step:** Check that the message exists");
  expect(pinFailure).not.toContain("**Next step**");
});
```

- [ ] **Step 2: Add a failing resignation-copy test**

Add this test to `apps/bot/test/response-messages.test.ts`:

```ts
it("emphasizes the resigned seat and directs transfers to the webui", () => {
  const renderedMessage = rendered(
    buildResignationAnnouncement("user-1", "Debug World", 2, true),
  );

  expect(renderedMessage).toContain(
    "**Seat 2** is now empty and will be skipped during turn rotation.",
  );
  expect(renderedMessage).toContain(
    "They remain the Overlord until campaign control is transferred in the webui.",
  );
  expect(renderedMessage).not.toContain("web app");
});
```

- [ ] **Step 3: Run the focused response tests and verify the old copy fails**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/response-messages.test.ts
```

Expected: FAIL on the colon placement, seat emphasis, and `webui` wording.

- [ ] **Step 4: Update production labels and resignation copy**

Make these exact replacements in `apps/bot/src/response-messages.ts`:

```ts
// buildBotMisconfiguredReply
details: ["**Missing setting:** BOT_API_TOKEN"],

// buildCommandErrorReply
details: [`**Reason:** ${errorMessage}`],

// buildDiscordPinFailureReply
details: [
  "**Next step:** Check that the message exists in this thread and that the bot can manage pinned messages.",
],

// buildResignationAnnouncement
const organizerNote = wasOrganizer
  ? " They remain the Overlord until campaign control is transferred in the webui."
  : "";

return buildDiscordNotification({
  headline: `${mention} resigned from ${gameName}`,
  message: `**Seat ${turnOrder}** is now empty and will be skipped during turn rotation.${organizerNote}`,
  mentionedUserIds: [userId],
});

// buildApprovalFailureReply
details: [`**Reason:** ${errorMessage}`],
```

Also update the generic renderer fixture in `apps/bot/test/notifications.test.ts` from `**Reason** The game is full.` to `**Reason:** The game is full.` so the test suite contains no obsolete label example.

- [ ] **Step 5: Run response and notification tests**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/response-messages.test.ts test/notifications.test.ts
```

Expected: both test files PASS.

- [ ] **Step 6: Commit the label and resignation changes**

```bash
git add apps/bot/src/response-messages.ts apps/bot/test/response-messages.test.ts apps/bot/test/notifications.test.ts
git commit -m "style(bot): refine Discord response copy"
```

### Task 3: Remove The Duplicate Successful Skip Response

**Files:**
- Modify: `apps/bot/src/response-messages.ts:190-225`
- Modify: `apps/bot/src/interaction-handler.ts:20-55,340-365`
- Modify: `apps/bot/src/debug-previews.ts:15-60,285-305`
- Test: `apps/bot/test/response-messages.test.ts`
- Test: `apps/bot/test/interaction-handler.test.ts`
- Test: `apps/bot/test/debug-previews.test.ts`

- [ ] **Step 1: Add a failing successful-skip integration test**

Add `ChannelType` to the discord.js import in `apps/bot/test/interaction-handler.test.ts`, then add this test after the debug-command suite:

```ts
describe("createInteractionHandler skip command", () => {
  it("sends one public announcement before deleting the deferred reply", async () => {
    const send = vi.fn(async () => undefined);
    const channel = {
      id: "thread-1",
      name: "Debug World",
      parentId: "forum-1",
      parent: { type: ChannelType.GuildForum },
      isThread: () => true,
      joinable: false,
      send,
    };
    const interaction = {
      isButton: () => false,
      isChatInputCommand: () => true,
      commandName: "skip",
      channel,
      channelId: channel.id,
      guildId: "guild-1",
      guild: null,
      user: {
        id: "overlord-1",
        globalName: "Overlord",
        username: "overlord",
      },
      options: {},
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
      deleteReply: vi.fn(async () => undefined),
    };
    const client = {
      channels: { fetch: vi.fn(async () => null) },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: "Debug World",
              skippedPlayer: { displayName: "Previous Player", turnOrder: 1 },
              nextPlayer: {
                displayName: "Solon",
                discordId: "user-2",
                turnOrder: 2,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );

    await createInteractionHandler(client as never, {
      ...config,
      botApiToken: "token",
    })(interaction as never);

    expect(send).toHaveBeenCalledOnce();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
    expect(send.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      interaction.deleteReply.mock.invocationCallOrder[0] ?? 0,
    );
    const renderedMessage = JSON.stringify(send.mock.calls[0]?.[0]);
    expect(renderedMessage).toContain("It is now <@user-2>'s turn!");
    expect(renderedMessage).toContain(
      "**Previous Player** (seat 1) was skipped in **Debug World**.",
    );
    expect(renderedMessage).not.toContain("**Seat** 2");
  });
});
```

- [ ] **Step 2: Update response and registry tests to describe the single outcome**

Remove `buildTurnSkippedReply` from the imports and successful-command assertions in `apps/bot/test/response-messages.test.ts`. Remove `nextSeat` from both `buildTurnAdvancedAnnouncement` calls in that test file. In `leads turn advancement with the next player`, replace the seat assertion with:

```ts
expect(renderedMessage).not.toContain("**Seat**");
```

Remove `"turn-skipped"` from the expected `debugPreviewNames` array in `apps/bot/test/debug-previews.test.ts`.

Update `delivers every preview when the notification list is omitted` in `apps/bot/test/interaction-handler.test.ts`:

```ts
expect(interaction.followUp).toHaveBeenCalledTimes(32);
```

- [ ] **Step 3: Run the focused tests and verify the duplicate flow still fails**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/interaction-handler.test.ts test/response-messages.test.ts test/debug-previews.test.ts
```

Expected: FAIL because successful skip still edits the deferred reply, never deletes it, still renders the next-seat detail, and the debug registry still contains `turn-skipped`.

- [ ] **Step 4: Remove the obsolete builder and next-seat detail**

Delete `buildTurnSkippedReply` from `apps/bot/src/response-messages.ts`. Replace `buildTurnAdvancedAnnouncement` with:

```ts
export function buildTurnAdvancedAnnouncement({
  gameName,
  skippedName,
  skippedSeat,
  nextName,
  nextDiscordId,
}: {
  gameName: string;
  skippedName: string;
  skippedSeat: number | string;
  nextName: string;
  nextDiscordId: string | null;
}): MessageCreateOptions {
  const nextMention = nextDiscordId ? `<@${nextDiscordId}>` : `**${nextName}**`;

  return buildDiscordNotification({
    headline: `It is now ${nextMention}'s turn!`,
    message: `**${skippedName}** (seat ${skippedSeat}) was skipped in **${gameName}**.`,
    mentionedUserIds: nextDiscordId ? [nextDiscordId] : [],
  });
}
```

- [ ] **Step 5: Make successful skip send once and delete the deferred reply**

Remove `buildTurnSkippedReply` from the imports in `apps/bot/src/interaction-handler.ts`. In the successful skip branch, remove `nextSeat` and replace both response calls with:

```ts
await channel.send(
  buildTurnAdvancedAnnouncement({
    gameName,
    skippedName,
    skippedSeat,
    nextName,
    nextDiscordId,
  }),
);
await interaction.deleteReply().catch(() => undefined);
return;
```

- [ ] **Step 6: Remove the obsolete debug preview**

In `apps/bot/src/debug-previews.ts`, remove the `buildTurnSkippedReply` import, the `"turn-skipped"` registry entry, and its preview factory. Remove `nextSeat` from the `buildTurnAdvancedAnnouncement` preview call.

- [ ] **Step 7: Run focused tests, lint, and type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/interaction-handler.test.ts test/response-messages.test.ts test/debug-previews.test.ts
pnpm --filter @shadow-cloud/bot lint
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the single skip outcome**

```bash
git add apps/bot/src/response-messages.ts apps/bot/src/interaction-handler.ts apps/bot/src/debug-previews.ts apps/bot/test/response-messages.test.ts apps/bot/test/interaction-handler.test.ts apps/bot/test/debug-previews.test.ts
git commit -m "refactor(bot): emit one successful skip response"
```

### Task 4: Final Bot Verification

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

Expected: all four commands PASS with all eight bot test files green.

- [ ] **Step 2: Confirm obsolete copy and response paths are absent**

Run:

```bash
rg "buildTurnSkippedReply|turn-skipped" apps/bot/src apps/bot/test
rg "\*\*(Reason|Missing setting|Next step|Corrected by)\*\*|web app|\*\*World\*\*|\*\*Round\*\*" apps/bot/src
```

Expected: neither command finds a match. A no-match exit code from `rg` is expected.

- [ ] **Step 3: Inspect the implementation diff and worktree**

Run:

```bash
git diff HEAD~3 -- apps/bot/src apps/bot/test
git diff --check HEAD~3
git status --short
```

Expected: the implementation diff is limited to the eight bot files listed in the File Map. The visual-companion `.superpowers/` directory may remain untracked and must not be staged.
