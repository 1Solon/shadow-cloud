import {
  ActionRowBuilder,
  ButtonBuilder,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
} from "discord.js";

const ACCENT_COLOR = 0xffa500;

export type UploadNotificationPayload = {
  game: {
    id: string;
    gameNumber: number;
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

export type SaveReplacedNotificationPayload = {
  game: UploadNotificationPayload["game"];
  replacement: {
    versionId: string;
    versionNumber: number;
    originalName: string;
    replacedAt: string;
    replacedBy: {
      id: string;
      displayName: string;
      discordId: string | null;
    };
  };
};

export type GameInitializedNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
    threadName: string;
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

export type ThreadRenameNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
    threadName: string;
    discordThreadId: string | null;
  };
};

export type TurnNudgeNotificationPayload = {
  game: {
    id: string;
    gameNumber: number;
    slug: string;
    name: string;
    discordThreadId: string;
  };
  turnRecord: {
    id: string;
    roundNumber: number;
    startedAt: string;
    elapsedHours: number;
    targetHours: number;
    activePlayer: {
      id: string;
      displayName: string;
      discordId: string;
      turnOrder: number;
    };
  };
};

type DiscordResponseOptions = {
  headline: string;
  message: string;
  details?: string[];
  metadata?: string[];
  actionRow?: ActionRowBuilder<ButtonBuilder>;
  mentionedUserIds?: string[];
};

function buildDiscordResponseContainer({
  headline,
  message,
  details = [],
  metadata = [],
  actionRow,
}: DiscordResponseOptions) {
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLOR)
    .addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(`## ${headline}`),
    )
    .addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(message),
    );

  if (details.length > 0) {
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(details.join("\n")),
    );
  }

  const footerMetadata =
    metadata.length > 0
      ? metadata
      : [`-# <t:${Math.floor(Date.now() / 1000)}:F>`];

  container
    .addSeparatorComponents((separator) =>
      separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(footerMetadata.join("\n")),
    );

  if (actionRow) {
    container.addActionRowComponents(actionRow);
  }

  return container;
}

function buildAllowedMentions(mentionedUserIds: string[]) {
  const uniqueMentionedUserIds = Array.from(
    new Set(mentionedUserIds.filter((userId) => userId.length > 0)),
  );

  return uniqueMentionedUserIds.length > 0
    ? { users: uniqueMentionedUserIds }
    : undefined;
}

