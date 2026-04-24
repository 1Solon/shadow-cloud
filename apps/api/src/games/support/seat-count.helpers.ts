import { BadRequestException } from '@nestjs/common';
import { GameRole, type Prisma } from '../../database';

type SeatRecord = {
  id: string;
  turnOrder: number;
  userId: string | null;
};

type SyncGameSeatCountInput = {
  transaction: Prisma.TransactionClient;
  gameId: string;
  players: SeatRecord[];
  targetPlayerCount: number;
};

export async function syncGameSeatCount({
  transaction,
  gameId,
  players,
  targetPlayerCount,
}: SyncGameSeatCountInput) {
  const orderedPlayers = [...players].sort(
    (left, right) => left.turnOrder - right.turnOrder,
  );
  const missingSeatCount = Math.max(
    targetPlayerCount - orderedPlayers.length,
    0,
  );
  const extraSeatCount = Math.max(orderedPlayers.length - targetPlayerCount, 0);

  if (extraSeatCount > 0) {
    const removableSeatIds = orderedPlayers
      .filter((player) => player.userId == null)
      .sort((left, right) => right.turnOrder - left.turnOrder)
      .slice(0, extraSeatCount)
      .map((player) => player.id);

    if (removableSeatIds.length !== extraSeatCount) {
      throw new BadRequestException(
        `Seat limit cannot be lowered to ${targetPlayerCount} until the extra occupied seats are cleared or reassigned.`,
      );
    }

    await transaction.gamePlayer.deleteMany({
      where: {
        gameId,
        id: {
          in: removableSeatIds,
        },
      },
    });
  }

  if (missingSeatCount > 0) {
    await transaction.gamePlayer.createMany({
      data: Array.from({ length: missingSeatCount }, (_, index) => ({
        gameId,
        userId: null,
        turnOrder: orderedPlayers.length + index + 1,
        role: GameRole.PLAYER,
      })),
    });
  }
}
