# Consistent Discord Response Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Discord bot output use the turn notification's orange-accent hierarchy, concise copy, and conditional dark footer divider.

**Architecture:** Add semantic Components V2 builders for a headline, primary message, optional details, and optional footer content while retaining the existing transport-specific notification/reply wrappers. Migrate production notifications first, then command responses and inline handler messages; remove the old loose `facts`/`actionLines` renderer only after all callers use the semantic API.

**Tech Stack:** TypeScript 6, Node.js 22+, discord.js 14 Components V2, Vitest, pnpm 11, ESLint

---

## File Map

- Modify `apps/bot/src/notifications.ts`: define the semantic response renderer and migrate API-originated notification builders.
- Modify `apps/bot/src/response-messages.ts`: migrate command replies and public command announcements to the semantic response model.
- Modify `apps/bot/src/interaction-handler.ts`: route the two inline error/debug responses through the semantic builders.
- Modify `apps/bot/test/notifications.test.ts`: test structural hierarchy, conditional footer divider, notification copy, timestamps, and mention safety.
- Modify `apps/bot/test/response-messages.test.ts`: test command-response copy hierarchy and preserved mention behavior.
- Modify `apps/bot/test/debug-previews.test.ts`: enforce the shared container contract across every registered output.

No new runtime files or dependencies are needed.

### Task 1: Add The Semantic Components V2 Renderer

**Files:**
- Modify: `apps/bot/src/notifications.ts:112-212`
- Test: `apps/bot/test/notifications.test.ts`

- [ ] **Step 1: Write failing renderer-structure tests**

Extend the discord.js imports and notification imports in `apps/bot/test/notifications.test.ts`, then add these tests before the production notification tests:

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord.js";
import {
  ACCENT_COLOR,
  buildDiscordNotification,
  buildSaveReplacedNotificationMessage,
  buildTurnNudgeNotificationMessage,
} from "../src/notifications.js";

