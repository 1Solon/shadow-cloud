import { type Prisma, TurnCompletionReason } from '@prisma/client';

export type SaveSeatMismatch = {
  expectedSeatNumber: number;
  activeSeatNumber: number;
};

const TURNS_SEARCHED_FOR_SAVE_HANDOFF = 100;

const saveHandOffReasons = new Set<TurnCompletionReason>([
  TurnCompletionReason.SAVE_UPLOADED,
  TurnCompletionReason.REJECTED,
]);

export async function findSaveSeatMismatch(
  transaction: Prisma.TransactionClient,
  gameId: string,
): Promise<SaveSeatMismatch | null> {
  const latestSave = await transaction.fileVersion.findFirst({
    where: { gameId },
    select: { id: true },
  });
  if (!latestSave) return null;
  const [turnsByClosingOrder, seats] = await Promise.all([
    transaction.turnRecord.findMany({
      where: { gameId },
      select: { gamePlayerId: true, seatNumber: true, completionReason: true },
      orderBy: [
        { endedAt: { sort: 'desc', nulls: 'first' } },
        { startedAt: 'desc' },
      ],
      take: TURNS_SEARCHED_FOR_SAVE_HANDOFF,
    }),
    transaction.gamePlayer.findMany({
      where: { gameId },
      select: { id: true, turnOrder: true },
    }),
  ]);
  const [openTurn, ...earlierTurns] = turnsByClosingOrder;
  if (!openTurn || openTurn.completionReason != null) return null;

  const handOffIndex = earlierTurns.findIndex((turn) =>
    saveHandOffReasons.has(turn.completionReason!),
  );
  const reachedFirstTurn =
    turnsByClosingOrder.length < TURNS_SEARCHED_FOR_SAVE_HANDOFF;
  if (handOffIndex === -1 && !reachedFirstTurn) return null;
  const turnsSinceHandOff = [
    openTurn,
    ...(handOffIndex === -1
      ? earlierTurns
      : earlierTurns.slice(0, handOffIndex)),
  ].reverse();

  let expectedSeatTurn = turnsSinceHandOff[0];
  for (let index = 1; index < turnsSinceHandOff.length; index += 1) {
    const previous = turnsSinceHandOff[index - 1];
    if (
      previous.completionReason === TurnCompletionReason.SKIPPED &&
      previous.gamePlayerId === expectedSeatTurn.gamePlayerId
    )
      expectedSeatTurn = turnsSinceHandOff[index];
  }

  if (expectedSeatTurn.gamePlayerId === openTurn.gamePlayerId) return null;
  const seatNumber = (turn: typeof openTurn) =>
    seats.find((seat) => seat.id === turn.gamePlayerId)?.turnOrder ??
    turn.seatNumber;
  const expectedSeatNumber = seatNumber(expectedSeatTurn);
  const activeSeatNumber = seatNumber(openTurn);
  if (expectedSeatNumber == null || activeSeatNumber == null) return null;
  return { expectedSeatNumber, activeSeatNumber };
}
