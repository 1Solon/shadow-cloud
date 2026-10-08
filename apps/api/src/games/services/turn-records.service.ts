import { ConflictException, Injectable } from '@nestjs/common';
import { closeSaveRecovery } from '../support/save-recovery';
import {
  type Prisma,
  type TurnRecord,
  TurnCompletionReason,
} from '@prisma/client';
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
};

export type ReturnTurnInput = {
  gameId: string;
  expectedCurrent: {
    gamePlayerId: string | null;
    userId: string;
    roundNumber: number;
  };
  previousTurnId: string;
  returnedAt: Date;
};

export type ResumeOpenTurnInput = {
  gameId: string;
  pausedAt: Date;
  resumedAt: Date;
};

type CreateInitialTurnInput = {
  gameId: string;
  participant: TurnParticipantSnapshot;
  roundNumber: number;
  startedAt: Date;
};

type RecalculateOpenReminderInput = {
  gameId: string;
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
  /** Validate a preserved turn without resetting its clock or reminder schedule. */
  async assertCurrentTurn(
    transaction: Prisma.TransactionClient,
    gameId: string,
  ): Promise<void> {
    const state = await transaction.turnState.findUnique({ where: { gameId } });
    if (!state) return;
    const seats = await transaction.gamePlayer.findMany({
      where: {
        gameId,
        ...(state.activePlayerEntryId == null
          ? { userId: state.activePlayerId }
          : { id: state.activePlayerEntryId }),
      },
    });
    if (seats.length !== 1 || seats[0].userId !== state.activePlayerId) {
      throw new ConflictException('The active turn could not be resolved.');
    }
    await this.findMatchingOpenRecord(transaction, gameId, {
      gamePlayerId: seats[0].id,
      userId: state.activePlayerId,
      roundNumber: state.roundNumber,
    });
  }

  async createInitialTurn(
    transaction: Prisma.TransactionClient,
    input: CreateInitialTurnInput,
  ): Promise<TurnRecord> {
    const policy = await this.getCurrentPolicy(transaction, input.gameId);

    return transaction.turnRecord.create({
      data: {
        gameId: input.gameId,
        ...input.participant,
        roundNumber: input.roundNumber,
        startedAt: input.startedAt,
        nextReminderAt: calculateFirstReminderAt(input.startedAt, policy),
      },
    });
  }

  async transitionTurn(
    transaction: Prisma.TransactionClient,
    input: TransitionTurnInput,
  ): Promise<TurnRecord> {
    await this.closeOpenTurn(
      transaction,
      input.gameId,
      input.expectedCurrent,
      input.completionReason,
      input.transitionedAt,
    );

    return this.createInitialTurn(transaction, {
      gameId: input.gameId,
      participant: input.next,
      roundNumber: input.next.roundNumber,
      startedAt: input.transitionedAt,
    });
  }

  /** Reopen a completed turn so its clock resumes without counting the time it was closed. */
  async returnTurn(
    transaction: Prisma.TransactionClient,
    input: ReturnTurnInput,
  ): Promise<TurnRecord> {
    const previous = await transaction.turnRecord.findUnique({
      where: { id: input.previousTurnId },
    });

    if (!previous || previous.gameId !== input.gameId || !previous.endedAt) {
      throw new ConflictException('The previous turn could not be resumed.');
    }

    await this.closeOpenTurn(
      transaction,
      input.gameId,
      input.expectedCurrent,
      TurnCompletionReason.REJECTED,
      input.returnedAt,
    );

    return transaction.turnRecord.update({
      where: { id: previous.id },
      data: {
        ...(await this.resumedTiming(transaction, input.gameId, previous, {
          pausedAt: previous.endedAt,
          resumedAt: input.returnedAt,
        })),
        endedAt: null,
        completionReason: null,
      },
    });
  }

  /** Resume a turn left open while play was paused, without counting the pause. */
  async resumeOpenTurn(
    transaction: Prisma.TransactionClient,
    input: ResumeOpenTurnInput,
  ): Promise<TurnRecord | null> {
    const openRecords = await transaction.turnRecord.findMany({
      where: { gameId: input.gameId, endedAt: null },
    });

    if (openRecords.length === 0) {
      return null;
    }

    if (openRecords.length !== 1) {
      throw new ConflictException(
        'The game must have exactly one open turn record.',
      );
    }

    return transaction.turnRecord.update({
      where: { id: openRecords[0].id },
      data: await this.resumedTiming(
        transaction,
        input.gameId,
        openRecords[0],
        {
          pausedAt: input.pausedAt,
          resumedAt: input.resumedAt,
        },
      ),
    });
  }

  async recalculateOpenReminder(
    transaction: Prisma.TransactionClient,
    input: RecalculateOpenReminderInput,
  ): Promise<TurnRecord> {
    const policy = await this.getCurrentPolicy(transaction, input.gameId);
    const openRecord = await this.findOnlyOpenRecord(transaction, input.gameId);
    const nextReminderAt =
      openRecord.reminderCount > 0
        ? this.calculateRepeatedReminder(openRecord.lastReminderAt, policy)
        : calculateFirstReminderAt(openRecord.startedAt, policy);

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

  private async closeOpenTurn(
    transaction: Prisma.TransactionClient,
    gameId: string,
    expectedCurrent: TransitionTurnInput['expectedCurrent'],
    completionReason: TurnCompletionReason,
    endedAt: Date,
  ) {
    const current = await this.findMatchingOpenRecord(
      transaction,
      gameId,
      expectedCurrent,
    );
    const closed = await transaction.turnRecord.updateMany({
      where: { id: current.id, endedAt: null },
      data: { endedAt, completionReason, nextReminderAt: null },
    });

    if (closed.count !== 1) {
      throw new ConflictException(
        'The active turn changed before it could close.',
      );
    }

    await closeSaveRecovery(transaction, gameId);

    await transaction.notificationDelivery.updateMany({
      where: {
        turnRecordId: current.id,
        event: 'TURN_NUDGE',
        status: 'PENDING',
      },
      data: { status: 'CANCELLED', processingStartedAt: null },
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

  private async resumedTiming(
    transaction: Prisma.TransactionClient,
    gameId: string,
    record: TurnRecord,
    pause: { pausedAt: Date; resumedAt: Date },
  ) {
    const pausedMs = pause.resumedAt.getTime() - pause.pausedAt.getTime();
    const resume = (at: Date) => new Date(at.getTime() + pausedMs);
    const startedAt = resume(record.startedAt);
    const lastReminderAt = record.lastReminderAt
      ? resume(record.lastReminderAt)
      : null;
    const policy = await this.getCurrentPolicy(transaction, gameId);
    const scheduled =
      record.reminderCount > 0
        ? this.calculateRepeatedReminder(lastReminderAt, policy)
        : calculateFirstReminderAt(startedAt, policy);
    const nextReminderAt =
      scheduled && scheduled <= pause.resumedAt
        ? calculateNextReminderAt(pause.resumedAt, policy)
        : scheduled;

    return { startedAt, lastReminderAt, nextReminderAt };
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

  private async getCurrentPolicy(
    transaction: Prisma.TransactionClient,
    gameId: string,
  ): Promise<TurnReminderPolicy> {
    const game = await transaction.game.findUnique({
      where: { id: gameId },
      select: {
        turnTargetHours: true,
        turnReminderGraceHours: true,
        turnReminderRepeatHours: true,
        turnRemindersEnabled: true,
      },
    });

    if (!game) {
      throw new ConflictException('The game changed before updating its turn.');
    }

    return game;
  }
}