describe("buildDiscordNotification", () => {
  it("renders headline, message, details, divider, metadata, and actions in order", () => {
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("approve")
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
    );
    const notification = buildDiscordNotification({
      headline: "Review this registration",
      message: "Approve or reject this request.",
      details: ["**Applicant** Solon"],
      metadata: ["-# <t:1784299200:F>"],
      actionRow,
      mentionedUserIds: ["user-1", "user-1", ""],
    });
    const rendered = JSON.stringify(notification);

    expect(notification.flags).toBe(MessageFlags.IsComponentsV2);
    expect(notification.allowedMentions).toEqual({ users: ["user-1"] });
    expect(rendered).toContain(`"accent_color":${ACCENT_COLOR}`);
    expect(rendered).toContain(`"type":${ComponentType.Separator}`);
    expect(rendered.indexOf("Review this registration")).toBeLessThan(
      rendered.indexOf("Approve or reject this request."),
    );
    expect(rendered.indexOf("Approve or reject this request.")).toBeLessThan(
      rendered.indexOf("**Applicant** Solon"),
    );
    expect(rendered.indexOf("**Applicant** Solon")).toBeLessThan(
      rendered.indexOf("-# <t:1784299200:F>"),
    );
    expect(rendered.indexOf("-# <t:1784299200:F>")).toBeLessThan(
      rendered.indexOf('"label":"Approve"'),
    );
  });

  it("omits the divider when there is no footer content", () => {
    const rendered = JSON.stringify(
      buildDiscordNotification({
        headline: "Registration failed",
        message: "Shadow Cloud could not submit your registration.",
        details: ["**Reason** The game is full."],
      }),
    );

    expect(rendered).not.toContain(`"type":${ComponentType.Separator}`);
  });

  it("renders the divider for action-only footers", () => {
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("reject")
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
    );
    const rendered = JSON.stringify(
      buildDiscordNotification({
        headline: "Review this registration",
        message: "Approve or reject this request.",
        actionRow,
      }),
    );

    expect(rendered).toContain(`"type":${ComponentType.Separator}`);
    expect(rendered.indexOf(`"type":${ComponentType.Separator}`)).toBeLessThan(
      rendered.indexOf("Reject"),
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the new API is missing**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: FAIL because `buildDiscordNotification` is not exported.

- [ ] **Step 3: Add the semantic renderer alongside the legacy renderer**

Add this type and renderer to `apps/bot/src/notifications.ts` after `StandardNotificationOptions`. Keep `buildAllowedMentions` in its existing location and call it from the new wrappers.

```ts
type DiscordResponseOptions = {
  headline: string;
  message: string;
  details?: string[];
  metadata?: string[];
  actionRow?: ActionRowBuilder<ButtonBuilder>;
  mentionedUserIds?: string[];
};

function buildDiscordResponseContainer({
  headline,
  message,
  details = [],
  metadata = [],
  actionRow,
}: DiscordResponseOptions) {
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(`## ${headline}`),
    )
    .addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(message),
    );

  if (details.length > 0) {
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(details.join("\n")),
    );
  }

  if (metadata.length > 0 || actionRow) {
    container.addSeparatorComponents((separator) =>
      separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );
  }

  if (metadata.length > 0) {
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(metadata.join("\n")),
    );
  }

  if (actionRow) {
    container.addActionRowComponents(actionRow);
  }

  return container;
}
```

Add the three transport wrappers after `buildAllowedMentions`:

```ts
export function buildDiscordNotification({
  mentionedUserIds = [],
  ...options
}: DiscordResponseOptions): MessageCreateOptions {
  return {
    components: [buildDiscordResponseContainer(options)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: buildAllowedMentions(mentionedUserIds),
  };
}

export function buildDiscordReply({
  ephemeral = false,
  mentionedUserIds = [],
  ...options
}: DiscordResponseOptions & { ephemeral?: boolean }): InteractionReplyOptions {
  return {
    components: [buildDiscordResponseContainer(options)],
    flags: ephemeral
      ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      : MessageFlags.IsComponentsV2,
    allowedMentions: buildAllowedMentions(mentionedUserIds),
  };
}

export function buildDiscordEditReply({
  mentionedUserIds = [],
  ...options
}: DiscordResponseOptions): InteractionEditReplyOptions {
  return {
    components: [buildDiscordResponseContainer(options)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: buildAllowedMentions(mentionedUserIds),
  };
}
```

The old `buildStandardNotification`, `buildStandardReply`, and `buildStandardEditReply` exports remain temporarily so every commit stays type-correct while callers are migrated.

- [ ] **Step 4: Run the focused tests and bot type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: the notification tests and type checking PASS.

- [ ] **Step 5: Commit the semantic renderer**

```bash
git add apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts
git commit -m "refactor(bot): add semantic Discord response renderer"
```

### Task 2: Migrate Production Notifications And Their Copy

**Files:**
- Modify: `apps/bot/src/notifications.ts:279-474`
- Test: `apps/bot/test/notifications.test.ts`

- [ ] **Step 1: Add failing copy and footer assertions**

Import `buildApprovalNotificationMessage`, `buildApprovalResultMessage`, `buildGameInitNotificationMessage`, and `buildSaveNotificationMessage`. Add these exact fixtures to `apps/bot/test/notifications.test.ts`:

```ts
const gameInitializedPayload = {
  game: {
    id: "game-1",
    slug: "the-game",
    name: "The Game",
    threadName: "42 - The Game",
    gameNumber: 42,
    discordThreadId: "thread-1",
    playerCount: 4,
    hasAiPlayers: false,
    dlcMode: null,
    gameMode: null,
    techLevel: null,
    zoneCount: null,
    armyCount: null,
  },
  organizer: {
    id: "user-1",
    displayName: "Solon",
    discordId: "discord-1",
  },
};

const saveUploadedPayload = {
  game: {
    id: "game-1",
    gameNumber: 42,
    slug: "the-game",
    name: "The Game",
    discordThreadId: "thread-1",
  },
  upload: {
    versionId: "version-1",
    versionNumber: 1,
    originalName: "turn.trn",
    uploadedAt: "2026-05-11T12:00:00.000Z",
    uploadedBy: {
      id: "user-1",
      displayName: "Solon",
      discordId: "discord-1",
    },
  },
  turn: {
    roundNumber: 1,
    roundAdvanced: true,
    activePlayer: {
      id: "user-2",
      displayName: "Next Player",
      discordId: "discord-2",
      turnOrder: 2,
    },
  },
  players: [],
};
```

Then add these assertions:

```ts
describe("production notification style", () => {
  it("uses the concise hierarchy for initialized games", () => {
    const rendered = JSON.stringify(
      buildGameInitNotificationMessage(gameInitializedPayload, "https://shadow.example"),
    );

    expect(rendered).toContain("The Game is ready!");
    expect(rendered).toContain(
      "Review the [world page](https://shadow.example/games/42), then use /register in this thread to claim an open seat.",
    );
    expect(rendered).toContain("**Game** #42");
    expect(rendered).toContain("**Overlord** <@discord-1>");
  });

  it("keeps the turn notification as the timestamped baseline", () => {
    const rendered = JSON.stringify(
      buildSaveNotificationMessage(saveUploadedPayload, "https://shadow.example"),
    );

    expect(rendered).toContain("It is <@discord-2>'s turn!");
    expect(rendered).toContain(
      "Download the [current turn](https://shadow.example/api/games/42/files/version-1), then upload your [completed turn](https://shadow.example/games/42) when finished.",
    );
    expect(rendered).toContain(`"type":${ComponentType.Separator}`);
    expect(rendered).toContain("-# <t:1778500800:F>");
  });

  it("uses an action footer for registration approval", () => {
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("approve")
        .setLabel("Approve")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("reject")
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
    );
    const [approveButton, rejectButton] = actionRow.components;
    const rendered = JSON.stringify(
      buildApprovalNotificationMessage({
        applicantName: "Applicant",
        gameName: "The Game",
        organizerDiscordId: "discord-1",
        approveButton,
        rejectButton,
      }),
    );

    expect(rendered).toContain("<@discord-1>, review this registration");
    expect(rendered).toContain(
      "Approve or reject **Applicant**'s request to join **The Game**.",
    );
    expect(rendered).toContain(`"type":${ComponentType.Separator}`);
  });

  it("states approval results without redundant status emoji", () => {
    const rendered = JSON.stringify(
      buildApprovalResultMessage({
        approved: true,
        gameName: "The Game",
        gameUrl: "https://shadow.example/games/42",
        playerName: "Applicant",
        turnOrder: 2,
      }),
    );

    expect(rendered).toContain("Registration approved");
    expect(rendered).toContain(
      "**Applicant** joined [The Game](https://shadow.example/games/42) as seat 2.",
    );
    expect(rendered).not.toContain("✅");
    expect(rendered).not.toContain("❌");
  });
});
```

Update the existing save-replacement assertion from `Save corrected` to `The save for The Game was corrected`. Update the existing turn-reminder headline assertions from `Turn reminder for <@discord-2>` to `<@discord-2>, your turn needs attention`. Keep the existing world, round, seat, duration, timestamp, and mention-safety assertions unchanged.

- [ ] **Step 2: Run the notification test and verify the old copy fails**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
```

Expected: FAIL on the new headlines and sentences while the Task 1 renderer tests remain passing.

- [ ] **Step 3: Migrate every production notification to the semantic API**

Replace each legacy builder call in `apps/bot/src/notifications.ts` with the following semantic content. Preserve the existing URL construction, timestamp parsing, mention formatting, and explicit `mentionedUserIds` values.

```ts
// buildGameInitNotificationMessage
return buildDiscordNotification({
  headline: `${payload.game.name} is ready!`,
  message: `Review the [world page](${gameUrl}), then use /register in this thread to claim an open seat.`,
  details: [
    `**Game** #${payload.game.gameNumber} | **Seats** ${payload.game.playerCount ?? "Not set yet"} | **Overlord** ${organizerLabel}`,
    ...(settingsLine ? [settingsLine] : []),
  ],
  mentionedUserIds: payload.organizer.discordId
    ? [payload.organizer.discordId]
    : [],
});

