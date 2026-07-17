import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
});

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));

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
    expect(rendered).not.toContain("-# <t:1784289600:F>");
  });

  it("generates a delivery timestamp when metadata is absent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));

    const rendered = JSON.stringify(
      buildDiscordNotification({
        headline: "Registration failed",
        message: "Shadow Cloud could not submit your registration.",
        details: ["**Reason:** The game is full."],
      }),
    );

    expect(rendered).toContain(`"type":${ComponentType.Separator}`);
    expect(rendered).toContain("-# <t:1784289600:F>");
  });

  it("renders the divider for action-only footers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));

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
    expect(rendered).toContain("-# <t:1784289600:F>");
    expect(rendered.indexOf(`"type":${ComponentType.Separator}`)).toBeLessThan(
      rendered.indexOf("-# <t:1784289600:F>"),
    );
    expect(rendered.indexOf("-# <t:1784289600:F>")).toBeLessThan(
      rendered.indexOf('"label":"Reject"'),
    );
  });
});

describe("production notification style", () => {
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
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(JSON.stringify(message)).not.toContain("<@discord-1>");
  });

  it("omits unavailable world settings from the code-block table", () => {
    const rendered = JSON.stringify(
      buildGameInitNotificationMessage(
        {
          ...gameInitializedPayload,
          game: { ...gameInitializedPayload.game, playerCount: null },
        },
        "https://shadow.example",
      ),
    );

    expect(rendered).toContain("Game:");
    expect(rendered).toContain("Seats:     Not set yet");
    expect(rendered).toContain("Overlord:");
    expect(rendered).toContain("AI:");
    expect(rendered).not.toContain("DLC:");
    expect(rendered).not.toContain("Mode:");
    expect(rendered).not.toContain("Tech:");
    expect(rendered).not.toContain("Zones:");
    expect(rendered).not.toContain("Armies:");
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
    expect(message).toContain("**Corrected by:** <@discord-1>");
    expect(message).not.toContain("**Corrected by**");
    expect(message).not.toContain("active player");
    expect(message).not.toContain("next player");
    expect(message).not.toContain("current turn");
    expect(message).not.toContain("completed turn");
    expect(message).not.toContain("It is");
  });
});

describe("buildTurnNudgeNotificationMessage", () => {
  it("builds an allowlisted soft reminder with campaign and turn context", () => {
    const message = buildTurnNudgeNotificationMessage(turnNudgePayload);
    const rendered = JSON.stringify(message);

    expect(message.allowedMentions).toEqual({ users: ["discord-2"] });
    expect(rendered).toContain("<@discord-2>, your turn needs attention");
    expect(rendered).not.toContain("**World**");
    expect(rendered).not.toContain("**Round**");
    expect(rendered).not.toContain("**Seat**");
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
