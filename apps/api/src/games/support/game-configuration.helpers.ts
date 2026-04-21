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