// buildSaveNotificationMessage
return buildDiscordNotification({
  headline: `It is ${nextPlayerLabel}'s turn!`,
  message: `Download the [current turn](${downloadUrl}), then upload your [completed turn](${gameUrl}) when finished.`,
  metadata: uploadedAtLabel ? [`-# ${uploadedAtLabel}`] : [],
  mentionedUserIds: payload.turn.activePlayer.discordId
    ? [payload.turn.activePlayer.discordId]
    : [],
});

// buildSaveReplacedNotificationMessage
return buildDiscordNotification({
  headline: `The save for ${payload.game.name} was corrected`,
  message: `Download [${payload.replacement.originalName}](${downloadUrl}) to continue with the corrected save.`,
  details: [`**Corrected by** ${correctedBy}`],
  metadata: replacedAt ? [`-# ${replacedAt}`] : [],
  mentionedUserIds: payload.replacement.replacedBy.discordId
    ? [payload.replacement.replacedBy.discordId]
    : [],
});

// buildTurnNudgeNotificationMessage
return buildDiscordNotification({
  headline: `${player}, your turn needs attention`,
  message: `This turn has been active for **${hours(payload.turnRecord.elapsedHours)}**, against a target of **${hours(payload.turnRecord.targetHours)}**.`,
  details: [
    `**World** [${payload.game.name}](${gameUrl})`,
    `**Round** ${payload.turnRecord.roundNumber} | **Seat** ${payload.turnRecord.activePlayer.turnOrder}`,
  ],
  metadata: startedAt ? [`-# ${startedAt}`] : [],
  mentionedUserIds: [payload.turnRecord.activePlayer.discordId],
});

