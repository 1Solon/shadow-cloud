import { ConflictException, Injectable } from '@nestjs/common';
import {
  type Prisma,
  type TurnRecord,
  TurnCompletionReason,
} from '../../database';
import {
  calculateFirstReminderAt,
  calculateNextReminderAt,
  type TurnReminderPolicy,
} from '../support/turn-timing';

export type TurnParticipantSnapshot = {
  gamePlayerId: string | null;
  userId: string | null;
  seatNumber: number | null;
  playerDisplayName: string;
};

export type TransitionTurnInput = {
  gameId: string;
  expectedCurrent: {
    gamePlayerId: string | null;
    userId: string;
    roundNumber: number;
  };
  next: TurnParticipantSnapshot & { roundNumber: number };
  completionReason: TurnCompletionReason;
  transitionedAt: Date;
  policy: TurnReminderPolicy;
};

type CreateInitialTurnInput = {
  gameId: string;
  participant: TurnParticipantSnapshot;
  roundNumber: number;
  startedAt: Date;
  policy: TurnReminderPolicy;
};

type RecalculateOpenReminderInput = {
  gameId: string;
  policy: TurnReminderPolicy;
};

type SynchronizeOpenRoundInput = {
  gameId: string;
  expectedCurrent: {
    gamePlayerId: string | null;
    userId: string;
  };
  roundNumber: number;
};

@Injectable()
export class TurnRecordsService {
  async createInitialTurn(
    transaction: Prisma.TransactionClient,
    input: CreateInitialTurnInput,
  ): Promise<TurnRecord> {
    return transaction.turnRecord.create({
      data: {
        gameId: input.gameId,
        ...input.participant,
        roundNumber: input.roundNumber,
        startedAt: input.startedAt,
        nextReminderAt: calculateFirstReminderAt(input.startedAt, input.policy),
      },
    });
  }

  async transitionTurn(
    transaction: Prisma.TransactionClient,
    input: TransitionTurnInput,
  ): Promise<TurnRecord> {
    const current = await this.findMatchingOpenRecord(
      transaction,
      input.gameId,
      input.expectedCurrent,
    );
    const closed = await transaction.turnRecord.updateMany({
      where: { id: current.id, endedAt: null },
      data: {
        endedAt: input.transitionedAt,
        completionReason: input.completionReason,
        nextReminderAt: null,
      },
    });

    if (closed.count !== 1) {
      throw new ConflictException(
        'The active turn changed before it could close.',
      );
    }

    await transaction.notificationDelivery.updateMany({
      where: {
        turnRecordId: current.id,
        event: 'TURN_NUDGE',
        status: 'PENDING',
      },
      data: { status: 'CANCELLED', processingStartedAt: null },
    });

    return this.createInitialTurn(transaction, {
      gameId: input.gameId,
      participant: input.next,
      roundNumber: input.next.roundNumber,
      startedAt: input.transitionedAt,
      policy: input.policy,
    });
  }

  async recalculateOpenReminder(
    transaction: Prisma.TransactionClient,
    input: RecalculateOpenReminderInput,
  ): Promise<TurnRecord> {
    const openRecord = await this.findOnlyOpenRecord(transaction, input.gameId);
    const nextReminderAt =
      openRecord.reminderCount > 0
        ? this.calculateRepeatedReminder(
            openRecord.lastReminderAt,
            input.policy,
          )
        : calculateFirstReminderAt(openRecord.startedAt, input.policy);

    return transaction.turnRecord.update({
      where: { id: openRecord.id },
      data: { nextReminderAt },
    });
  }

  async synchronizeOpenRound(
    transaction: Prisma.TransactionClient,
    input: SynchronizeOpenRoundInput,
  ): Promise<TurnRecord> {
    const openRecord = await this.findMatchingOpenRecord(
      transaction,
      input.gameId,
      input.expectedCurrent,
    );

    return transaction.turnRecord.update({
      where: { id: openRecord.id },
      data: { roundNumber: input.roundNumber },
    });
  }

  private async findOnlyOpenRecord(
    transaction: Prisma.TransactionClient,
    gameId: string,
  ) {
    const openRecords = await transaction.turnRecord.findMany({
      where: { gameId, endedAt: null },
    });

    if (openRecords.length !== 1) {
      throw new ConflictException(
        'The game must have exactly one open turn record.',
      );
    }

    return openRecords[0];
  }

  private async findMatchingOpenRecord(
    transaction: Prisma.TransactionClient,
    gameId: string,
    expected: {
      gamePlayerId: string | null;
      userId: string;
      roundNumber?: number;
    },
  ) {
    const openRecords = await transaction.turnRecord.findMany({
      where: { gameId, endedAt: null },
    });
    const matches = openRecords.filter(
      (record) =>
        record.gamePlayerId === expected.gamePlayerId &&
        record.userId === expected.userId &&
        (expected.roundNumber === undefined ||
          record.roundNumber === expected.roundNumber),
    );

    if (matches.length !== 1 || openRecords.length !== 1) {
      throw new ConflictException(
        'The open turn record does not match the active turn state.',
      );
    }

    return matches[0];
  }

  private calculateRepeatedReminder(
    lastReminderAt: Date | null,
    policy: TurnReminderPolicy,
  ) {
    if (!lastReminderAt) {
      throw new ConflictException(
        'A reminded turn record is missing its latest reminder timestamp.',
      );
    }

    return calculateNextReminderAt(lastReminderAt, policy);
  }
}
