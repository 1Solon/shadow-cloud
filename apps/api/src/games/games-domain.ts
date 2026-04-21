import type {
  FileVersionSummary,
  GameStatus,
  GameSummary,
  PlayerSummary,
} from './games.types';

export function getActivePlayer(
  players: PlayerSummary[],
  activePlayerEntryId: string,
): PlayerSummary {
  const activePlayer = players.find(
    (player) => player.id === activePlayerEntryId,
  );

  if (!activePlayer) {
    throw new Error(
      `Active player entry ${activePlayerEntryId} is not part of the game.`,
    );
  }

  return activePlayer;
}

export function getNextActivePlayer(
  players: PlayerSummary[],
  activePlayerEntryId: string,
): PlayerSummary {
  const orderedPlayers = [...players]
    .filter((player) => player.userId != null)
    .sort((left, right) => left.turnOrder - right.turnOrder);
  const currentIndex = orderedPlayers.findIndex(
    (player) => player.id === activePlayerEntryId,
  );

  if (currentIndex === -1) {
    throw new Error(
      `Active player entry ${activePlayerEntryId} is not part of the game.`,
    );
  }

  return orderedPlayers[(currentIndex + 1) % orderedPlayers.length];
}

export function trimFileHistory(
  files: FileVersionSummary[],
  retentionLimit: number,
): FileVersionSummary[] {
  return [...files]
    .sort((left, right) => right.versionNumber - left.versionNumber)
    .slice(0, retentionLimit);
}

export function buildGameStatus(input: {
  game: GameSummary;
  activePlayer: PlayerSummary;
  canCurrentPlayerUpload: boolean;
  canParticipantsDownload: boolean;
}): GameStatus {
  return {
    gameId: input.game.id,
    gameName: input.game.name,
    forumChannel: input.game.channelName,
    retentionLimit: input.game.retentionLimit,
    activePlayer: input.activePlayer,
    recentFiles: input.game.recentFiles,
    playerCount: input.game.players.length,
    canCurrentPlayerUpload: input.canCurrentPlayerUpload,
    canParticipantsDownload: input.canParticipantsDownload,
  };
}