// buildApprovalNotificationMessage
return buildDiscordNotification({
  headline: `${formatDiscordActor("Overlord", organizerDiscordId)}, review this registration`,
  message: `Approve or reject **${applicantName}**'s request to join **${gameName}**.`,
  actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
    approveButton,
    rejectButton,
  ),
  mentionedUserIds: organizerDiscordId ? [organizerDiscordId] : [],
});

// buildApprovalResultMessage
return buildDiscordEditReply({
  headline: approved ? "Registration approved" : "Registration rejected",
  message: buildNotificationResultText({
    approved,
    gameName,
    gameUrl,
    playerName,
    turnOrder,
  }),
  actionRow,
});
```

Replace `buildNotificationResultText` with:

```ts
export function buildNotificationResultText({
  approved,
  gameName,
  gameUrl,
  playerName,
  turnOrder,
}: {
  approved: boolean;
  gameName: string;
  gameUrl?: string;
  playerName: string;
  turnOrder?: number;
}) {
  const gameLabel = gameUrl ? `[${gameName}](${gameUrl})` : `**${gameName}**`;

  if (!approved) {
    return `**${playerName}**'s request to join ${gameLabel} was rejected.`;
  }

  return `**${playerName}** joined ${gameLabel} as seat ${turnOrder ?? "unknown"}.`;
}
```

- [ ] **Step 4: Run notification tests, bot lint, and bot type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/notifications.test.ts
pnpm --filter @shadow-cloud/bot lint
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the production notification migration**

```bash
git add apps/bot/src/notifications.ts apps/bot/test/notifications.test.ts
git commit -m "style(bot): unify Discord notification responses"
```

### Task 3: Migrate Command Replies And Announcements

**Files:**
- Modify: `apps/bot/src/response-messages.ts:1-264`
- Modify: `apps/bot/src/interaction-handler.ts:1-430`
- Test: `apps/bot/test/response-messages.test.ts`
- Test: `apps/bot/test/interaction-handler.test.ts`

- [ ] **Step 1: Add failing response-copy tests**

Update `apps/bot/test/response-messages.test.ts` so representative output assertions enforce headline, primary message, details, and descriptive links:

```ts
it("renders command failures with guidance and a reason detail", () => {
  const renderedMessage = rendered(
    buildCommandErrorReply("register", { message: "The game is full." }),
  );

  expect(renderedMessage).toContain("Registration failed");
  expect(renderedMessage).toContain(
    "Shadow Cloud could not complete /register.",
  );
  expect(renderedMessage).toContain("**Reason** The game is full.");
});

