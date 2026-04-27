import { getNextActivePlayer } from '../games-domain';
import type { PlayerSummary } from '../games.types';

export function resolveUploadSaveNaming(
  players: PlayerSummary[],
  activePlayerEntryId: string,
) {
  const nextActivePlayer = getNextActivePlayer(players, activePlayerEntryId);

  if (!nextActivePlayer.displayName) {
    throw new Error(
      `Next active player entry ${nextActivePlayer.id} is missing a display name.`,
    );
  }

  return {
    nextActivePlayer,
    seat: nextActivePlayer.turnOrder,
    playerName: nextActivePlayer.displayName,
  };
}
