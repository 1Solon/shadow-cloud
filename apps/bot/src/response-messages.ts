import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageCreateOptions,
} from "discord.js";
import type { ApprovalAction, CommandResponsePayload } from "./bot-api.js";
import type { SupportedCommandName } from "./commands.js";
import {
  buildDiscordEditReply,
  buildDiscordNotification,
  buildDiscordReply,
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
  return buildDiscordReply({
    headline: "Use this command in a game thread",
    message: `Run /${commandName} inside the forum thread that owns the game.`,
    details: [
      `**Channel type** ${observedType}`,
      `**Channel ID** ${channelId}`,
    ],
    ephemeral: true,
  });
}

export function buildForumThreadRequiredReply(
  commandName: string,
): InteractionReplyOptions {
  return buildDiscordReply({
    headline: "Use this command in a game thread",
    message: `Run /${commandName} inside a Discord forum thread.`,
    ephemeral: true,
  });
}

export function buildBotMisconfiguredReply(): InteractionReplyOptions {
  return buildDiscordReply({
    headline: "Bot misconfigured",
    message: "This bot cannot process commands until its API token is configured.",
    details: ["**Missing setting:** BOT_API_TOKEN"],
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

  return buildDiscordEditReply({
    headline: details.title,
    message: `Shadow Cloud could not complete /${commandName}.`,
    details: [`**Reason:** ${errorMessage}`],
  });
}

export function buildInvalidMessageTargetReply(): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: "Use a message from this thread",
    message: "Provide a Discord message ID or message link from this forum thread.",
  });
}

export function buildMessagePinReply(
  action: "pin" | "unpin",
  messageId: string,
): InteractionEditReplyOptions {
  const pinned = action === "pin";

  return buildDiscordEditReply({
    headline: pinned ? "Message pinned" : "Message unpinned",
    message: pinned
      ? `Message ${messageId} is now pinned in this thread.`
      : `Message ${messageId} is no longer pinned in this thread.`,
  });
}

export function buildDiscordPinFailureReply(
  action: "pin" | "unpin",
): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: action === "pin" ? "Pin failed" : "Unpin failed",
    message: "The bot could not access or modify that message.",
    details: [
      "**Next step:** Check that the message exists in this thread and that the bot can manage pinned messages.",
    ],
  });
}

export function buildResignationCompleteReply(
  gameName: string,
): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: "Resignation complete",
    message: `You resigned from **${gameName}**.`,
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
    ? " They remain the Overlord until campaign control is transferred in the webui."
    : "";

  return buildDiscordNotification({
    headline: `${mention} resigned from ${gameName}`,
    message: `**Seat ${turnOrder}** is now empty and will be skipped during turn rotation.${organizerNote}`,
    mentionedUserIds: [userId],
  });
}

export function buildSeatFilledReply(
  gameName: string,
  playerDisplayName: string,
  seatNumber: number | string,
): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: "Seat filled",
    message: `**${playerDisplayName}** now occupies seat ${seatNumber} in **${gameName}**.`,
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

  return buildDiscordNotification({
    headline: `${mention} joined ${gameName}`,
    message: `They have taken seat ${seatNumber}.${activeTurnNote}`,
    mentionedUserIds: [userId],
  });
}

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

export function buildGameLinkReply(
  gameUrl: string,
): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: "Open this game in Shadow Cloud",
    message: `[View the game](${gameUrl}) for status, roster, and uploads.`,
  });
}

export function buildRegistrationSubmittedReply(
  gameName: string,
): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: "Registration submitted",
    message: `Your request to join **${gameName}** is waiting for the game overlord's approval.`,
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
    details: [`**Reason:** ${errorMessage}`],
    ephemeral: true,
  });
}

export function buildShadowCloudUnavailableReply(): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: "Shadow Cloud unavailable",
    message: "Unable to reach the Shadow Cloud API right now. Please try again.",
  });
}