it("gives every response a specific headline and primary sentence", () => {
  const gameLink = rendered(
    buildGameLinkReply("https://shadow.example/games/42"),
  );
  const wrongChannel = rendered(
    buildWrongChannelReply("register", "GuildText", "channel-1"),
  );

  expect(gameLink).toContain("Open this game in Shadow Cloud");
  expect(gameLink).toContain(
    "[View the game](https://shadow.example/games/42) for status, roster, and uploads.",
  );
  expect(gameLink).not.toContain("<https://shadow.example/games/42>");
  expect(wrongChannel).toContain("Use this command in a game thread");
  expect(wrongChannel).toContain("**Channel type** GuildText");
  expect(wrongChannel).toContain("**Channel ID** channel-1");
});

it("leads turn advancement with the next player", () => {
  const message = buildTurnAdvancedAnnouncement({
    gameName: "Debug World",
    skippedName: "Previous Player",
    skippedSeat: 1,
    nextName: "Next Player",
    nextDiscordId: "user-2",
    nextSeat: 2,
  });
  const renderedMessage = rendered(message);

  expect(renderedMessage).toContain("It is now <@user-2>'s turn!");
  expect(renderedMessage).toContain(
    "**Previous Player** (seat 1) was skipped in **Debug World**.",
  );
  expect(renderedMessage).toContain("**Seat** 2");
  expect(message.allowedMentions).toEqual({ users: ["user-2"] });
});

it("renders approval failures without losing the API reason", () => {
  const renderedMessage = rendered(
    buildApprovalFailureReply("approve", "The request expired."),
  );

  expect(renderedMessage).toContain("Approval failed");
  expect(renderedMessage).toContain(
    "Shadow Cloud could not approve this registration.",
  );
  expect(renderedMessage).toContain("**Reason** The request expired.");
});
```

In `apps/bot/test/interaction-handler.test.ts`, strengthen the unknown-debug-name test with:

```ts
expect(rendered).toContain("Choose one or more registered notification names.");
expect(rendered).toContain("**Unknown** missing");
expect(rendered).toContain("**Valid names**");
```

- [ ] **Step 2: Run focused response and handler tests and verify the old copy fails**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/response-messages.test.ts test/interaction-handler.test.ts
```

Expected: FAIL on the new semantic copy assertions.

- [ ] **Step 3: Migrate response builders to semantic fields**

Replace the imports of the three legacy builders in `apps/bot/src/response-messages.ts` with:

```ts
import {
  buildDiscordEditReply,
  buildDiscordNotification,
  buildDiscordReply,
} from "./notifications.js";
```

Use the following exact content for each builder while preserving its return type, arguments, ephemeral setting, and mention allowlist:

