import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  type AnyThreadChannel,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
} from "discord.js";
import {
  type ApprovalAction,
  type BotApiConfig,
  type CommandResponsePayload,
  sendCommandRequest,
  sendRegistrationApprovalRequest,
} from "./bot-api.js";
import {
  isSupportedCommandName,
  type SupportedCommandName,
} from "./commands.js";
import {
  buildStandardEditReply,
  buildStandardNotification,
  buildStandardReply,
  buildApprovalNotificationMessage,
  buildApprovalResultMessage,
} from "./notifications.js";

const APPROVE_PREFIX = "sc_approve_";
const REJECT_PREFIX = "sc_reject_";

async function resolveThreadChannel(
  client: Client,
  interaction: ChatInputCommandInteraction,
  commandName: SupportedCommandName,
) {
  let resolvedChannel: unknown = interaction.channel;

  if (!resolvedChannel && interaction.channelId) {
    try {
      resolvedChannel = await interaction.guild?.channels.fetch(
        interaction.channelId,
      );
    } catch (error) {
      console.warn(
        `Guild channel fetch failed for /${commandName} interaction.`,
        {
          channelId: interaction.channelId,
          guildId: interaction.guildId,
          error,
        },
      );
    }
  }

  if (!resolvedChannel && interaction.channelId) {
    try {
      resolvedChannel = await client.channels.fetch(interaction.channelId);
    } catch (error) {
      console.warn(
        `Client channel fetch failed for /${commandName} interaction.`,
        {
          channelId: interaction.channelId,
          guildId: interaction.guildId,
          error,
        },
      );
    }
  }

  if (
    !resolvedChannel ||
    typeof resolvedChannel !== "object" ||
    !("isThread" in resolvedChannel) ||
    typeof resolvedChannel.isThread !== "function" ||
    !resolvedChannel.isThread()
  ) {
    return {
      channel: null,
      observedType:
        resolvedChannel &&
        typeof resolvedChannel === "object" &&
        "type" in resolvedChannel
          ? String(resolvedChannel.type)
          : "unknown",
    };
  }

  const threadChannel = resolvedChannel as AnyThreadChannel;

  return {
    channel: threadChannel,
    observedType: String(threadChannel.type),
  };
}

async function sendApprovalMessage(
  channel: AnyThreadChannel,
  requestId: string,
  applicantName: string,
  gameName: string,
  organizerDiscordId: string | null,
) {
  const approveButton = new ButtonBuilder()
    .setCustomId(`${APPROVE_PREFIX}${requestId}`)
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success);
  const rejectButton = new ButtonBuilder()
    .setCustomId(`${REJECT_PREFIX}${requestId}`)
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger);

  await channel.send(
    buildApprovalNotificationMessage({
      applicantName,
      gameName,
      organizerDiscordId,
      approveButton,
      rejectButton,
    }),
  );
}

async function handleRegistrationButton(
  interaction: ButtonInteraction,
  requestId: string,
  action: ApprovalAction,
  config: BotApiConfig,
) {
  await interaction.deferUpdate();

  try {
    const { payload, response } = await sendRegistrationApprovalRequest(
      requestId,
      action,
      interaction.message.id,
      config,
    );

    if (!response.ok) {
      const errorMessage = Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ??
          payload?.error ??
          `Failed to ${action} registration.`);

      await interaction.followUp(
        buildStandardReply({
          title: action === "approve" ? "Approval failed" : "Rejection failed",
          facts: [errorMessage],
          ephemeral: true,
        }),
      );
      return;
    }

    const playerName = payload?.player?.displayName ?? "Player";
    const gameName = payload?.name ?? "the game";
    const gameUrl =
      payload?.gameNumber != null
        ? new URL(
            `/games/${encodeURIComponent(String(payload.gameNumber))}`,
            config.webBaseUrl,
          ).toString()
        : undefined;
    const disabledApprove = new ButtonBuilder()
      .setCustomId(`${APPROVE_PREFIX}${requestId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);
    const disabledReject = new ButtonBuilder()
      .setCustomId(`${REJECT_PREFIX}${requestId}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true);
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      disabledApprove,
      disabledReject,
    );

    await interaction.editReply(
      buildApprovalResultMessage({
        approved: action === "approve",
        gameName,
        gameUrl,
        playerName,
        turnOrder: payload?.player?.turnOrder,
        actionRow: disabledRow,
      }),
    );
  } catch (error) {
    console.error(`Failed to ${action} registration ${requestId}.`, error);
    await interaction.followUp(
      buildStandardReply({
        title: "Shadow Cloud unavailable",
        facts: ["Unable to reach the Shadow Cloud API right now."],
        ephemeral: true,
      }),
    );
  }
}

