import type { AnyThreadChannel, ChatInputCommandInteraction } from "discord.js";

export type BotApiConfig = {
  apiBaseUrl: string;
  botApiToken?: string;
};

export type ApprovalAction = "approve" | "reject";

export type CommandResponsePayload = {
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

type RegistrationApprovalPayload = {
  name?: string;
  player?: { displayName?: string; turnOrder?: number };
} | null;

type ParsedBotResponse<T> = {
  payload: T;
  response: Response;
};

export type CommandRequestResult = ParsedBotResponse<CommandResponsePayload> & {
  fallbackName: string;
};

function buildHeaders(botApiToken: string | undefined) {
  return {
    "content-type": "application/json",
    "x-shadow-cloud-bot-token": botApiToken ?? "",
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => null)) as T;
}

function postJson(url: string, botApiToken: string | undefined, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: buildHeaders(botApiToken),
    body: JSON.stringify(body),
  });
}

async function sendReplaceRequest(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  config: BotApiConfig,
): Promise<CommandRequestResult> {
  const seatNumber = interaction.options.getInteger("seat", true);
  const newPlayer = interaction.options.getUser("player", true);
  const response = await postJson(
    `${config.apiBaseUrl}/v1/games/replace`,
    config.botApiToken,
    {
      discordThreadId: channel.id,
      callerDiscordId: interaction.user.id,
      seatNumber,
      newPlayerDiscordId: newPlayer.id,
      newPlayerDisplayName: newPlayer.globalName ?? newPlayer.username,
      newPlayerUsername: newPlayer.username,
    },
  );

  return {
    response,
    payload: await parseJson<CommandResponsePayload>(response),
    fallbackName: channel.name,
  };
}

async function sendSkipRequest(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  config: BotApiConfig,
): Promise<CommandRequestResult> {
  const response = await postJson(
    `${config.apiBaseUrl}/v1/games/skip`,
    config.botApiToken,
    {
      discordThreadId: channel.id,
      callerDiscordId: interaction.user.id,
    },
  );

  return {
    response,
    payload: await parseJson<CommandResponsePayload>(response),
    fallbackName: channel.name,
  };
}

export async function sendCommandRequest(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  config: BotApiConfig,
): Promise<CommandRequestResult> {
  switch (interaction.commandName) {
    case "init": {
      const gameName = interaction.options.getString("title", true).trim();
      const gameNumber = interaction.options.getInteger("number", true);
      const playerCount =
        interaction.options.getInteger("player_count") ?? undefined;
      const hasAiPlayers =
        interaction.options.getBoolean("ai_players") ?? undefined;
      const dlcMode = interaction.options.getString("dlc") ?? undefined;
      const gameMode = interaction.options.getString("gamemode") ?? undefined;
      const techLevel =
        interaction.options.getInteger("tech_level") ?? undefined;
      const zoneCount =
        interaction.options.getString("zone_count") ?? undefined;
      const armyCount =
        interaction.options.getString("army_count") ?? undefined;
      const response = await postJson(
        `${config.apiBaseUrl}/v1/games/init`,
        config.botApiToken,
        {
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
        },
      );

      return {
        response,
        payload: await parseJson<CommandResponsePayload>(response),
        fallbackName: gameName,
      };
    }

    case "register": {
      const response = await postJson(
        `${config.apiBaseUrl}/v1/games/register`,
        config.botApiToken,
        {
          discordThreadId: channel.id,
          playerDiscordId: interaction.user.id,
          playerDisplayName:
            interaction.user.globalName ?? interaction.user.username,
          playerUsername: interaction.user.username,
        },
      );

      return {
        response,
        payload: await parseJson<CommandResponsePayload>(response),
        fallbackName: channel.name,
      };
    }

    case "resign": {
      const newOrganizerUser = interaction.options.getUser("new_organizer");
      const response = await postJson(
        `${config.apiBaseUrl}/v1/games/resign`,
        config.botApiToken,
        {
          discordThreadId: channel.id,
          playerDiscordId: interaction.user.id,
          ...(newOrganizerUser
            ? { newOrganizerDiscordId: newOrganizerUser.id }
            : {}),
        },
      );

      return {
        response,
        payload: await parseJson<CommandResponsePayload>(response),
        fallbackName: channel.name,
      };
    }

    case "replace":
      return sendReplaceRequest(interaction, channel, config);

    case "skip":
      return sendSkipRequest(interaction, channel, config);

    default:
      throw new Error(`Unsupported command: ${interaction.commandName}`);
  }
}

export async function sendRegistrationApprovalRequest(
  requestId: string,
  action: ApprovalAction,
  discordMessageId: string,
  config: BotApiConfig,
): Promise<ParsedBotResponse<RegistrationApprovalPayload>> {
  const response = await postJson(
    `${config.apiBaseUrl}/v1/games/registration-requests/${encodeURIComponent(requestId)}/${action}`,
    config.botApiToken,
    { discordMessageId },
  );

  return {
    response,
    payload: await parseJson<RegistrationApprovalPayload>(response),
  };
}