| Builder | Headline | Message | Details |
| --- | --- | --- | --- |
| `buildWrongChannelReply` | `Use this command in a game thread` | `Run /${commandName} inside the forum thread that owns the game.` | `**Channel type** ${observedType}`, `**Channel ID** ${channelId}` |
| `buildForumThreadRequiredReply` | `Use this command in a game thread` | `Run /${commandName} inside a Discord forum thread.` | none |
| `buildBotMisconfiguredReply` | `Bot misconfigured` | `This bot cannot process commands until its API token is configured.` | `**Missing setting** BOT_API_TOKEN` |
| `buildInvalidMessageTargetReply` | `Use a message from this thread` | `Provide a Discord message ID or message link from this forum thread.` | none |
| `buildMessagePinReply` | `Message pinned` or `Message unpinned` | `Message ${messageId} is now pinned in this thread.` or `Message ${messageId} is no longer pinned in this thread.` | none |
| `buildDiscordPinFailureReply` | `Pin failed` or `Unpin failed` | `The bot could not access or modify that message.` | `**Next step** Check that the message exists in this thread and that the bot can manage pinned messages.` |
| `buildResignationCompleteReply` | `Resignation complete` | `You resigned from **${gameName}**.` | none |
| `buildResignationAnnouncement` | `${mention} resigned from ${gameName}` | `Seat ${turnOrder} is now empty and will be skipped during turn rotation.${organizerNote}` | none |
| `buildSeatFilledReply` | `Seat filled` | `**${playerDisplayName}** now occupies seat ${seatNumber} in **${gameName}**.` | none |
| `buildSeatFilledAnnouncement` | `${mention} joined ${gameName}` | `They have taken seat ${seatNumber}.${activeTurnNote}` | none |
| `buildTurnSkippedReply` | `Turn skipped` | `**${skippedName}**'s turn was skipped in **${gameName}**.` | `**Seat** ${skippedSeat}` |
| `buildTurnAdvancedAnnouncement` | `It is now ${nextMention}'s turn!` | `**${skippedName}** (seat ${skippedSeat}) was skipped in **${gameName}**.` | `**Seat** ${nextSeat}` |
| `buildGameLinkReply` | `Open this game in Shadow Cloud` | `[View the game](${gameUrl}) for status, roster, and uploads.` | none |
| `buildRegistrationSubmittedReply` | `Registration submitted` | `Your request to join **${gameName}** is waiting for the game overlord's approval.` | none |
| `buildShadowCloudUnavailableReply` | `Shadow Cloud unavailable` | `Unable to reach the Shadow Cloud API right now. Please try again.` | none |

The command error and approval failure builders require the error text to be separated into a reason detail:

```ts
export function buildCommandErrorReply(
  commandName: GameCommandName,
  payload: CommandResponsePayload,
): InteractionEditReplyOptions {
  const details = commandErrorDetails[commandName];
  const errorMessage = Array.isArray(payload?.message)
    ? payload.message.join(", ")
    : (payload?.message ?? details.fallback);

  return buildDiscordEditReply({
    headline: details.title,
    message: `Shadow Cloud could not complete /${commandName}.`,
    details: [`**Reason** ${errorMessage}`],
  });
}

export function buildApprovalFailureReply(
  action: ApprovalAction,
  errorMessage: string,
): InteractionReplyOptions {
  const approving = action === "approve";

  return buildDiscordReply({
    headline: approving ? "Approval failed" : "Rejection failed",
    message: `Shadow Cloud could not ${approving ? "approve" : "reject"} this registration.`,
    details: [`**Reason** ${errorMessage}`],
    ephemeral: true,
  });
}
```

For all other rows in the table, replace `buildStandardNotification`, `buildStandardReply`, or `buildStandardEditReply` with the corresponding `buildDiscordNotification`, `buildDiscordReply`, or `buildDiscordEditReply`, then use `headline`, `message`, and `details` exactly as listed.

Update existing assertions that intentionally checked replaced wording: change `successfully resigned` to `You resigned from`, change `Seat 2 has been filled` to `now occupies seat 2`, and change the bare game-link expectation to the descriptive link from Step 1. Keep all existing outcome and allowlisted-mention assertions.

- [ ] **Step 4: Migrate the two inline handler responses**

Change the notification imports in `apps/bot/src/interaction-handler.ts` to import `buildDiscordEditReply` and `buildDiscordReply` instead of the legacy names. Replace the registration-button catch response with:

```ts
await interaction.followUp(
  buildDiscordReply({
    headline: "Shadow Cloud unavailable",
    message: "Unable to reach the Shadow Cloud API right now. Please try again.",
    ephemeral: true,
  }),
);
```

Replace the unknown-debug-notification response with:

```ts
await interaction.editReply(
  buildDiscordEditReply({
    headline: "Unknown debug notification",
    message: "Choose one or more registered notification names.",
    details: [
      `**Unknown** ${selection.unknownNames.join(", ")}`,
      `**Valid names** ${debugPreviewNames.join(", ")}`,
    ],
  }),
);
```

- [ ] **Step 5: Run focused tests and type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/response-messages.test.ts test/interaction-handler.test.ts
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: both test files and type checking PASS.

