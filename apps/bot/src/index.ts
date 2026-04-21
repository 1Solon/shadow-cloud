import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
  type AnyThreadChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  buildApprovalNotificationMessage,
  buildGameInitNotificationMessage,
  buildNotificationResultText,
  buildSaveNotificationMessage,
  type GameInitializedNotificationPayload,
  type UploadNotificationPayload,
} from "./notifications.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);

loadEnv({ path: resolve(currentDirectory, "../../../.env") });

const token = process.env.DISCORD_BOT_TOKEN;
const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";
const webBaseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
const botApiToken = process.env.BOT_API_TOKEN;
const notificationSecret = process.env.SHADOW_CLOUD_BOT_NOTIFY_SECRET;
const notificationPort = 3011;

if (!token) {
  console.warn(
    "DISCORD_BOT_TOKEN is not set. The bot will not start until the environment is configured.",
  );
  process.exit(0);
}

if (!botApiToken) {
  console.warn(
    "BOT_API_TOKEN is not set. The bot cannot create games until the environment is configured.",
  );
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const dlcChoices = [
  { name: "None", value: "NONE" },
  { name: "Oceania", value: "OCEANIA" },
  { name: "Republica", value: "REPUBLICA" },
  { name: "Both", value: "BOTH" },
] as const;

const gameModeChoices = [
  { name: "Teams", value: "TEAMS" },
  { name: "Teams+AI", value: "TEAMS_AI" },
  { name: "FFA", value: "FFA" },
  { name: "FFA+AI", value: "FFA_AI" },
] as const;

const techLevelChoices = [
  { name: "3", value: 3 },
  { name: "4", value: 4 },
  { name: "5", value: 5 },
] as const;

const zoneCountChoices = [
  { name: "City State", value: "CITY_STATE" },
  { name: "2 Zone Start", value: "TWO_ZONE_START" },
  { name: "3 Zone Start", value: "THREE_ZONE_START" },
] as const;

const armyCountChoices = [
  { name: "Militia Only", value: "MILITIA_ONLY" },
  { name: "1 Army per Zone", value: "ONE_PER_ZONE" },
  { name: "2 Armies per Zone", value: "TWO_PER_ZONE" },
] as const;

const initCommand = new SlashCommandBuilder()
  .setName("init")
  .setDescription(
    "Create a Shadow Cloud game record for the current forum thread.",
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("Game title.")
      .setRequired(true)
      .setMaxLength(100),
  )
  .addIntegerOption((option) =>
    option
      .setName("number")
      .setDescription("Game number.")
      .setRequired(true)
      .setMinValue(1),
  )
  .addIntegerOption((option) =>
    option
      .setName("player_count")
      .setDescription("Player count for this game setup.")
      .setRequired(false)
      .setMinValue(1),
  )
  .addBooleanOption((option) =>
    option
      .setName("ai_players")
      .setDescription("Whether AI players are included.")
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("dlc")
      .setDescription("Included DLCs.")
      .setRequired(false)
      .addChoices(...dlcChoices),
  )
  .addStringOption((option) =>
    option
      .setName("gamemode")
      .setDescription("Game mode.")
      .setRequired(false)
      .addChoices(...gameModeChoices),
  )
  .addIntegerOption((option) =>
    option
      .setName("tech_level")
      .setDescription("Tech level.")
      .setRequired(false)
      .addChoices(...techLevelChoices),
  )
  .addStringOption((option) =>
    option
      .setName("zone_count")
      .setDescription("Zone count preset.")
      .setRequired(false)
      .addChoices(...zoneCountChoices),
  )
  .addStringOption((option) =>
    option
      .setName("army_count")
      .setDescription("Army count preset.")
      .setRequired(false)
      .addChoices(...armyCountChoices),
  );

const registerCommand = new SlashCommandBuilder()
  .setName("register")
  .setDescription(
    "Register yourself as the next player in the current Shadow Cloud game thread.",
  );

const resignCommand = new SlashCommandBuilder()
  .setName("resign")
  .setDescription("Remove yourself from the current Shadow Cloud game thread.")
  .addUserOption((option) =>
    option
      .setName("new_organizer")
      .setDescription(
        "Required if you are the organizer: the player who will take over as organizer.",
      ),
  );

const replaceCommand = new SlashCommandBuilder()
  .setName("replace")
  .setDescription("Fill an empty seat with a new player (overlord only).")
  .addIntegerOption((option) =>
    option
      .setName("seat")
      .setDescription("The seat number to fill.")
      .setMinValue(1)
      .setRequired(true),
  )
  .addUserOption((option) =>
    option
      .setName("player")
      .setDescription("The Discord user to place in the seat.")
      .setRequired(true),
  );

const skipCommand = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current active player's turn (overlord only).");

async function resolveNotificationThread(threadId: string) {
  const channel = await client.channels.fetch(threadId);

  if (!channel || !channel.isThread()) {
    throw new Error(`Channel ${threadId} is not a thread.`);
  }

  if (channel.joinable) {
    await channel.join().catch(() => undefined);
  }

  return channel;
}

function startNotificationServer() {
  if (!notificationSecret) {
    console.warn(
      "SHADOW_CLOUD_BOT_NOTIFY_SECRET is not set. Bot notifications are disabled.",
    );
    return;
  }

  const server = createServer(async (request, response) => {
    const isSaveUploadedRequest = request.url === "/notify/save-uploaded";
    const isGameInitializedRequest = request.url === "/notify/game-initialized";

    if (
      request.method !== "POST" ||
      (!isSaveUploadedRequest && !isGameInitializedRequest)
    ) {
      response.writeHead(404).end("Not found");
      return;
    }

    if (
      request.headers["x-shadow-cloud-notify-secret"] !== notificationSecret
    ) {
      response.writeHead(401).end("Unauthorized");
      return;
    }

    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as
        | UploadNotificationPayload
        | GameInitializedNotificationPayload;

      if (!payload.game.discordThreadId) {
        response.writeHead(202).end("No thread configured");
        return;
      }

      const thread = await resolveNotificationThread(
        payload.game.discordThreadId,
      );
      await thread.send(
        isSaveUploadedRequest
          ? buildSaveNotificationMessage(
              payload as UploadNotificationPayload,
              webBaseUrl,
            )
          : buildGameInitNotificationMessage(
              payload as GameInitializedNotificationPayload,
              webBaseUrl,
            ),
      );

      response.writeHead(204).end();
    } catch (error) {
      console.error("Failed to process bot notification.", error);
      response.writeHead(500).end("Failed to post notification");
    }
  });

  server.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.warn(
        `Notification server port ${notificationPort} is already in use. Reusing the existing listener.`,
      );
      return;
    }

    throw error;
  });

  server.listen(notificationPort, () => {
    console.log(
      `Shadow Cloud notification server listening on ${notificationPort}`,
    );
  });
}

