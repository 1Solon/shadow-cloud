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
  sendHostCommandAuthorizationRequest,
  sendCommandRequest,
  sendRegistrationApprovalRequest,
} from "./bot-api.js";
import {
  isSupportedCommandName,
  type SupportedCommandName,
} from "./commands.js";
import {
  buildApprovalNotificationMessage,
  buildApprovalResultMessage,
  buildDiscordEditReply,
  buildDiscordReply,
} from "./notifications.js";
import { parseThreadMessageTarget } from "./message-target.js";
import {
  buildDebugPreviews,
  debugPreviewNames,
  selectDebugPreviewNames,
} from "./debug-previews.js";
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
      interaction.user.id,
      config,
    );

    if (!response.ok) {
      const errorMessage = Array.isArray(payload?.message)
        ? payload.message.join(", ")
        : (payload?.message ??
          payload?.error ??
          `Failed to ${action} registration.`);

      await interaction.followUp(
        buildApprovalFailureReply(action, errorMessage),
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
      buildDiscordReply({
        headline: "Shadow Cloud unavailable",
        message:
          "Unable to reach the Shadow Cloud API right now. Please try again.",
        ephemeral: true,
      }),
    );
  }
}

function isPinningCommand(
  commandName: SupportedCommandName,
): commandName is "pin" | "unpin" {
  return commandName === "pin" || commandName === "unpin";
}

async function handlePinningCommand(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  config: BotApiConfig,
  commandName: "pin" | "unpin",
) {
  const target = parseThreadMessageTarget(
    interaction.options.getString("message", true),
    {
      guildId: interaction.guildId,
      channelId: channel.id,
    },
  );

  if (!target.ok) {
    await interaction.editReply(buildInvalidMessageTargetReply());
    return;
  }

  const { payload, response } = await sendHostCommandAuthorizationRequest(
    commandName,
    interaction,
    channel,
    config,
  );

  if (!response.ok) {
    await interaction.editReply(buildCommandErrorReply(commandName, payload));
    return;
  }

  try {
    const message = await channel.messages.fetch(target.messageId);

    if (commandName === "pin") {
      await message.pin();
      await interaction.editReply(
        buildMessagePinReply("pin", target.messageId),
      );
      return;
    }

    await message.unpin();
    await interaction.editReply(
      buildMessagePinReply("unpin", target.messageId),
    );
  } catch (error) {
    console.warn(`Failed to ${commandName} Discord message.`, {
      channelId: channel.id,
      guildId: interaction.guildId,
      messageId: target.messageId,
      error,
    });
    await interaction.editReply(buildDiscordPinFailureReply(commandName));
  }
}

async function handleSuccessfulCommand(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  config: BotApiConfig,
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

    await interaction.editReply(buildResignationCompleteReply(gameName));
    await channel.send(
      buildResignationAnnouncement(
        interaction.user.id,
        gameName,
        payload?.player?.turnOrder ?? "?",
        wasOrganizer,
      ),
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
      buildSeatFilledReply(gameName, playerDisplayName, seatNumber),
    );
    await channel.send(
      buildSeatFilledAnnouncement(
        newPlayerUser.id,
        gameName,
        seatNumber,
        tookActiveTurn,
      ),
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
      buildTurnSkippedReply(gameName, skippedName, skippedSeat),
    );
    await channel.send(
      buildTurnAdvancedAnnouncement({
        gameName,
        skippedName,
        skippedSeat,
        nextName,
        nextDiscordId,
        nextSeat,
      }),
    );
    return;
  }

  if (commandName === "link") {
    const gameNumber = payload?.gameNumber;
    const gameUrl =
      gameNumber != null
        ? new URL(
            `/games/${encodeURIComponent(String(gameNumber))}`,
            config.webBaseUrl,
          ).toString()
        : config.webBaseUrl;

    await interaction.editReply(buildGameLinkReply(gameUrl));
    return;
  }

  const requestId = payload?.requestId;
  const organizerDiscordId = payload?.organizerDiscordId;
  const applicantName =
    payload?.player?.displayName ??
    interaction.user.globalName ??
    interaction.user.username;
  const gameName = payload?.name ?? fallbackName;

  await interaction.editReply(buildRegistrationSubmittedReply(gameName));

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

async function handleDebugCommand(
  interaction: ChatInputCommandInteraction,
  webBaseUrl: string,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const selection = selectDebugPreviewNames(
    interaction.options.getString("notifications"),
  );

  if (!selection.ok) {
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
    return;
  }

  const previews = buildDebugPreviews(selection.names, {
    userId: interaction.user.id,
    userDisplayName: interaction.user.globalName ?? interaction.user.username,
    webBaseUrl,
  });
  const [firstPreview, ...remainingPreviews] = previews;

  if (!firstPreview) {
    return;
  }

  await interaction.editReply({
    components: firstPreview.message.components,
    allowedMentions: firstPreview.message.allowedMentions,
    flags: MessageFlags.IsComponentsV2,
  });

  for (const preview of remainingPreviews) {
    await interaction.followUp(preview.message);
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

    if (interaction.commandName === "debug") {
      try {
        await handleDebugCommand(interaction, config.webBaseUrl);
      } catch (error) {
        console.error("Failed to deliver Discord debug previews.", error);
        await interaction
          .editReply(buildShadowCloudUnavailableReply())
          .catch(() => undefined);
      }
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
        buildWrongChannelReply(
          commandName,
          observedType,
          interaction.channelId,
        ),
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
      await interaction.reply(buildForumThreadRequiredReply(commandName));
      return;
    }

    if (!config.botApiToken) {
      await interaction.reply(buildBotMisconfiguredReply());
      return;
    }

    await interaction.deferReply(
      commandName === "link" ? undefined : { flags: MessageFlags.Ephemeral },
    );

    try {
      if (isPinningCommand(commandName)) {
        await handlePinningCommand(interaction, channel, config, commandName);
        return;
      }

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
        config,
        commandName,
        payload,
        fallbackName,
      );
    } catch (error) {
      console.error(`Failed to ${commandName} game from Discord.`, error);
      await interaction.editReply(buildShadowCloudUnavailableReply());
    }
  };
}