function buildCommandErrorReply(
  commandName: SupportedCommandName,
  payload: CommandResponsePayload,
) {
  const errorMessage = Array.isArray(payload?.message)
    ? payload.message.join(", ")
    : (payload?.message ??
      (commandName === "init"
        ? "The API rejected the game creation request."
        : commandName === "resign"
          ? "The API rejected the resignation request."
          : commandName === "replace"
            ? "The API rejected the replacement request."
            : commandName === "skip"
              ? "The API rejected the skip request."
              : "The API rejected the registration request."));

  return buildStandardEditReply({
    title:
      commandName === "init"
        ? "Initialization failed"
        : commandName === "resign"
          ? "Resignation failed"
          : commandName === "replace"
            ? "Replacement failed"
            : commandName === "skip"
              ? "Skip failed"
              : "Registration failed",
    facts: [errorMessage],
  });
}

async function handleSuccessfulCommand(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  commandName: SupportedCommandName,
  payload: CommandResponsePayload,
  fallbackName: string,
) {
  if (commandName === "init") {
    await interaction.deleteReply().catch(() => undefined);
    return;
  }

  if (commandName === "resign") {
    const gameName = payload?.name ?? fallbackName;
    const wasOrganizer = payload?.player?.wasOrganizer ?? false;

    await interaction.editReply(
      buildStandardEditReply({
        title: "Resignation complete",
        facts: [`You have successfully resigned from **${gameName}**.`],
      }),
    );

    const mention = `<@${interaction.user.id}>`;
    const organizerNote = wasOrganizer
      ? " They remain the Overlord until campaign control is transferred in the web app."
      : "";
    await channel.send(
      buildStandardNotification({
        title: `${mention} resigned from ${gameName}`,
        facts: [
          `Seat ${payload?.player?.turnOrder ?? "?"} is now empty and will be skipped during turn rotation.${organizerNote}`,
        ],
        mentionedUserIds: [interaction.user.id],
      }),
    );
    return;
  }

  if (commandName === "replace") {
    const gameName = payload?.name ?? fallbackName;
    const playerDisplayName = payload?.player?.displayName ?? "Unknown";
    const seatNumber =
      payload?.player?.turnOrder ??
      interaction.options.getInteger("seat", true);
    const newPlayerUser = interaction.options.getUser("player", true);
    const tookActiveTurn = payload?.player?.tookActiveTurn ?? false;

    await interaction.editReply(
      buildStandardEditReply({
        title: "Seat filled",
        facts: [
          `Seat ${seatNumber} has been filled by **${playerDisplayName}** in **${gameName}**.`,
        ],
      }),
    );

    const mention = `<@${newPlayerUser.id}>`;
    const activeTurnNote = tookActiveTurn
      ? ` It is now ${mention}'s turn.`
      : "";
    await channel.send(
      buildStandardNotification({
        title: `${mention} joined ${gameName}`,
        facts: [`They have taken seat ${seatNumber}.${activeTurnNote}`],
        mentionedUserIds: [newPlayerUser.id],
      }),
    );
    return;
  }

  if (commandName === "skip") {
    const gameName = payload?.name ?? fallbackName;
    const skippedName = payload?.skippedPlayer?.displayName ?? "Unknown";
    const skippedSeat = payload?.skippedPlayer?.turnOrder ?? "?";
    const nextName = payload?.nextPlayer?.displayName ?? "Unknown";
    const nextDiscordId = payload?.nextPlayer?.discordId ?? null;
    const nextSeat = payload?.nextPlayer?.turnOrder ?? "?";

    await interaction.editReply(
      buildStandardEditReply({
        title: "Turn skipped",
        facts: [
          `**${skippedName}**'s turn (seat ${skippedSeat}) has been skipped in **${gameName}**.`,
        ],
      }),
    );

    const nextMention = nextDiscordId
      ? `<@${nextDiscordId}>`
      : `**${nextName}**`;
    await channel.send(
      buildStandardNotification({
        title: `Turn advanced in ${gameName}`,
        facts: [
          `**${skippedName}** (seat ${skippedSeat}) was skipped. It is now ${nextMention}'s turn (seat ${nextSeat}).`,
        ],
        mentionedUserIds: nextDiscordId ? [nextDiscordId] : [],
      }),
    );
    return;
  }

  const requestId = payload?.requestId;
  const organizerDiscordId = payload?.organizerDiscordId;
  const applicantName =
    payload?.player?.displayName ??
    interaction.user.globalName ??
    interaction.user.username;
  const gameName = payload?.name ?? fallbackName;

  await interaction.editReply(
    buildStandardEditReply({
      title: "Registration submitted",
      facts: [
        `Your registration request for **${gameName}** has been submitted. The game overlord must approve it before you are added.`,
      ],
    }),
  );

  if (requestId) {
    await sendApprovalMessage(
      channel,
      requestId,
      applicantName,
      gameName,
      organizerDiscordId ?? null,
    );
  }
}

