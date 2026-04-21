export function resolveActivePlayerEntry<
  T extends { id: string; userId: string | null },
>(
  players: T[],
  turnState: { activePlayerId: string; activePlayerEntryId: string | null },
) {
  return (
    players.find((player) => player.id === turnState.activePlayerEntryId) ??
    players.find((player) => player.userId === turnState.activePlayerId) ??
    null
  );
}