async function resolveThreadChannel(
  interaction: ChatInputCommandInteraction,
  commandName: string,
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

async function sendBotRequest(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
) {
  if (interaction.commandName === "init") {
    const gameName = interaction.options.getString("title", true).trim();
    const gameNumber = interaction.options.getInteger("number", true);
    const playerCount =
      interaction.options.getInteger("player_count") ?? undefined;
    const hasAiPlayers =
      interaction.options.getBoolean("ai_players") ?? undefined;
    const dlcMode = interaction.options.getString("dlc") ?? undefined;
    const gameMode = interaction.options.getString("gamemode") ?? undefined;
    const techLevel = interaction.options.getInteger("tech_level") ?? undefined;
    const zoneCount = interaction.options.getString("zone_count") ?? undefined;
    const armyCount = interaction.options.getString("army_count") ?? undefined;
    const response = await fetch(`${apiBaseUrl}/v1/games/init`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shadow-cloud-bot-token": botApiToken ?? "",
      },
      body: JSON.stringify({
        gameNumber,
        name: gameName,
        ...(playerCount != null ? { playerCount } : {}),
        ...(hasAiPlayers != null ? { hasAiPlayers } : {}),
        ...(dlcMode != null ? { dlcMode } : {}),
        ...(gameMode != null ? { gameMode } : {}),
        ...(techLevel != null ? { techLevel } : {}),
        ...(zoneCount != null ? { zoneCount } : {}),
        ...(armyCount != null ? { armyCount } : {}),
        organizerDiscordId: interaction.user.id,
        organizerDisplayName:
          interaction.user.globalName ?? interaction.user.username,
        organizerUsername: interaction.user.username,
        discordGuildId: interaction.guildId,
        discordChannelId: channel.parentId,
        discordThreadId: channel.id,
      }),
    });

    return {
      response,
      fallbackName: gameName,
    };
  }

  if (interaction.commandName === "register") {
    const response = await fetch(`${apiBaseUrl}/v1/games/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shadow-cloud-bot-token": botApiToken ?? "",
      },
      body: JSON.stringify({
        discordThreadId: channel.id,
        playerDiscordId: interaction.user.id,
        playerDisplayName:
          interaction.user.globalName ?? interaction.user.username,
        playerUsername: interaction.user.username,
      }),
    });

    return {
      response,
      fallbackName: channel.name,
    };
  }

  // resign
  const newOrganizerUser = interaction.options.getUser("new_organizer");
  const resignResponse = await fetch(`${apiBaseUrl}/v1/games/resign`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shadow-cloud-bot-token": botApiToken ?? "",
    },
    body: JSON.stringify({
      discordThreadId: channel.id,
      playerDiscordId: interaction.user.id,
      ...(newOrganizerUser
        ? { newOrganizerDiscordId: newOrganizerUser.id }
        : {}),
    }),
  });

  return {
    response: resignResponse,
    fallbackName: channel.name,
  };
}

async function sendReplaceRequest(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
) {
  const seatNumber = interaction.options.getInteger("seat", true);
  const newPlayer = interaction.options.getUser("player", true);

  const response = await fetch(`${apiBaseUrl}/v1/games/replace`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shadow-cloud-bot-token": botApiToken ?? "",
    },
    body: JSON.stringify({
      discordThreadId: channel.id,
      callerDiscordId: interaction.user.id,
      seatNumber,
      newPlayerDiscordId: newPlayer.id,
      newPlayerDisplayName: newPlayer.globalName ?? newPlayer.username,
      newPlayerUsername: newPlayer.username,
    }),
  });

  return { response, fallbackName: channel.name };
}

async function sendSkipRequest(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
) {
  const response = await fetch(`${apiBaseUrl}/v1/games/skip`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shadow-cloud-bot-token": botApiToken ?? "",
    },
    body: JSON.stringify({
      discordThreadId: channel.id,
      callerDiscordId: interaction.user.id,
    }),
  });

  return { response, fallbackName: channel.name };
}

const APPROVE_PREFIX = "sc_approve_";
const REJECT_PREFIX = "sc_reject_";

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
  interaction: import("discord.js").ButtonInteraction,
  requestId: string,
  action: "approve" | "reject",
) {
  await interaction.deferUpdate();

  const endpoint = `${apiBaseUrl}/v1/games/registration-requests/${encodeURIComponent(requestId)}/${action}`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-shadow-cloud-bot-token": botApiToken ?? "",
      },
      body: JSON.stringify({ discordMessageId: interaction.message.id }),
    });

    const payload = (await response.json().catch(() => null)) as {
      name?: string;
      player?: { displayName?: string; turnOrder?: number };
    } | null;

    if (!response.ok) {
      await interaction.followUp({
        content: `Failed to ${action} registration.`,
        ephemeral: true,
      });
      return;
    }

    const playerName = payload?.player?.displayName ?? "Player";
    const gameName = payload?.name ?? "the game";

    // Disable the buttons on the original message
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
      content: `Unable to reach the Shadow Cloud API right now.`,
      ephemeral: true,
    });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Shadow Cloud bot ready as ${readyClient.user.tag}`);

  await readyClient.application.commands.set([
    initCommand.toJSON(),
    registerCommand.toJSON(),
    resignCommand.toJSON(),
    replaceCommand.toJSON(),
    skipCommand.toJSON(),
  ]);
  console.log("Registered Shadow Cloud slash commands.");
  startNotificationServer();
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Handle registration approval/rejection button presses
  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith(APPROVE_PREFIX)) {
      await handleRegistrationButton(
        interaction,
        customId.slice(APPROVE_PREFIX.length),
        "approve",
      );
      return;
    }
    if (customId.startsWith(REJECT_PREFIX)) {
      await handleRegistrationButton(
        interaction,
        customId.slice(REJECT_PREFIX.length),
        "reject",
      );
      return;
    }
    return;
  }

  if (
    !interaction.isChatInputCommand() ||
    !["init", "register", "resign", "replace", "skip"].includes(
      interaction.commandName,
    )
  ) {
    return;
  }

  const commandName = interaction.commandName;
  const { channel, observedType } = await resolveThreadChannel(
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

  if (!botApiToken) {
    await interaction.reply({
      content: "BOT_API_TOKEN is not configured for the bot.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const { response, fallbackName } =
      commandName === "replace"
        ? await sendReplaceRequest(interaction, channel)
        : commandName === "skip"
          ? await sendSkipRequest(interaction, channel)
          : await sendBotRequest(interaction, channel);

    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      gameNumber?: number;
      slug?: string;
      name?: string;
      requestId?: string;
      organizerDiscordId?: string;
      player?: {
        displayName?: string;
        discordId?: string;
        turnOrder?: number;
        wasOrganizer?: boolean;
        tookActiveTurn?: boolean;
      };
      skippedPlayer?: { displayName?: string | null; turnOrder?: number };
      nextPlayer?: {
        displayName?: string | null;
        discordId?: string | null;
        turnOrder?: number;
      };
    } | null;

    if (!response.ok) {
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

      await interaction.editReply(
        commandName === "init"
          ? `Unable to initialize this game: ${errorMessage}`
          : commandName === "resign"
            ? `Unable to resign from this game: ${errorMessage}`
            : commandName === "replace"
              ? `Unable to fill this seat: ${errorMessage}`
              : commandName === "skip"
                ? `Unable to skip this player: ${errorMessage}`
                : `Unable to register for this game: ${errorMessage}`,
      );
      return;
    }

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
        payload?.player?.turnOrder ?? interaction.options.getInteger("seat");
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

      const nextMention = nextDiscordId
        ? `<@${nextDiscordId}>`
        : `**${nextName}**`;
      const allowedMentions = nextDiscordId ? { users: [nextDiscordId] } : {};
      await channel.send({
        content: `**${skippedName}** (seat ${skippedSeat}) has been skipped in **${gameName}**. It is now ${nextMention}'s turn (seat ${nextSeat}).`,
        allowedMentions,
      });
      return;
    }

    // register — pending approval flow
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

    if (requestId && channel) {
      await sendApprovalMessage(
        channel,
        requestId,
        applicantName,
        gameName,
        organizerDiscordId ?? null,
      );
    }
  } catch (error) {
    console.error(`Failed to ${commandName} game from Discord.`, error);
    await interaction.editReply(
      "Unable to reach the Shadow Cloud API right now.",
    );
  }
});

void client.login(token);