export function buildDiscordNotification({
  mentionedUserIds = [],
  ...options
}: DiscordResponseOptions): MessageCreateOptions {
  return {
    components: [buildDiscordResponseContainer(options)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: buildAllowedMentions(mentionedUserIds),
  };
}

export function buildDiscordReply({
  ephemeral = false,
  mentionedUserIds = [],
  ...options
}: DiscordResponseOptions & {
  ephemeral?: boolean;
}): InteractionReplyOptions {
  return {
    components: [buildDiscordResponseContainer(options)],
    flags: ephemeral
      ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      : MessageFlags.IsComponentsV2,
    allowedMentions: buildAllowedMentions(mentionedUserIds),
  };
}

export function buildDiscordEditReply({
  mentionedUserIds = [],
  ...options
}: DiscordResponseOptions): InteractionEditReplyOptions {
  return {
    components: [buildDiscordResponseContainer(options)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: buildAllowedMentions(mentionedUserIds),
  };
}

function formatDiscordActor(displayName: string, discordId: string | null) {
  return discordId ? `<@${discordId}>` : displayName;
}

function formatDiscordTimestamp(timestamp: string) {
  const parsedDate = new Date(timestamp);

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
    `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
    webBaseUrl,
  ).toString();
  const settingsLine = buildGameSettingsLine(payload.game);

  return buildDiscordNotification({
    headline: `${payload.game.name} is ready!`,
    message: `Review the [world page](${gameUrl}), then use /register in this thread to claim an open seat.`,
    details: [
      `**Game** #${payload.game.gameNumber} | **Seats** ${payload.game.playerCount ?? "Not set yet"} | **Overlord** ${organizerLabel}`,
      ...(settingsLine ? [settingsLine] : []),
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
  const uploadedAtLabel = formatDiscordTimestamp(payload.upload.uploadedAt);
  const gameUrl = new URL(
    `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
    webBaseUrl,
  ).toString();
  const downloadUrl = new URL(
    `/api/games/${encodeURIComponent(String(payload.game.gameNumber))}/files/${encodeURIComponent(payload.upload.versionId)}`,
    webBaseUrl,
  ).toString();

  return buildDiscordNotification({
    headline: `It is ${nextPlayerLabel}'s turn!`,
    message: `Download the [current turn](${downloadUrl}), then upload your [completed turn](${gameUrl}) when finished.`,
    metadata: uploadedAtLabel ? [`-# ${uploadedAtLabel}`] : [],
    mentionedUserIds: payload.turn.activePlayer.discordId
      ? [payload.turn.activePlayer.discordId]
      : [],
  });
}

export function buildSaveReplacedNotificationMessage(
  payload: SaveReplacedNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const correctedBy = formatDiscordActor(
    payload.replacement.replacedBy.displayName,
    payload.replacement.replacedBy.discordId,
  );
  const replacedAt = formatDiscordTimestamp(payload.replacement.replacedAt);
  const downloadUrl = new URL(
    `/api/games/${encodeURIComponent(String(payload.game.gameNumber))}/files/${encodeURIComponent(payload.replacement.versionId)}`,
    webBaseUrl,
  ).toString();

  return buildDiscordNotification({
    headline: `The save for ${payload.game.name} was corrected`,
    message: `Download [${payload.replacement.originalName}](${downloadUrl}) to continue with the corrected save.`,
    details: [`**Corrected by** ${correctedBy}`],
    metadata: replacedAt ? [`-# ${replacedAt}`] : [],
    mentionedUserIds: payload.replacement.replacedBy.discordId
      ? [payload.replacement.replacedBy.discordId]
      : [],
  });
}

export function buildTurnNudgeNotificationMessage(
  payload: TurnNudgeNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const player = formatDiscordActor(
    payload.turnRecord.activePlayer.displayName,
    payload.turnRecord.activePlayer.discordId,
  );
  const hours = (value: number) => `${value} hour${value === 1 ? "" : "s"}`;
  const gameUrl = new URL(
    `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
    webBaseUrl,
  ).toString();
  const startedAt = formatDiscordTimestamp(payload.turnRecord.startedAt);

  return buildDiscordNotification({
    headline: `${player}, your turn needs attention`,
    message: `This turn has been active for **${hours(payload.turnRecord.elapsedHours)}**, against a target of **${hours(payload.turnRecord.targetHours)}**.`,
    details: [
      `**World** [${payload.game.name}](${gameUrl})`,
      `**Round** ${payload.turnRecord.roundNumber} | **Seat** ${payload.turnRecord.activePlayer.turnOrder}`,
    ],
    metadata: startedAt ? [`-# ${startedAt}`] : [],
    mentionedUserIds: [payload.turnRecord.activePlayer.discordId],
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
  return buildDiscordNotification({
    headline: `${formatDiscordActor("Overlord", organizerDiscordId)}, review this registration`,
    message: `Approve or reject **${applicantName}**'s request to join **${gameName}**.`,
    actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
      approveButton,
      rejectButton,
    ),
    mentionedUserIds: organizerDiscordId ? [organizerDiscordId] : [],
  });
}

export function buildApprovalResultMessage({
  approved,
  gameName,
  gameUrl,
  playerName,
  turnOrder,
  actionRow,
}: {
  approved: boolean;
  gameName: string;
  gameUrl?: string;
  playerName: string;
  turnOrder?: number;
  actionRow?: ActionRowBuilder<ButtonBuilder>;
}): InteractionEditReplyOptions {
  return buildDiscordEditReply({
    headline: approved ? "Registration approved" : "Registration rejected",
    message: buildNotificationResultText({
      approved,
      gameName,
      gameUrl,
      playerName,
      turnOrder,
    }),
    actionRow,
  });
}

export function buildNotificationResultText({
  approved,
  gameName,
  gameUrl,
  playerName,
  turnOrder,
}: {
  approved: boolean;
  gameName: string;
  gameUrl?: string;
  playerName: string;
  turnOrder?: number;
}) {
  const gameLabel = gameUrl ? `[${gameName}](${gameUrl})` : `**${gameName}**`;

  if (!approved) {
    return `**${playerName}**'s request to join ${gameLabel} was rejected.`;
  }

  return `**${playerName}** joined ${gameLabel} as seat ${turnOrder ?? "unknown"}.`;
}

export { ACCENT_COLOR };