- [ ] **Step 6: Commit the command-response migration**

```bash
git add apps/bot/src/response-messages.ts apps/bot/src/interaction-handler.ts apps/bot/test/response-messages.test.ts apps/bot/test/interaction-handler.test.ts
git commit -m "style(bot): unify Discord command responses"
```

### Task 4: Enforce The Contract Across Debug Previews And Remove The Legacy Renderer

**Files:**
- Modify: `apps/bot/src/notifications.ts:112-212`
- Test: `apps/bot/test/debug-previews.test.ts`

- [ ] **Step 1: Strengthen the all-preview structural test**

Import `ACCENT_COLOR` from `../src/notifications.js` in `apps/bot/test/debug-previews.test.ts`. Add these checks inside the existing loop in `renders every registered preview as ephemeral Components V2`:

```ts
const serialized = JSON.parse(JSON.stringify(preview.message)) as {
  components: Array<{
    accent_color: number;
    components: Array<{ type: number }>;
  }>;
};
const [container] = serialized.components;

expect(container?.accent_color).toBe(ACCENT_COLOR);
expect(container?.components[0]?.type).toBe(ComponentType.TextDisplay);
expect(container?.components[1]?.type).toBe(ComponentType.TextDisplay);
```

This verifies that every registered production outcome has the orange accent, a headline, and a primary message rather than merely checking that one container exists.

- [ ] **Step 2: Run the debug preview test**

Run:

```bash
pnpm --filter @shadow-cloud/bot exec vitest run test/debug-previews.test.ts
```

Expected: PASS because Tasks 2 and 3 migrated every preview factory's underlying builder.

- [ ] **Step 3: Prove the legacy renderer is unused**

Run:

```bash
rg "buildStandard(Notification|Reply|EditReply)" apps/bot/src apps/bot/test
```

Expected: matches only the legacy declarations in `apps/bot/src/notifications.ts`. If any call site remains, migrate it to the matching semantic wrapper before continuing.

- [ ] **Step 4: Remove the loose response model**

Delete `StandardNotificationOptions`, `buildStandardNotificationContainer`, `buildStandardNotification`, `buildStandardReply`, and `buildStandardEditReply` from `apps/bot/src/notifications.ts`. Keep `buildAllowedMentions`, `DiscordResponseOptions`, `buildDiscordResponseContainer`, and the three `buildDiscord*` transport wrappers.

After deletion, the response-rendering section retains the complete `DiscordResponseOptions`, `buildDiscordResponseContainer`, `buildAllowedMentions`, `buildDiscordNotification`, `buildDiscordReply`, and `buildDiscordEditReply` implementations added in Task 1.

- [ ] **Step 5: Run all bot tests, lint, and type checking**

Run:

```bash
pnpm --filter @shadow-cloud/bot test
pnpm --filter @shadow-cloud/bot lint
pnpm --filter @shadow-cloud/bot typecheck
```

Expected: 8 test files pass, lint passes, and type checking passes. The exact test count may increase from the current 41 because Tasks 1-3 add coverage.

- [ ] **Step 6: Commit the contract enforcement and cleanup**

```bash
git add apps/bot/src/notifications.ts apps/bot/test/debug-previews.test.ts
git commit -m "test(bot): enforce consistent Discord response structure"
```

### Task 5: Final Bot Verification

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

Expected: all four commands PASS.

- [ ] **Step 2: Confirm the old API and old copy markers are absent**

Run:

```bash
rg "buildStandard(Notification|Reply|EditReply)|actionLines:|facts:" apps/bot/src apps/bot/test
rg "✅|❌|<https://shadow\.example/games/42>" apps/bot/src apps/bot/test
```

Expected: both commands return no matches. A no-match exit code from `rg` is expected.

- [ ] **Step 3: Inspect the final diff and worktree**

Run:

```bash
git diff HEAD~4 -- apps/bot/src apps/bot/test
git status --short
```

Expected: the diff is limited to the six bot source/test files in the File Map. The visual-companion `.superpowers/` directory may remain untracked and must not be staged. No implementation files should remain modified after the task commits.
