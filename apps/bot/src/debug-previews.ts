import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
} from "discord.js";
import {
  buildApprovalNotificationMessage,
  buildApprovalResultMessage,
  buildGameInitNotificationMessage,
  buildSaveNotificationMessage,
  buildSaveReplacedNotificationMessage,
  buildTurnNudgeNotificationMessage,
} from "./notifications.js";
import {
  buildApprovalFailureReply,
  buildBotMisconfiguredReply,
  buildCommandErrorReply,
  buildDiscordPinFailureReply,
  buildForumThreadRequiredReply,
  buildGameLinkReply,
  buildInvalidMessageTargetReply,
  buildMessagePinReply,
  buildRegistrationSubmittedReply,
  buildResignationAnnouncement,
  buildResignationCompleteReply,
  buildSeatFilledAnnouncement,
  buildSeatFilledReply,
  buildShadowCloudUnavailableReply,
  buildTurnAdvancedAnnouncement,
  buildTurnSkippedReply,
  buildWrongChannelReply,
} from "./response-messages.js";

export const debugPreviewNames = [
  "game-initialized",
  "turn-notification",
  "save-replaced",
  "turn-reminder",
  "registration-approval",
  "registration-approved",
  "registration-rejected",
  "registration-submitted",
  "resignation-complete",
  "resignation-announcement",
  "seat-filled",
  "seat-filled-announcement",
  "turn-skipped",
  "turn-advanced",
  "game-link",
  "message-pinned",
  "message-unpinned",
  "wrong-channel",
  "forum-thread-required",
  "bot-misconfigured",
  "initialization-failed",
  "registration-failed",
  "resignation-failed",
  "replacement-failed",
  "skip-failed",
  "link-failed",
  "pin-failed",
  "unpin-failed",
  "invalid-message",
  "discord-pin-failed",
  "discord-unpin-failed",
  "shadow-cloud-unavailable",
  "approval-failed",
  "rejection-failed",
] as const;

export type DebugPreviewName = (typeof debugPreviewNames)[number];

type DebugPreviewContext = {
  userId: string;
  userDisplayName: string;
  webBaseUrl: string;
};

type PreviewSource =
  MessageCreateOptions | InteractionReplyOptions | InteractionEditReplyOptions;

type DebugPreviewFactory = (context: DebugPreviewContext) => PreviewSource;

const knownPreviewNames = new Set<string>(debugPreviewNames);

export function selectDebugPreviewNames(
  value: string | null,
):
  | { ok: true; names: readonly DebugPreviewName[] }
  | { ok: false; unknownNames: string[] } {
  const requestedNames = (value ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);

  if (requestedNames.length === 0) {
    return { ok: true, names: debugPreviewNames };
  }

  const unknownNames = Array.from(
    new Set(requestedNames.filter((name) => !knownPreviewNames.has(name))),
  );

  if (unknownNames.length > 0) {
    return { ok: false, unknownNames };
  }

  const selectedNames = new Set(requestedNames);
  return {
    ok: true,
    names: debugPreviewNames.filter((name) => selectedNames.has(name)),
  };
}

function buildDisabledApprovalRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("debug_approve")
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId("debug_reject")
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true),
  );
}

function buildDebugGame(context: DebugPreviewContext) {
  return {
    id: "debug-game",
    gameNumber: 42,
    slug: "debug-world",
    name: "Debug World",
    discordThreadId: "debug-thread",
    organizer: {
      id: "debug-organizer",
      displayName: context.userDisplayName,
      discordId: context.userId,
    },
    activePlayer: {
      id: "debug-player",
      displayName: context.userDisplayName,
      discordId: context.userId,
      turnOrder: 2,
    },
  };
}

