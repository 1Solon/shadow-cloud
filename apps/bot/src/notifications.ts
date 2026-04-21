import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  type MessageCreateOptions,
} from "discord.js";

const ACCENT_COLOR = 0xffa500;

export type UploadNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
    discordThreadId: string | null;
  };
  upload: {
    versionId: string;
    versionNumber: number;
    originalName: string;
    uploadedAt: string;
    uploadedBy: {
      id: string;
      displayName: string;
      discordId: string | null;
    };
  };
  turn: {
    roundNumber: number;
    roundAdvanced: boolean;
    activePlayer: {
      id: string;
      displayName: string;
      discordId: string | null;
      turnOrder: number;
    };
  };
  players: Array<{
    id: string;
    displayName: string;
    discordId: string | null;
    turnOrder: number;
  }>;
};

export type GameInitializedNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
    gameNumber: number;
    discordThreadId: string | null;
    playerCount: number | null;
    hasAiPlayers: boolean | null;
    dlcMode: string | null;
    gameMode: string | null;
    techLevel: number | null;
    zoneCount: string | null;
    armyCount: string | null;
  };
  organizer: {
    id: string;
    displayName: string;
    discordId: string | null;
  };
};

type StandardNotificationOptions = {
  title: string;
  facts: string[];
  actionLines?: string[];
  actionRow?: ActionRowBuilder<ButtonBuilder>;
  mentionedUserIds?: string[];
};

function buildStandardNotification({
  title,
  facts,
  actionLines = [],
  actionRow,
  mentionedUserIds = [],
}: StandardNotificationOptions): MessageCreateOptions {
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addTextDisplayComponents(
      (textDisplay) => textDisplay.setContent(`## ${title}`),
      (textDisplay) => textDisplay.setContent(facts.join("\n")),
    );

  if (actionLines.length > 0) {
    container
      .addSeparatorComponents((separator) =>
        separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      )
      .addTextDisplayComponents((textDisplay) =>
        textDisplay.setContent(actionLines.join("\n")),
      );
  }

  if (actionRow) {
    container.addActionRowComponents(actionRow);
  }

  const uniqueMentionedUserIds = Array.from(
    new Set(mentionedUserIds.filter((userId) => userId.length > 0)),
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions:
      uniqueMentionedUserIds.length > 0
        ? { users: uniqueMentionedUserIds }
        : undefined,
  };
}

function formatDiscordActor(displayName: string, discordId: string | null) {
  return discordId ? `<@${discordId}>` : displayName;
}

function formatUploadedAt(uploadedAt: string) {
  const parsedDate = new Date(uploadedAt);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return `<t:${Math.floor(parsedDate.getTime() / 1000)}:F>`;
}

function formatGameSetting(label: string, value: string | number | null) {
  if (value == null) {
    return null;
  }

  return `${label}: ${value}`;
}

function formatEnumLabel(value: string | null, labels: Record<string, string>) {
  if (!value) {
    return null;
  }

  return labels[value] ?? value;
}

function buildGameSettingsLine(
  game: GameInitializedNotificationPayload["game"],
) {
  const settings = [
    formatGameSetting(
      "DLC",
      formatEnumLabel(game.dlcMode, {
        NONE: "None",
        OCEANIA: "Oceania",
        REPUBLICA: "Republica",
        BOTH: "Both",
      }),
    ),
    formatGameSetting(
      "Mode",
      formatEnumLabel(game.gameMode, {
        TEAMS: "Teams",
        TEAMS_AI: "Teams+AI",
        FFA: "FFA",
        FFA_AI: "FFA+AI",
      }),
    ),
    formatGameSetting("Tech", game.techLevel),
    formatGameSetting(
      "Zones",
      formatEnumLabel(game.zoneCount, {
        CITY_STATE: "City State",
        TWO_ZONE_START: "2 Zone Start",
        THREE_ZONE_START: "3 Zone Start",
      }),
    ),
    formatGameSetting(
      "Armies",
      formatEnumLabel(game.armyCount, {
        MILITIA_ONLY: "Militia Only",
        ONE_PER_ZONE: "1 Army per Zone",
        TWO_PER_ZONE: "2 Armies per Zone",
      }),
    ),
    formatGameSetting(
      "AI",
      game.hasAiPlayers == null ? null : game.hasAiPlayers ? "Yes" : "No",
    ),
  ].filter((setting): setting is string => setting != null);

  if (settings.length === 0) {
    return null;
  }

  return `**Settings** ${settings.join(" | ")}`;
}

