export type SeatOrderBaseline = {
  campaignId: string;
  revision: number;
};

export type SeatOrderSnapshot = {
  gameId: string;
  slug: string;
  name: string;
  organizerId: string;
  players: PlayerSummary[];
  activePlayerEntryId: string | null;
  activePlayerUserId: string | null;
  roundNumber: number | null;
  seatOrderBaseline: SeatOrderBaseline;
};

export type PlayerSummary = {
  id: string;
  userId: string | null;
  displayName: string | null;
  turnOrder: number;
  isOrganizer: boolean;
};

export type FileVersionSummary = {
  id: string;
  versionNumber: number;
  originalName: string;
  uploadedAt: string;
  uploadedBy: string;
};

export type GameSummary = {
  id: string;
  name: string;
  channelName: string;
  retentionLimit: number;
  activePlayerEntryId: string;
  players: PlayerSummary[];
  recentFiles: FileVersionSummary[];
};

export type GameStatus = {
  gameId: string;
  gameName: string;
  forumChannel: string;
  retentionLimit: number;
  activePlayer: PlayerSummary;
  recentFiles: FileVersionSummary[];
  playerCount: number;
  canCurrentPlayerUpload: boolean;
  canParticipantsDownload: boolean;
};
