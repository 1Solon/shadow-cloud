export function resolveActivePlayerEntry<
  T extends { id: string; userId: string | null },
>(
  players: T[],
  turnState: {
    activePlayerId: string | null;
    activePlayerEntryId: string | null;
  },
) {
  return (
    players.find((player) => player.id === turnState.activePlayerEntryId) ??
    (turnState.activePlayerId == null
      ? undefined
      : players.find((player) => player.userId === turnState.activePlayerId)) ??
    null
  );
}

export function vacantTurnDisplayName(seatNumber: number) {
  return `Vacant turn (seat ${seatNumber})`;
}

export function isActiveSeat(
  seat: { id: string; userId: string | null },
  turnState: {
    activePlayerId: string | null;
    activePlayerEntryId: string | null;
  },
) {
  return turnState.activePlayerEntryId != null
    ? seat.id === turnState.activePlayerEntryId
    : turnState.activePlayerId != null &&
        seat.userId === turnState.activePlayerId;
}
