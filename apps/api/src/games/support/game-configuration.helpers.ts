import {
  AuditEventType,
  ArmyCountPreset,
  GameDlcMode,
  GameMode,
  ZoneCountPreset,
} from '../../database';
import {
  CreateDiscordGameArmyCount,
  CreateDiscordGameDlcMode,
  CreateDiscordGameMode,
  CreateDiscordGameZoneCount,
} from '../dto/create-discord-game.dto';

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const DISCORD_THREAD_NAME_MAX_LENGTH = 100;

type CanonicalThreadNameInput = {
  gameNumber: number;
  name: string;
  playerCount?: number | null;
  gameMode?: GameMode | null;
  techLevel?: number | null;
  zoneCount?: ZoneCountPreset | null;
  armyCount?: ArmyCountPreset | null;
};

function mapGameModeLabel(gameMode?: GameMode | null) {
  switch (gameMode) {
    case GameMode.TEAMS:
      return 'Teams';
    case GameMode.TEAMS_AI:
      return 'Teams+AI';
    case GameMode.FFA:
      return 'FFA';
    case GameMode.FFA_AI:
      return 'FFA+AI';
    default:
      return null;
  }
}

function mapZoneCountLabel(zoneCount?: ZoneCountPreset | null) {
  switch (zoneCount) {
    case ZoneCountPreset.CITY_STATE:
      return '1Z';
    case ZoneCountPreset.TWO_ZONE_START:
      return '2Z';
    case ZoneCountPreset.THREE_ZONE_START:
      return '3Z';
    default:
      return null;
  }
}

function mapArmyCountLabel(armyCount?: ArmyCountPreset | null) {
  switch (armyCount) {
    case ArmyCountPreset.MILITIA_ONLY:
      return '0A';
    case ArmyCountPreset.ONE_PER_ZONE:
      return '1A';
    case ArmyCountPreset.TWO_PER_ZONE:
      return '2A';
    default:
      return null;
  }
}

function truncateTitle(title: string, maxLength: number) {
  if (maxLength <= 0) {
    return '';
  }

  const trimmedTitle = title.trim();

  if (trimmedTitle.length <= maxLength) {
    return trimmedTitle;
  }

  if (maxLength === 1) {
    return trimmedTitle.slice(0, 1);
  }

  return `${trimmedTitle.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildCanonicalThreadName({
  gameNumber,
  name,
  playerCount,
  gameMode,
  techLevel,
  zoneCount,
  armyCount,
}: CanonicalThreadNameInput) {
  const prefix = `🟠 ${gameNumber} : `;
  const modeLabel = mapGameModeLabel(gameMode);
  const zoneLabel = mapZoneCountLabel(zoneCount);
  const armyLabel = mapArmyCountLabel(armyCount);
  const metadataTokens = [
    playerCount != null ? `${playerCount}S` : null,
    modeLabel,
    techLevel != null ? `T${techLevel}` : null,
    zoneLabel,
    armyLabel,
  ].filter((token): token is string => token != null);
  const suffix =
    metadataTokens.length > 0 ? ` (${metadataTokens.join(' ')})` : '';
  const maxTitleLength =
    DISCORD_THREAD_NAME_MAX_LENGTH - prefix.length - suffix.length;

  return `${prefix}${truncateTitle(name, maxTitleLength)}${suffix}`;
}

export function mapDlcMode(input: CreateDiscordGameDlcMode): GameDlcMode {
  switch (input) {
    case CreateDiscordGameDlcMode.NONE:
      return GameDlcMode.NONE;
    case CreateDiscordGameDlcMode.OCEANIA:
      return GameDlcMode.OCEANIA;
    case CreateDiscordGameDlcMode.REPUBLICA:
      return GameDlcMode.REPUBLICA;
    case CreateDiscordGameDlcMode.BOTH:
      return GameDlcMode.BOTH;
  }
}

export function mapGameMode(input: CreateDiscordGameMode): GameMode {
  switch (input) {
    case CreateDiscordGameMode.TEAMS:
      return GameMode.TEAMS;
    case CreateDiscordGameMode.TEAMS_AI:
      return GameMode.TEAMS_AI;
    case CreateDiscordGameMode.FFA:
      return GameMode.FFA;
    case CreateDiscordGameMode.FFA_AI:
      return GameMode.FFA_AI;
  }
}

export function mapZoneCount(
  input: CreateDiscordGameZoneCount,
): ZoneCountPreset {
  switch (input) {
    case CreateDiscordGameZoneCount.CITY_STATE:
      return ZoneCountPreset.CITY_STATE;
    case CreateDiscordGameZoneCount.TWO_ZONE_START:
      return ZoneCountPreset.TWO_ZONE_START;
    case CreateDiscordGameZoneCount.THREE_ZONE_START:
      return ZoneCountPreset.THREE_ZONE_START;
  }
}

export function mapArmyCount(
  input: CreateDiscordGameArmyCount,
): ArmyCountPreset {
  switch (input) {
    case CreateDiscordGameArmyCount.MILITIA_ONLY:
      return ArmyCountPreset.MILITIA_ONLY;
    case CreateDiscordGameArmyCount.ONE_PER_ZONE:
      return ArmyCountPreset.ONE_PER_ZONE;
    case CreateDiscordGameArmyCount.TWO_PER_ZONE:
      return ArmyCountPreset.TWO_PER_ZONE;
  }
}

export const metadataUpdatedAuditEventType =
  'METADATA_UPDATED' as AuditEventType;

export function normalizeNotesInput(input?: string | null) {
  const normalizedInput = input?.trim();

  return normalizedInput ? normalizedInput : null;
}

export function mapOptionalDlcMode(
  input?: CreateDiscordGameDlcMode,
): GameDlcMode | null {
  return input == null ? null : mapDlcMode(input);
}

export function mapOptionalGameMode(
  input?: CreateDiscordGameMode,
): GameMode | null {
  return input == null ? null : mapGameMode(input);
}

export function mapOptionalZoneCount(
  input?: CreateDiscordGameZoneCount,
): ZoneCountPreset | null {
  return input == null ? null : mapZoneCount(input);
}

export function mapOptionalArmyCount(
  input?: CreateDiscordGameArmyCount,
): ArmyCountPreset | null {
  return input == null ? null : mapArmyCount(input);
}
