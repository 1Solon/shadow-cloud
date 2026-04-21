import type {
  ArmyCountPreset,
  GameDlcMode,
  GameMode,
  ZoneCountPreset,
} from '../../database';

export type GameDetailResponse = {
  id: string;
  slug: string;
  name: string;
  organizerId: string;
  organizerDisplayName: string;
  hasAiPlayers: boolean | null;
  dlcMode: GameDlcMode | null;
  gameMode: GameMode | null;
  techLevel: number | null;
  zoneCount: ZoneCountPreset | null;
  armyCount: ArmyCountPreset | null;
  notes: string | null;
  roundNumber: number;
  activePlayerEntryId: string | null;
  activePlayerUserId: string | null;
  activePlayerDisplayName: string;
  players: Array<{
    id: string;
    userId: string | null;
    displayName: string | null;
    turnOrder: number;
    isOrganizer: boolean;
  }>;
  fileVersions: Array<{
    id: string;
    originalName: string;
    uploadedAt: string;
    uploadedByDisplayName: string;
  }>;
};

export type GameMetadataResponse = {
  id: string;
  slug: string;
  roundNumber: number;
  hasAiPlayers: boolean | null;
  dlcMode: GameDlcMode | null;
  gameMode: GameMode | null;
  techLevel: number | null;
  zoneCount: ZoneCountPreset | null;
  armyCount: ArmyCountPreset | null;
  notes: string | null;
};

export type UploadedSaveFile = {
  buffer: Buffer;
  originalname: string;
  size: number;
};
