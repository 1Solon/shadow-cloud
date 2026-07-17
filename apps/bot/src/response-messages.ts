import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageCreateOptions,
} from "discord.js";
import type {
  ApprovalAction,
  CommandResponsePayload,
} from "./bot-api.js";
import type { SupportedCommandName } from "./commands.js";
import {
  buildStandardEditReply,
  buildStandardNotification,
  buildStandardReply,
} from "./notifications.js";

type GameCommandName = Exclude<SupportedCommandName, "debug">;

const commandErrorDetails: Record<
  GameCommandName,
  { title: string; fallback: string }
> = {
  init: {
    title: "Initialization failed",
    fallback: "The API rejected the game creation request.",
  },
  register: {
    title: "Registration failed",
    fallback: "The API rejected the registration request.",
  },
  resign: {
    title: "Resignation failed",
    fallback: "The API rejected the resignation request.",
  },
  replace: {
    title: "Replacement failed",
    fallback: "The API rejected the replacement request.",
  },
  skip: {
    title: "Skip failed",
    fallback: "The API rejected the skip request.",
  },
  link: {
    title: "Link failed",
    fallback: "The API rejected the link request.",
  },
  pin: {
    title: "Pin failed",
    fallback: "The API rejected the pin request.",
  },
  unpin: {
    title: "Unpin failed",
    fallback: "The API rejected the unpin request.",
  },
};

export function buildWrongChannelReply(
  commandName: string,
  observedType: string,
  channelId: string,
): InteractionReplyOptions {
  return buildStandardReply({
    title: "Wrong channel",
    facts: [
      `Run /${commandName} inside the forum thread that should own the game.`,
      `Observed channel type: ${observedType}`,
      `Channel id: ${channelId}`,
    ],
    ephemeral: true,
  });
}

export function buildForumThreadRequiredReply(
  commandName: string,
): InteractionReplyOptions {
  return buildStandardReply({
    title: "Wrong channel",
    facts: [`Run /${commandName} inside a Discord forum thread.`],
    ephemeral: true,
  });
}

export function buildBotMisconfiguredReply(): InteractionReplyOptions {
  return buildStandardReply({
    title: "Bot misconfigured",
    facts: ["BOT_API_TOKEN is not configured for the bot."],
    ephemeral: true,
  });
}

export function buildCommandErrorReply(
  commandName: GameCommandName,
  payload: CommandResponsePayload,
): InteractionEditReplyOptions {
  const details = commandErrorDetails[commandName];
  const errorMessage = Array.isArray(payload?.message)
    ? payload.message.join(", ")
    : (payload?.message ?? details.fallback);

  return buildStandardEditReply({
    title: details.title,
    facts: [errorMessage],
  });
}

export function buildInvalidMessageTargetReply(): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: "Invalid message",
    facts: ["Use a Discord message ID or message link from this forum thread."],
  });
}

export function buildMessagePinReply(
  action: "pin" | "unpin",
  messageId: string,
): InteractionEditReplyOptions {
  const pinned = action === "pin";

  return buildStandardEditReply({
    title: pinned ? "Message pinned" : "Message unpinned",
    facts: [
      `${pinned ? "Pinned" : "Unpinned"} message ${messageId}.`,
    ],
  });
}

export function buildDiscordPinFailureReply(
  action: "pin" | "unpin",
): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: action === "pin" ? "Pin failed" : "Unpin failed",
    facts: [
      "The bot could not access or modify that message. Check that the message exists in this thread and the bot has permission to manage pinned messages.",
    ],
  });
}

export function buildResignationCompleteReply(
  gameName: string,
): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: "Resignation complete",
    facts: [`You have successfully resigned from **${gameName}**.`],
  });
}

export function buildResignationAnnouncement(
  userId: string,
  gameName: string,
  turnOrder: number | string,
  wasOrganizer: boolean,
): MessageCreateOptions {
  const mention = `<@${userId}>`;
  const organizerNote = wasOrganizer
    ? " They remain the Overlord until campaign control is transferred in the web app."
    : "";

  return buildStandardNotification({
    title: `${mention} resigned from ${gameName}`,
    facts: [
      `Seat ${turnOrder} is now empty and will be skipped during turn rotation.${organizerNote}`,
    ],
    mentionedUserIds: [userId],
  });
}

export function buildSeatFilledReply(
  gameName: string,
  playerDisplayName: string,
  seatNumber: number | string,
): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: "Seat filled",
    facts: [
      `Seat ${seatNumber} has been filled by **${playerDisplayName}** in **${gameName}**.`,
    ],
  });
}

export function buildSeatFilledAnnouncement(
  userId: string,
  gameName: string,
  seatNumber: number | string,
  tookActiveTurn: boolean,
): MessageCreateOptions {
  const mention = `<@${userId}>`;
  const activeTurnNote = tookActiveTurn ? ` It is now ${mention}'s turn.` : "";

  return buildStandardNotification({
    title: `${mention} joined ${gameName}`,
    facts: [`They have taken seat ${seatNumber}.${activeTurnNote}`],
    mentionedUserIds: [userId],
  });
}

export function buildTurnSkippedReply(
  gameName: string,
  skippedName: string,
  skippedSeat: number | string,
): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: "Turn skipped",
    facts: [
      `**${skippedName}**'s turn (seat ${skippedSeat}) has been skipped in **${gameName}**.`,
    ],
  });
}

export function buildTurnAdvancedAnnouncement({
  gameName,
  skippedName,
  skippedSeat,
  nextName,
  nextDiscordId,
  nextSeat,
}: {
  gameName: string;
  skippedName: string;
  skippedSeat: number | string;
  nextName: string;
  nextDiscordId: string | null;
  nextSeat: number | string;
}): MessageCreateOptions {
  const nextMention = nextDiscordId
    ? `<@${nextDiscordId}>`
    : `**${nextName}**`;

  return buildStandardNotification({
    title: `Turn advanced in ${gameName}`,
    facts: [
      `**${skippedName}** (seat ${skippedSeat}) was skipped. It is now ${nextMention}'s turn (seat ${nextSeat}).`,
    ],
    mentionedUserIds: nextDiscordId ? [nextDiscordId] : [],
  });
}

export function buildGameLinkReply(
  gameUrl: string,
): InteractionEditReplyOptions {
  return buildStandardEditReply({
    facts: [`<${gameUrl}>`],
  });
}

export function buildRegistrationSubmittedReply(
  gameName: string,
): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: "Registration submitted",
    facts: [
      `Your registration request for **${gameName}** has been submitted. The game overlord must approve it before you are added.`,
    ],
  });
}

export function buildApprovalFailureReply(
  action: ApprovalAction,
  errorMessage: string,
): InteractionReplyOptions {
  return buildStandardReply({
    title: action === "approve" ? "Approval failed" : "Rejection failed",
    facts: [errorMessage],
    ephemeral: true,
  });
}

export function buildShadowCloudUnavailableReply(): InteractionEditReplyOptions {
  return buildStandardEditReply({
    title: "Shadow Cloud unavailable",
    facts: ["Unable to reach the Shadow Cloud API right now."],
  });
}