export function createInteractionHandler(client: Client, config: BotApiConfig) {
  return async (interaction: Interaction) => {
    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith(APPROVE_PREFIX)) {
        await handleRegistrationButton(
          interaction,
          customId.slice(APPROVE_PREFIX.length),
          "approve",
          config,
        );
        return;
      }

      if (customId.startsWith(REJECT_PREFIX)) {
        await handleRegistrationButton(
          interaction,
          customId.slice(REJECT_PREFIX.length),
          "reject",
          config,
        );
      }

      return;
    }

    if (
      !interaction.isChatInputCommand() ||
      !isSupportedCommandName(interaction.commandName)
    ) {
      return;
    }

    const commandName = interaction.commandName;
    const { channel, observedType } = await resolveThreadChannel(
      client,
      interaction,
      commandName,
    );

    if (!channel) {
      console.warn(
        `${commandName} command was invoked outside a thread context.`,
        {
          channelId: interaction.channelId,
          observedType,
          guildId: interaction.guildId,
        },
      );

      await interaction.reply(
        buildStandardReply({
          title: "Wrong channel",
          facts: [
            `Run /${commandName} inside the forum thread that should own the game.`,
            `Observed channel type: ${observedType}`,
            `Channel id: ${interaction.channelId}`,
          ],
          ephemeral: true,
        }),
      );
      return;
    }

    if (channel.joinable) {
      try {
        await channel.join();
      } catch (error) {
        console.warn(`Failed to join thread for /${commandName} interaction.`, {
          channelId: channel.id,
          guildId: interaction.guildId,
          error,
        });
      }
    }

    if (channel.parent?.type !== ChannelType.GuildForum) {
      await interaction.reply(
        buildStandardReply({
          title: "Wrong channel",
          facts: [`Run /${commandName} inside a Discord forum thread.`],
          ephemeral: true,
        }),
      );
      return;
    }

    if (!config.botApiToken) {
      await interaction.reply(
        buildStandardReply({
          title: "Bot misconfigured",
          facts: ["BOT_API_TOKEN is not configured for the bot."],
          ephemeral: true,
        }),
      );
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const { fallbackName, payload, response } = await sendCommandRequest(
        interaction,
        channel,
        config,
      );

      if (!response.ok) {
        await interaction.editReply(
          buildCommandErrorReply(commandName, payload),
        );
        return;
      }

      await handleSuccessfulCommand(
        interaction,
        channel,
        commandName,
        payload,
        fallbackName,
      );
    } catch (error) {
      console.error(`Failed to ${commandName} game from Discord.`, error);
      await interaction.editReply(
        buildStandardEditReply({
          title: "Shadow Cloud unavailable",
          facts: ["Unable to reach the Shadow Cloud API right now."],
        }),
      );
    }
  };
}
