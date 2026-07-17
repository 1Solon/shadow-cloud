import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord.js";
import { describe, expect, it } from "vitest";
import {
  ACCENT_COLOR,
  buildApprovalNotificationMessage,
  buildApprovalResultMessage,
  buildDiscordNotification,
  buildGameInitNotificationMessage,
  buildSaveNotificationMessage,
  buildSaveReplacedNotificationMessage,
  buildTurnNudgeNotificationMessage,
} from "../src/notifications.js";
import type { TurnNudgeNotificationPayload } from "../src/notifications.js";

type IsExactly<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends <
  Value,
>() => Value extends Right ? 1 : 2
  ? true
  : false;
type Assert<Condition extends true> = Condition;
type TurnNudgeThreadIdIsRequired = Assert<
  IsExactly<TurnNudgeNotificationPayload["game"]["discordThreadId"], string>
>;
type TurnNudgeActivePlayerIdIsRequired = Assert<
  IsExactly<
    TurnNudgeNotificationPayload["turnRecord"]["activePlayer"]["discordId"],
    string
  >
>;

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

const saveReplacedPayload = {
  game: {
    id: "game-1",
    gameNumber: 42,
    slug: "the-game",
    name: "The Game",
    discordThreadId: "thread-1",
  },
  replacement: {
    versionId: "version-1",
    versionNumber: 7,
    originalName: "42-T4-S2-Other.se1",
    replacedAt: "2026-07-10T14:30:00.000Z",
    replacedBy: {
      id: "user-1",
      displayName: "Solon",
      discordId: "discord-1",
    },
  },
};

const turnNudgePayload = {
  game: {
    id: "game-1",
    gameNumber: 42,
    slug: "the-game",
    name: "The Game",
    discordThreadId: "thread-1",
  },
  turnRecord: {
    id: "turn-1",
    roundNumber: 3,
    startedAt: "2026-07-10T12:00:00.000Z",
    elapsedHours: 25,
    targetHours: 24,
    activePlayer: {
      id: "user-2",
      displayName: "Next Player",
      discordId: "discord-2",
      turnOrder: 2,
    },
  },
};

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
      rendered.indexOf('"label":"Reject"'),
    );
  });
});

describe("production notification style", () => {
  it("uses the concise hierarchy for initialized games", () => {
    const rendered = JSON.stringify(
      buildGameInitNotificationMessage(
        gameInitializedPayload,
        "https://shadow.example",
      ),
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
      buildSaveNotificationMessage(
        saveUploadedPayload,
        "https://shadow.example",
      ),
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

describe("buildSaveReplacedNotificationMessage", () => {
  it("builds a correction message without turn instructions", () => {
    const message = JSON.stringify(
      buildSaveReplacedNotificationMessage(
        saveReplacedPayload,
        "https://shadow.example",
      ),
    );

    expect(message).toContain("The save for The Game was corrected");
    expect(message).toContain("The Game");
    expect(message).toContain("42-T4-S2-Other.se1");
    expect(message).toContain("<@discord-1>");
    expect(message).toContain("<t:1783693800:F>");
    expect(message).not.toContain("active player");
    expect(message).not.toContain("next player");
    expect(message).not.toContain("current turn");
    expect(message).not.toContain("completed turn");
    expect(message).not.toContain("It is");
  });
});

describe("buildTurnNudgeNotificationMessage", () => {
  it("builds an allowlisted soft reminder with campaign and turn context", () => {
    const message = buildTurnNudgeNotificationMessage(
      turnNudgePayload,
      "https://shadow.example",
    );
    const rendered = JSON.stringify(message);

    expect(message.allowedMentions).toEqual({ users: ["discord-2"] });
    expect(rendered).toContain("<@discord-2>, your turn needs attention");
    expect(rendered).toContain(
      "**World** [The Game](https://shadow.example/games/42)",
    );
    expect(rendered).toContain("**Round** 3 | **Seat** 2");
    expect(rendered).toContain("**25 hours**");
    expect(rendered).toContain("**24 hours**");
    expect(rendered).toContain("-# <t:1783684800:F>");
    expect(rendered).not.toContain("This is a reminder only");
    expect(rendered).not.toContain("will not automatically skip the turn");
  });

  it("uses only the required active-player mention for singular-hour nudges", () => {
    const message = buildTurnNudgeNotificationMessage(
      {
        ...turnNudgePayload,
        turnRecord: {
          ...turnNudgePayload.turnRecord,
          elapsedHours: 1,
          targetHours: 1,
          activePlayer: {
            ...turnNudgePayload.turnRecord.activePlayer,
            displayName: "@everyone @here",
          },
        },
      },
      "https://shadow.example",
    );
    const rendered = JSON.stringify(message);

    expect(message.allowedMentions).toEqual({ users: ["discord-2"] });
    expect(rendered).toContain("<@discord-2>, your turn needs attention");
    expect(rendered).toContain("**1 hour**");
    expect(rendered).not.toContain("**1 hours**");
    expect(rendered).not.toContain("@everyone");
    expect(rendered).not.toContain("@here");
  });
});
