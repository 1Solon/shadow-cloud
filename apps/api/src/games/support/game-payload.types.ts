import type {
  ArmyCountPreset,
  GameDlcMode,
  GameMode,
  ZoneCountPreset,
} from '../../database';

export type GameDetailResponse = {
  id: string;
  gameNumber: number;
  slug: string;
  name: string;
  organizerId: string;
  organizerDisplayName: string;
  playerCount: number | null;
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
    uploadedById: string;
    uploadedByDisplayName: string;
    contentHash: string | null;
    idempotencyKey: string | null;
  }>;
};

export type GameMetadataResponse = {
  id: string;
  gameNumber: number;
  slug: string;
  name: string;
  roundNumber: number;
  playerCount: number | null;
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

export type UploadSaveSafetyMetadata = {
  contentHash?: string;
  idempotencyKey?: string;
  expectedActivePlayerEntryId?: string | null;
  expectedActivePlayerUserId?: string | null;
  expectedRoundNumber?: number | null;
  expectedLatestFileVersionId?: string | null;
};
