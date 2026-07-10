import type {
  ArmyCountPreset,
  GameDlcMode,
  GameMode,
  ZoneCountPreset,
  TurnCompletionReason,
} from '../../database';

export type TurnRecordResponse = {
  id: string;
  roundNumber: number;
  gamePlayerId: string | null;
  userId: string | null;
  seatNumber: number | null;
  playerDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  completionReason: TurnCompletionReason | null;
  reminderCount: number;
  lastReminderAt: string | null;
  nextReminderAt: string | null;
};

export type TurnTimingPolicyResponse = {
  turnTargetHours: number;
  turnReminderGraceHours: number;
  turnReminderRepeatHours: number;
  turnRemindersEnabled: boolean;
  currentTurnStartedAt: string | null;
};

export type GameDetailResponse = TurnTimingPolicyResponse & {
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
    replacedAt: string | null;
    replacedByDisplayName: string | null;
  }>;
  openTurn: TurnRecordResponse | null;
  recentCompletedTurns: TurnRecordResponse[];
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
  turnTargetHours: number;
  turnReminderGraceHours: number;
  turnReminderRepeatHours: number;
  turnRemindersEnabled: boolean;
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

export type ReplaceSaveMetadata = {
  contentHash?: string;
  shadowOverrideEnabled?: boolean;
};
