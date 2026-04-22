import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
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
  buildApprovalNotificationMessage,
  buildNotificationResultText,
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
      console.warn(`Guild channel fetch failed for /${commandName} interaction.`, {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        error,
      });
    }
  }

  if (!resolvedChannel && interaction.channelId) {
    try {
      resolvedChannel = await client.channels.fetch(interaction.channelId);
    } catch (error) {
      console.warn(`Client channel fetch failed for /${commandName} interaction.`, {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        error,
      });
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
      await interaction.followUp({
        content: `Failed to ${action} registration.`,
        ephemeral: true,
      });
      return;
    }

    const playerName = payload?.player?.displayName ?? "Player";
    const gameName = payload?.name ?? "the game";
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

    await interaction.editReply({
      content: buildNotificationResultText({
        approved: action === "approve",
        gameName,
        playerName,
        turnOrder: payload?.player?.turnOrder,
      }),
      components: [disabledRow],
    });
  } catch (error) {
    console.error(`Failed to ${action} registration ${requestId}.`, error);
    await interaction.followUp({
      content: "Unable to reach the Shadow Cloud API right now.",
      ephemeral: true,
    });
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

  return commandName === "init"
    ? `Unable to initialize this game: ${errorMessage}`
    : commandName === "resign"
      ? `Unable to resign from this game: ${errorMessage}`
      : commandName === "replace"
        ? `Unable to fill this seat: ${errorMessage}`
        : commandName === "skip"
          ? `Unable to skip this player: ${errorMessage}`
          : `Unable to register for this game: ${errorMessage}`;
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
      `You have successfully resigned from **${gameName}**.`,
    );

    const mention = `<@${interaction.user.id}>`;
    const organizerNote = wasOrganizer
      ? " The organizer role has been transferred."
      : "";
    await channel.send({
      content: `**${mention} has resigned from ${gameName}** (seat ${payload?.player?.turnOrder ?? "?"}).${organizerNote} Their seat will be skipped during turn rotation.`,
      allowedMentions: { users: [interaction.user.id] },
    });
    return;
  }

  if (commandName === "replace") {
    const gameName = payload?.name ?? fallbackName;
    const playerDisplayName = payload?.player?.displayName ?? "Unknown";
    const seatNumber =
      payload?.player?.turnOrder ?? interaction.options.getInteger("seat", true);
    const newPlayerUser = interaction.options.getUser("player", true);
    const tookActiveTurn = payload?.player?.tookActiveTurn ?? false;

    await interaction.editReply(
      `Seat ${seatNumber} has been filled by **${playerDisplayName}** in **${gameName}**.`,
    );

    const mention = `<@${newPlayerUser.id}>`;
    const activeTurnNote = tookActiveTurn
      ? ` It is now ${mention}'s turn.`
      : "";
    await channel.send({
      content: `**${mention} has joined ${gameName}** and taken seat ${seatNumber}.${activeTurnNote}`,
      allowedMentions: { users: [newPlayerUser.id] },
    });
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
      `**${skippedName}**'s turn (seat ${skippedSeat}) has been skipped in **${gameName}**.`,
    );

    const nextMention = nextDiscordId ? `<@${nextDiscordId}>` : `**${nextName}**`;
    const allowedMentions = nextDiscordId ? { users: [nextDiscordId] } : {};
    await channel.send({
      content: `**${skippedName}** (seat ${skippedSeat}) has been skipped in **${gameName}**. It is now ${nextMention}'s turn (seat ${nextSeat}).`,
      allowedMentions,
    });
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
    `Your registration request for **${gameName}** has been submitted. The game overlord must approve it before you are added.`,
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
      console.warn(`${commandName} command was invoked outside a thread context.`, {
        channelId: interaction.channelId,
        observedType,
        guildId: interaction.guildId,
      });

      await interaction.reply({
        content: `Run /${commandName} inside the forum thread that should own the game. Observed channel type: ${observedType}, channel id: ${interaction.channelId}.`,
        ephemeral: true,
      });
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
      await interaction.reply({
        content: `Run /${commandName} inside a Discord forum thread.`,
        ephemeral: true,
      });
      return;
    }

    if (!config.botApiToken) {
      await interaction.reply({
        content: "BOT_API_TOKEN is not configured for the bot.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const { fallbackName, payload, response } = await sendCommandRequest(
        interaction,
        channel,
        config,
      );

      if (!response.ok) {
        await interaction.editReply(buildCommandErrorReply(commandName, payload));
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
        "Unable to reach the Shadow Cloud API right now.",
      );
    }
  };
}