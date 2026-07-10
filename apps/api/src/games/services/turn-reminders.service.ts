import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationDeliveryEvent, prisma, type Prisma } from '../../database';
import type { TurnNudgeNotificationPayload } from '../bot-notifications.service';
import { getDiscordIdentity } from '../support/discord-user.helpers';
import { calculateNextReminderAt } from '../support/turn-timing';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class TurnRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly pollIntervalMs = 60_000;
  private pollInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  onModuleInit() {
    this.pollInterval = setInterval(() => {
      void this.processDueTurnReminders();
    }, this.pollIntervalMs);

    void this.processDueTurnReminders();
  }

  onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async processDueTurnReminders(now = new Date()): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      const candidates = await prisma.turnRecord.findMany({
        where: {
          endedAt: null,
          nextReminderAt: { lte: now },
        },
        select: { id: true },
      });

      for (const candidate of candidates) {
        await this.processTurnReminderCandidate(candidate.id, now);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async processTurnReminderCandidate(
    turnRecordId: string,
    now: Date,
  ): Promise<void> {
    await prisma.$transaction(async (transaction) => {
      const turnRecord = await transaction.turnRecord.findUnique({
        where: { id: turnRecordId },
        include: {
          game: { include: { turnState: true } },
          gamePlayer: {
            include: { user: { include: { identities: true } } },
          },
        },
      });

      if (
        !turnRecord ||
        !turnRecord.nextReminderAt ||
        turnRecord.nextReminderAt > now ||
        turnRecord.endedAt ||
        !turnRecord.game.turnRemindersEnabled ||
        !this.isCurrentActiveTurn(turnRecord)
      ) {
        return;
      }

      const dueAt = turnRecord.nextReminderAt;
      const nextReminderAt = calculateNextReminderAt(now, turnRecord.game);

      if (!nextReminderAt) {
        return;
      }

      const claimed = await transaction.turnRecord.updateMany({
        where: {
          id: turnRecord.id,
          endedAt: null,
          nextReminderAt: dueAt,
        },
        data: {
          reminderCount: { increment: 1 },
          lastReminderAt: now,
          nextReminderAt,
        },
      });

      if (claimed.count !== 1) {
        return;
      }

      const activePlayer = turnRecord.gamePlayer;

      if (!activePlayer?.user) {
        return;
      }

      const discordId = getDiscordIdentity(activePlayer.user);
      const discordThreadId = turnRecord.game.discordThreadId;

      if (!discordId || !discordThreadId) {
        return;
      }

      const payload: TurnNudgeNotificationPayload = {
        game: {
          id: turnRecord.game.id,
          gameNumber: turnRecord.game.gameNumber,
          slug: turnRecord.game.slug,
          name: turnRecord.game.name,
          discordThreadId,
        },
        turnRecord: {
          id: turnRecord.id,
          roundNumber: turnRecord.roundNumber,
          startedAt: turnRecord.startedAt.toISOString(),
          elapsedHours: Math.floor(
            (now.getTime() - turnRecord.startedAt.getTime()) / HOUR_MS,
          ),
          targetHours: turnRecord.game.turnTargetHours,
          activePlayer: {
            id: activePlayer.userId!,
            displayName: activePlayer.user.displayName,
            discordId,
            turnOrder: activePlayer.turnOrder,
          },
        },
      };

      await transaction.notificationDelivery.create({
        data: {
          event: NotificationDeliveryEvent.TURN_NUDGE,
          gameId: turnRecord.game.id,
          gameSlug: turnRecord.game.slug,
          turnRecordId: turnRecord.id,
          payload: JSON.stringify(payload),
        },
      });
    });
  }

  private isCurrentActiveTurn(
    turnRecord: Prisma.TurnRecordGetPayload<{
      include: {
        game: { include: { turnState: true } };
        gamePlayer: { include: { user: { include: { identities: true } } } };
      };
    }>,
  ) {
    const { game, gamePlayer } = turnRecord;

    return (
      gamePlayer?.userId != null &&
      gamePlayer.user != null &&
      game.turnState?.activePlayerId === turnRecord.userId &&
      game.turnState.activePlayerEntryId === turnRecord.gamePlayerId &&
      game.turnState.roundNumber === turnRecord.roundNumber &&
      gamePlayer.id === turnRecord.gamePlayerId &&
      gamePlayer.userId === turnRecord.userId
    );
  }
}