export function buildGameInitNotificationMessage(
  payload: GameInitializedNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const organizerLabel = formatDiscordActor(
    payload.organizer.displayName,
    payload.organizer.discordId,
  );
  const gameUrl = new URL(
    `/games/${encodeURIComponent(payload.game.slug)}`,
    webBaseUrl,
  ).toString();
  const settingsLine = buildGameSettingsLine(payload.game);

  return buildStandardNotification({
    title: `World initialized: ${payload.game.name}`,
    facts: [
      `**Game #** ${payload.game.gameNumber}`,
      `**Overlord** ${organizerLabel}`,
      payload.game.playerCount != null
        ? `**Seats** ${payload.game.playerCount}`
        : `**Seats** Not set yet`,
      ...(settingsLine ? [settingsLine] : []),
    ],
    actionLines: [
      `Review the [world page](${gameUrl}) for status, roster, and uploads.`,
      `Use /register in-thread to claim an open seat.`,
    ],
    mentionedUserIds: payload.organizer.discordId
      ? [payload.organizer.discordId]
      : [],
  });
}

export function buildSaveNotificationMessage(
  payload: UploadNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const nextPlayerLabel = formatDiscordActor(
    payload.turn.activePlayer.displayName,
    payload.turn.activePlayer.discordId,
  );
  const uploadedAtLabel = formatUploadedAt(payload.upload.uploadedAt);
  const gameUrl = new URL(
    `/games/${encodeURIComponent(payload.game.slug)}`,
    webBaseUrl,
  ).toString();
  const downloadUrl = new URL(
    `/api/games/${encodeURIComponent(payload.game.slug)}/files/${encodeURIComponent(payload.upload.versionId)}`,
    webBaseUrl,
  ).toString();

  return buildStandardNotification({
    title: `It is ${nextPlayerLabel}'s turn!`,
    facts: [
      `You can download the [current turn](${downloadUrl}) here, once done with your turn, upload your [completed turn](${gameUrl}).`,
    ],
    actionLines: uploadedAtLabel ? [`-# ${uploadedAtLabel}`] : [],
    mentionedUserIds: payload.turn.activePlayer.discordId
      ? [payload.turn.activePlayer.discordId]
      : [],
  });
}

export function buildApprovalNotificationMessage({
  applicantName,
  gameName,
  organizerDiscordId,
  approveButton,
  rejectButton,
}: {
  applicantName: string;
  gameName: string;
  organizerDiscordId: string | null;
  approveButton: ButtonBuilder;
  rejectButton: ButtonBuilder;
}): MessageCreateOptions {
  return buildStandardNotification({
    title: `Overlord action needed: ${formatDiscordActor("Overlord", organizerDiscordId)}`,
    facts: [`**World** ${gameName}`, `**Applicant** ${applicantName}`],
    actionLines: [`Approve or reject this registration request in-thread.`],
    actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
      approveButton,
      rejectButton,
    ),
    mentionedUserIds: organizerDiscordId ? [organizerDiscordId] : [],
  });
}

export function buildNotificationResultText({
  approved,
  gameName,
  playerName,
  turnOrder,
}: {
  approved: boolean;
  gameName: string;
  playerName: string;
  turnOrder?: number;
}) {
  if (!approved) {
    return `❌ Rejected **${playerName}** for **${gameName}**.`;
  }

  return `✅ Approved **${playerName}** for **${gameName}** as seat ${turnOrder ?? "unknown"}.`;
}

export { ACCENT_COLOR };