const previewFactories: Record<DebugPreviewName, DebugPreviewFactory> = {
  "game-initialized": (context) => {
    const fixture = buildDebugGame(context);
    return buildGameInitNotificationMessage(
      {
        game: {
          id: fixture.id,
          slug: fixture.slug,
          name: fixture.name,
          threadName: "42 - Debug World",
          gameNumber: fixture.gameNumber,
          discordThreadId: fixture.discordThreadId,
          playerCount: 6,
          hasAiPlayers: true,
          dlcMode: "BOTH",
          gameMode: "FFA_AI",
          techLevel: 4,
          zoneCount: "TWO_ZONE_START",
          armyCount: "ONE_PER_ZONE",
        },
        organizer: fixture.organizer,
      },
      context.webBaseUrl,
    );
  },
  "turn-notification": (context) => {
    const fixture = buildDebugGame(context);
    return buildSaveNotificationMessage(
      {
        game: {
          id: fixture.id,
          gameNumber: fixture.gameNumber,
          slug: fixture.slug,
          name: fixture.name,
          discordThreadId: fixture.discordThreadId,
        },
        upload: {
          versionId: "debug-version",
          versionNumber: 7,
          originalName: "42-T3-S1-Debug.se1",
          uploadedAt: "2026-07-17T12:00:00.000Z",
          uploadedBy: fixture.organizer,
        },
        turn: {
          roundNumber: 3,
          roundAdvanced: false,
          activePlayer: fixture.activePlayer,
        },
        players: [fixture.activePlayer],
      },
      context.webBaseUrl,
    );
  },
  "save-replaced": (context) => {
    const fixture = buildDebugGame(context);
    return buildSaveReplacedNotificationMessage(
      {
        game: {
          id: fixture.id,
          gameNumber: fixture.gameNumber,
          slug: fixture.slug,
          name: fixture.name,
          discordThreadId: fixture.discordThreadId,
        },
        replacement: {
          versionId: "debug-version",
          versionNumber: 7,
          originalName: "42-T3-S1-Debug.se1",
          replacedAt: "2026-07-17T12:30:00.000Z",
          replacedBy: fixture.organizer,
        },
      },
      context.webBaseUrl,
    );
  },
  "turn-reminder": (context) => {
    const fixture = buildDebugGame(context);
    return buildTurnNudgeNotificationMessage(
      {
        game: {
          id: fixture.id,
          gameNumber: fixture.gameNumber,
          slug: fixture.slug,
          name: fixture.name,
          discordThreadId: fixture.discordThreadId,
        },
        turnRecord: {
          id: "debug-turn",
          roundNumber: 3,
          startedAt: "2026-07-16T12:00:00.000Z",
          elapsedHours: 25,
          targetHours: 24,
          activePlayer: fixture.activePlayer,
        },
      },
      context.webBaseUrl,
    );
  },
  "registration-approval": (context) => {
    const [approveButton, rejectButton] = buildDisabledApprovalRow().components;
    return buildApprovalNotificationMessage({
      applicantName: context.userDisplayName,
      gameName: "Debug World",
      organizerDiscordId: context.userId,
      approveButton,
      rejectButton,
    });
  },
  "registration-approved": (context) =>
    buildApprovalResultMessage({
      approved: true,
      gameName: "Debug World",
      gameUrl: new URL("/games/42", context.webBaseUrl).toString(),
      playerName: context.userDisplayName,
      turnOrder: 2,
      actionRow: buildDisabledApprovalRow(),
    }),
  "registration-rejected": (context) =>
    buildApprovalResultMessage({
      approved: false,
      gameName: "Debug World",
      gameUrl: new URL("/games/42", context.webBaseUrl).toString(),
      playerName: context.userDisplayName,
      actionRow: buildDisabledApprovalRow(),
    }),
  "registration-submitted": () =>
    buildRegistrationSubmittedReply("Debug World"),
  "resignation-complete": () => buildResignationCompleteReply("Debug World"),
  "resignation-announcement": (context) =>
    buildResignationAnnouncement(context.userId, "Debug World", 2, true),
  "seat-filled": (context) =>
    buildSeatFilledReply("Debug World", context.userDisplayName, 2),
  "seat-filled-announcement": (context) =>
    buildSeatFilledAnnouncement(context.userId, "Debug World", 2, true),
  "turn-skipped": (context) =>
    buildTurnSkippedReply("Debug World", context.userDisplayName, 2),
  "turn-advanced": (context) =>
    buildTurnAdvancedAnnouncement({
      gameName: "Debug World",
      skippedName: "Previous Player",
      skippedSeat: 1,
      nextName: context.userDisplayName,
      nextDiscordId: context.userId,
      nextSeat: 2,
    }),
  "game-link": (context) =>
    buildGameLinkReply(new URL("/games/42", context.webBaseUrl).toString()),
  "message-pinned": () => buildMessagePinReply("pin", "debug-message"),
  "message-unpinned": () => buildMessagePinReply("unpin", "debug-message"),
  "wrong-channel": () =>
    buildWrongChannelReply("register", "GuildText", "debug-channel"),
  "forum-thread-required": () => buildForumThreadRequiredReply("register"),
  "bot-misconfigured": () => buildBotMisconfiguredReply(),
  "initialization-failed": () => buildCommandErrorReply("init", null),
  "registration-failed": () => buildCommandErrorReply("register", null),
  "resignation-failed": () => buildCommandErrorReply("resign", null),
  "replacement-failed": () => buildCommandErrorReply("replace", null),
  "skip-failed": () => buildCommandErrorReply("skip", null),
  "link-failed": () => buildCommandErrorReply("link", null),
  "pin-failed": () => buildCommandErrorReply("pin", null),
  "unpin-failed": () => buildCommandErrorReply("unpin", null),
  "invalid-message": () => buildInvalidMessageTargetReply(),
  "discord-pin-failed": () => buildDiscordPinFailureReply("pin"),
  "discord-unpin-failed": () => buildDiscordPinFailureReply("unpin"),
  "shadow-cloud-unavailable": () => buildShadowCloudUnavailableReply(),
  "approval-failed": () =>
    buildApprovalFailureReply("approve", "Debug approval failure."),
  "rejection-failed": () =>
    buildApprovalFailureReply("reject", "Debug rejection failure."),
};

function asEphemeralPreview(message: PreviewSource): InteractionReplyOptions {
  return {
    components: message.components,
    allowedMentions: message.allowedMentions,
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
  };
}

export function buildDebugPreviews(
  names: readonly DebugPreviewName[],
  context: DebugPreviewContext,
) {
  return names.map((name) => ({
    name,
    message: asEphemeralPreview(previewFactories[name](context)),
  }));
}
