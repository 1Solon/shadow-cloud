import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  escapeMarkdown,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
} from "discord.js";

const ACCENT_COLOR = 0xffa500;

export const APPROVE_PREFIX = "sc_approve_";
export const REJECT_PREFIX = "sc_reject_";
export const SAVE_REJECT_PREFIX = "sc_save_reject_";
export const SAVE_REJECT_CONFIRM_PREFIX = "sc_save_reject_confirm_";
export const VICTORY_CONFIRM_PREFIX = "sc_victory_confirm_";
export const VICTORY_UNDO_CONFIRM_PREFIX = "sc_victory_undo_confirm_";
export const VICTORY_CANCEL_ID = "sc_victory_cancel";
export const VICTORY_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

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

export type ActivePlayerChangedNotificationPayload = {
  game: UploadNotificationPayload["game"];
  turn: Omit<UploadNotificationPayload["turn"], "roundAdvanced">;
};

export type SaveReplacedNotificationPayload = {
  game: UploadNotificationPayload["game"];
  activePlayer?: {
    id: string;
    displayName: string;
    discordId: string | null;
  } | null;
  replacement: {
    passwordRecovery?: { operation: "reset" | "undo"; regimeName: string };
    contentRevision: number;
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

export type SaveRejectedNotificationPayload = {
  game: UploadNotificationPayload["game"];
  rejection: {
    versionNumber: number;
    originalName: string;
    rejectedAt: string;
    rejectedBy: {
      id: string;
      displayName: string;
      discordId: string | null;
    };
  };
  turn: {
    roundNumber: number;
    activePlayer: UploadNotificationPayload["turn"]["activePlayer"];
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

export type CampaignDeletedNotificationPayload = {
  game: {
    id: string;
    gameNumber: number;
    slug: string;
    name: string;
    discordThreadId: string;
  };
  victory: {
    victorDisplayName: string;
    victorDiscordId: string | null;
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
    .addTextDisplayComponents((textDisplay) => textDisplay.setContent(message));

  if (details.length > 0) {
    container.addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(details.join("\n")),
    );
  }

  if (actionRow) {
    container.addActionRowComponents(actionRow);
  }

  const footerMetadata =
    metadata.length > 0
      ? metadata
      : [`-# <t:${Math.floor(Date.now() / 1000)}:F>`];

  return container
    .addSeparatorComponents((separator) =>
      separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    )
    .addTextDisplayComponents((textDisplay) =>
      textDisplay.setContent(footerMetadata.join("\n")),
    );
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

function formatEnumLabel(value: string | null, labels: Record<string, string>) {
  if (!value) {
    return null;
  }

  return labels[value] ?? value;
}

function buildGameDetailsTable(
  game: GameInitializedNotificationPayload["game"],
  organizerName: string,
) {
  const rows: Array<[string, string | number | null]> = [
    ["Game", `#${game.gameNumber}`],
    ["Seats", game.playerCount ?? "Not set yet"],
    ["Overlord", organizerName],
    [
      "DLC",
      formatEnumLabel(game.dlcMode, {
        NONE: "None",
        OCEANIA: "Oceania",
        REPUBLICA: "Republica",
        BOTH: "Both",
      }),
    ],
    [
      "Mode",
      formatEnumLabel(game.gameMode, {
        TEAMS: "Teams",
        TEAMS_AI: "Teams+AI",
        FFA: "FFA",
        FFA_AI: "FFA+AI",
      }),
    ],
    ["Tech", game.techLevel],
    [
      "Zones",
      formatEnumLabel(game.zoneCount, {
        CITY_STATE: "City State",
        TWO_ZONE_START: "2 Zone Start",
        THREE_ZONE_START: "3 Zone Start",
      }),
    ],
    [
      "Armies",
      formatEnumLabel(game.armyCount, {
        MILITIA_ONLY: "Militia Only",
        ONE_PER_ZONE: "1 Army per Zone",
        TWO_PER_ZONE: "2 Armies per Zone",
      }),
    ],
    ["AI", game.hasAiPlayers == null ? null : game.hasAiPlayers ? "Yes" : "No"],
  ].filter((row): row is [string, string | number] => row[1] != null);
  const labelWidth = Math.max(...rows.map(([label]) => `${label}:`.length));

  return [
    "```",
    ...rows.map(
      ([label, value]) => `${`${label}:`.padEnd(labelWidth + 2)}${value}`,
    ),
    "```",
  ].join("\n");
}

export function buildGameInitNotificationMessage(
  payload: GameInitializedNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const gameUrl = new URL(
    `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
    webBaseUrl,
  ).toString();

  return {
    ...buildDiscordNotification({
      headline: `${payload.game.name} is ready!`,
      message: `Review the [world page](${gameUrl}), then use /register in this thread to claim an open seat.`,
      details: [
        buildGameDetailsTable(payload.game, payload.organizer.displayName),
      ],
    }),
    allowedMentions: { parse: [] },
  };
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
    message:
      "Download the current turn, then upload your completed turn when finished.",
    metadata: uploadedAtLabel ? [`-# ${uploadedAtLabel}`] : [],
    actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setURL(downloadUrl)
        .setLabel("Download")
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setURL(gameUrl)
        .setLabel("Upload")
        .setStyle(ButtonStyle.Link),
      new ButtonBuilder()
        .setCustomId(`${SAVE_REJECT_PREFIX}${payload.upload.versionId}`)
        .setLabel("Reject")
        .setStyle(ButtonStyle.Danger),
    ),
    mentionedUserIds: payload.turn.activePlayer.discordId
      ? [payload.turn.activePlayer.discordId]
      : [],
  });
}

export function buildSaveRejectionPrompt(
  fileVersionId: string,
): InteractionReplyOptions {
  return buildDiscordReply({
    headline: "Reject this save?",
    message:
      "This discards the save and hands the turn back to the player who uploaded it.",
    actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${SAVE_REJECT_CONFIRM_PREFIX}${fileVersionId}`)
        .setLabel("Reject save")
        .setStyle(ButtonStyle.Danger),
    ),
    ephemeral: true,
  });
}

/**
 * Confirm a victory or its undo. Live buttons carry the Victor and issue time,
 * so a confirmation stays self-contained and expires without bot state.
 */
export function buildVictoryConfirmation(
  confirmation: {
    gameName: string;
    victorName: string;
    deletionDueAt: string;
  } & ({ action: "declare"; victorDiscordId: string } | { action: "undo" }) &
    ({ mode: "live"; issuedAt: number } | { mode: "preview" }),
): InteractionEditReplyOptions {
  const declaring = confirmation.action === "declare";
  const gameName = `**${escapeMarkdown(confirmation.gameName)}**`;
  const victorName = escapeMarkdown(confirmation.victorName);
  const deletionDueAt =
    formatDiscordTimestamp(confirmation.deletionDueAt) ?? "in 7 days";
  const confirmId =
    confirmation.mode === "preview"
      ? "debug_victory_confirm"
      : confirmation.action === "declare"
        ? `${VICTORY_CONFIRM_PREFIX}${confirmation.victorDiscordId}_${confirmation.issuedAt}`
        : `${VICTORY_UNDO_CONFIRM_PREFIX}${confirmation.issuedAt}`;
  const confirmButton = new ButtonBuilder()
    .setCustomId(confirmId)
    .setLabel(declaring ? "Declare Victor" : "Undo victory")
    .setStyle(declaring ? ButtonStyle.Danger : ButtonStyle.Primary);
  const cancelButton = new ButtonBuilder()
    .setCustomId(
      confirmation.mode === "preview"
        ? "debug_victory_cancel"
        : VICTORY_CANCEL_ID,
    )
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  if (confirmation.mode === "preview") {
    confirmButton.setDisabled(true);
    cancelButton.setDisabled(true);
  }

  const expiresAt =
    confirmation.mode === "live"
      ? Math.floor((confirmation.issuedAt + VICTORY_CONFIRMATION_TTL_MS) / 1000)
      : null;

  return buildDiscordEditReply({
    headline: declaring
      ? `Declare ${victorName} the Victor?`
      : `Undo ${victorName}'s victory?`,
    message: declaring
      ? `This concludes ${gameName}. Turns, uploads, and reminders stop now, and the campaign and all of its saves are deleted ${deletionDueAt}. Until then, saves can still be downloaded and /unwinner can undo this.`
      : `${gameName} returns to play exactly where it stopped, and its deletion ${deletionDueAt} is cancelled.`,
    details: expiresAt
      ? [`-# This confirmation expires <t:${expiresAt}:R>.`]
      : [],
    actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmButton,
      cancelButton,
    ),
  });
}

export function buildCampaignDeletedNotificationMessage(
  payload: CampaignDeletedNotificationPayload,
): MessageCreateOptions {
  const victor = formatDiscordActor(
    escapeMarkdown(payload.victory.victorDisplayName),
    payload.victory.victorDiscordId,
  );

  return {
    ...buildDiscordNotification({
      headline: `${payload.game.name} has been deleted`,
      message: `${victor} won this campaign. Its saves and history have been removed from Shadow Cloud; only the record of the victory remains. This thread is now archived.`,
    }),
    allowedMentions: { parse: [] },
  };
}

export function buildSaveRejectedNotificationMessage(
  payload: SaveRejectedNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const player = payload.turn.activePlayer;
  const playerLabel = formatDiscordActor(player.displayName, player.discordId);
  const rejectedBy = payload.rejection.rejectedBy;
  const rejectedAt = formatDiscordTimestamp(payload.rejection.rejectedAt);
  const gameUrl = new URL(
    `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
    webBaseUrl,
  ).toString();
  const action =
    rejectedBy.id === player.id
      ? `${escapeMarkdown(player.displayName)} withdrew save #${payload.rejection.versionNumber}.`
      : `${escapeMarkdown(rejectedBy.displayName)} rejected save #${payload.rejection.versionNumber}.`;

  return buildDiscordNotification({
    headline: `It is ${playerLabel}'s turn again!`,
    message: `${action} Upload a [corrected save](${gameUrl}) for round ${payload.turn.roundNumber}. Your turn time continues from where it stopped.`,
    metadata: rejectedAt ? [`-# ${rejectedAt}`] : [],
    mentionedUserIds: player.discordId ? [player.discordId] : [],
  });
}

export function buildActivePlayerChangedNotificationMessage(
  payload: ActivePlayerChangedNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const player = payload.turn.activePlayer;
  const label = player.discordId
    ? `<@${player.discordId}>`
    : escapeMarkdown(player.displayName);
  const gameUrl = new URL(
    `/games/${encodeURIComponent(String(payload.game.gameNumber))}`,
    webBaseUrl,
  ).toString();
  return {
    ...buildDiscordNotification({
      headline: `It is ${label}'s turn!`,
      message: `The active seat was changed. Round ${payload.turn.roundNumber}, seat ${player.turnOrder}. Review the [campaign](${gameUrl}) before continuing.`,
    }),
    allowedMentions: player.discordId
      ? { users: [player.discordId] }
      : { parse: [] },
  };
}

export function buildSaveReplacedNotificationMessage(
  payload: SaveReplacedNotificationPayload,
  webBaseUrl: string,
): MessageCreateOptions {
  const correctedBy = formatDiscordActor(
    payload.replacement.replacedBy.displayName,
    payload.replacement.replacedBy.discordId,
  );
  const activePlayer = payload.activePlayer
    ? formatDiscordActor(
        payload.activePlayer.displayName,
        payload.activePlayer.discordId,
      )
    : null;
  const replacedAt = formatDiscordTimestamp(payload.replacement.replacedAt);
  const recovery = payload.replacement.passwordRecovery;
  const downloadUrl = new URL(
    `/api/games/${encodeURIComponent(String(payload.game.gameNumber))}/files/${encodeURIComponent(payload.replacement.versionId)}`,
    webBaseUrl,
  );
  downloadUrl.searchParams.set(
    "revision",
    String(payload.replacement.contentRevision),
  );

  return buildDiscordNotification({
    headline: activePlayer
      ? `${activePlayer}, the save for ${payload.game.name} was corrected`
      : `The save for ${payload.game.name} was corrected`,
    message: recovery
      ? `The Overlord ${recovery.operation === "reset" ? "reset the in-game password" : "undid the latest password reset and restored the previous password"} for **${escapeMarkdown(recovery.regimeName)}**. The latest save has been replaced; the turn has not advanced. Download [the updated save](${downloadUrl.toString()}) before continuing. If you already started from the previous copy, restart from the updated save.`
      : `Download [${payload.replacement.originalName}](${downloadUrl.toString()}) to continue with the corrected save.`,
    details: [`**Corrected by:** ${correctedBy}`],
    metadata: replacedAt ? [`-# ${replacedAt}`] : [],
    mentionedUserIds: [
      payload.activePlayer?.discordId,
      payload.replacement.replacedBy.discordId,
    ].filter((discordId): discordId is string => discordId != null),
  });
}

export function buildTurnNudgeNotificationMessage(
  payload: TurnNudgeNotificationPayload,
): MessageCreateOptions {
  const player = formatDiscordActor(
    payload.turnRecord.activePlayer.displayName,
    payload.turnRecord.activePlayer.discordId,
  );
  const hours = (value: number) => `${value} hour${value === 1 ? "" : "s"}`;
  const startedAt = formatDiscordTimestamp(payload.turnRecord.startedAt);

  return buildDiscordNotification({
    headline: `${player}, your turn needs attention`,
    message: `This turn has been active for **${hours(payload.turnRecord.elapsedHours)}**, against a target of **${hours(payload.turnRecord.targetHours)}**.`,
    metadata: startedAt ? [`-# ${startedAt}`] : [],
    mentionedUserIds: [payload.turnRecord.activePlayer.discordId],
  });
}

export function buildRegistrationResponse(
  registration: {
    playerName: string;
    gameName: string;
  } & (
    | { state: "pending"; organizerDiscordId: string | null }
    | { state: "approved" | "rejected"; gameUrl?: string; turnOrder?: number }
  ) &
    ({ mode: "live"; requestId: string } | { mode: "preview" }),
) {
  const { playerName, gameName } = registration;
  const approveButton = new ButtonBuilder()
    .setCustomId(
      registration.mode === "live"
        ? `${APPROVE_PREFIX}${registration.requestId}`
        : "debug_approve",
    )
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success);
  const rejectButton = new ButtonBuilder()
    .setCustomId(
      registration.mode === "live"
        ? `${REJECT_PREFIX}${registration.requestId}`
        : "debug_reject",
    )
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger);

  if (registration.mode === "preview" || registration.state !== "pending") {
    approveButton.setDisabled(true);
    rejectButton.setDisabled(true);
  }

  const organizerDiscordId =
    registration.state === "pending" ? registration.organizerDiscordId : null;
  const presentation =
    registration.state === "pending"
      ? {
          headline: `${formatDiscordActor("Overlord", organizerDiscordId)}, review this registration`,
          message: `Approve or reject **${playerName}**'s request to join **${gameName}**.`,
        }
      : {
          headline:
            registration.state === "approved"
              ? "Registration approved"
              : "Registration rejected",
          message: buildNotificationResultText({
            approved: registration.state === "approved",
            gameName,
            playerName,
            gameUrl: registration.gameUrl,
            turnOrder: registration.turnOrder,
          }),
        };
  const options = {
    ...presentation,
    actionRow: new ActionRowBuilder<ButtonBuilder>().addComponents(
      approveButton,
      rejectButton,
    ),
  };

  return {
    components: [buildDiscordResponseContainer(options)],
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: buildAllowedMentions(
      organizerDiscordId ? [organizerDiscordId] : [],
    ),
  };
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
