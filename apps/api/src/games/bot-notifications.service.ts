import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  NotificationDeliveryEvent,
  NotificationDeliveryStatus,
  prisma,
} from '../database';
import type { Prisma } from '../database';

export type UploadNotificationPayload = {
  game: {
    id: string;
    gameNumber: number;
    slug: string;
    name: string;
    discordThreadId: string | null;
  };
  upload: {
    versionId: string;
    versionNumber: number;
    originalName: string;
    uploadedAt: string;
    uploadedBy: {
      id: string;
      displayName: string;
      discordId: string | null;
    };
  };
  turn: {
    roundNumber: number;
    roundAdvanced: boolean;
    activePlayer: {
      id: string;
      displayName: string;
      discordId: string | null;
      turnOrder: number;
    };
  };
  players: Array<{
    id: string;
    displayName: string;
    discordId: string | null;
    turnOrder: number;
  }>;
};

export type SaveReplacedNotificationPayload = {
  game: UploadNotificationPayload['game'];
  replacement: {
    versionId: string;
    versionNumber: number;
    originalName: string;
    replacedAt: string;
    replacedBy: {
      id: string;
      displayName: string;
      discordId: string | null;
    };
  };
};

export type GameInitializedNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
    threadName: string;
    gameNumber: number;
    discordThreadId: string | null;
    playerCount: number | null;
    hasAiPlayers: boolean | null;
    dlcMode: string | null;
    gameMode: string | null;
    techLevel: number | null;
    zoneCount: string | null;
    armyCount: string | null;
  };
  organizer: {
    id: string;
    displayName: string;
    discordId: string | null;
  };
};

export type ThreadRenameNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
    threadName: string;
    discordThreadId: string | null;
  };
};

export type TurnNudgeNotificationPayload = {
  game: {
    id: string;
    gameNumber: number;
    slug: string;
    name: string;
    discordThreadId: string;
  };
  turnRecord: {
    id: string;
    roundNumber: number;
    startedAt: string;
    elapsedHours: number;
    targetHours: number;
    activePlayer: {
      id: string;
      displayName: string;
      discordId: string;
      turnOrder: number;
    };
  };
};

type NotificationEventName =
  | 'save-uploaded'
  | 'save-replaced'
  | 'game-initialized'
  | 'thread-rename'
  | 'turn-nudge';

type NotificationContext = {
  eventName: NotificationEventName;
  gameId: string;
  gameSlug: string;
};

type EnqueueNotificationInput = NotificationContext & {
  event: NotificationDeliveryEvent;
  payload: unknown;
};

@Injectable()
export class BotNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotNotificationsService.name);
  private readonly notificationBaseUrl =
    process.env.SHADOW_CLOUD_BOT_NOTIFY_BASE_URL?.replace(/\/$/, '') ??
    'http://127.0.0.1:3011';
  private readonly saveUploadedEndpoint = `${this.notificationBaseUrl}/notify/save-uploaded`;
  private readonly saveReplacedEndpoint = `${this.notificationBaseUrl}/notify/save-replaced`;
  private readonly gameInitializedEndpoint = `${this.notificationBaseUrl}/notify/game-initialized`;
  private readonly threadRenameEndpoint = `${this.notificationBaseUrl}/notify/thread-rename`;
  private readonly turnNudgeEndpoint = `${this.notificationBaseUrl}/notify/turn-nudge`;
  private readonly secret = process.env.SHADOW_CLOUD_BOT_NOTIFY_SECRET;
  private readonly queuePollIntervalMs = 5_000;
  private readonly maxAttempts = 8;
  private readonly staleProcessingWindowMs = 60_000;
  private readonly maxBatchSize = 10;
  private queueInterval: NodeJS.Timeout | null = null;
  private isProcessingQueue = false;

  constructor() {
    if (!this.secret) {
      this.logger.warn(
        'SHADOW_CLOUD_BOT_NOTIFY_SECRET is not set. Notification deliveries will remain queued until the API restarts with a configured secret.',
      );
    }
  }

  onModuleInit() {
    this.queueInterval = setInterval(() => {
      void this.processDueNotifications();
    }, this.queuePollIntervalMs);

    void this.processDueNotifications();
  }

  onModuleDestroy() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }

  async notifySaveUploaded(payload: UploadNotificationPayload) {
    if (!payload.game.discordThreadId) {
      this.logger.warn(
        `Skipping save-uploaded notification for game ${payload.game.slug} (${payload.game.id}): discordThreadId is missing.`,
      );
      return;
    }

    await this.enqueueNotification({
      event: NotificationDeliveryEvent.SAVE_UPLOADED,
      payload,
      eventName: 'save-uploaded',
      gameId: payload.game.id,
      gameSlug: payload.game.slug,
    });
  }

  async enqueueSaveReplaced(
    transaction: Prisma.TransactionClient,
    payload: SaveReplacedNotificationPayload,
  ) {
    if (!payload.game.discordThreadId) {
      this.logger.warn(
        `Skipping save-replaced notification for game ${payload.game.slug} (${payload.game.id}): discordThreadId is missing.`,
      );
      return;
    }

    const delivery = await transaction.notificationDelivery.create({
      data: {
        event: NotificationDeliveryEvent.SAVE_REPLACED,
        gameId: payload.game.id,
        gameSlug: payload.game.slug,
        payload: JSON.stringify(payload),
      },
    });

    this.logger.log(
      `Queued bot notification save-replaced for game ${payload.game.slug} (${payload.game.id}) as delivery ${delivery.id}.`,
    );
  }

  async notifyGameInitialized(payload: GameInitializedNotificationPayload) {
    if (!payload.game.discordThreadId) {
      this.logger.warn(
        `Skipping game-initialized notification for game ${payload.game.slug} (${payload.game.id}): discordThreadId is missing.`,
      );
      return;
    }

    await this.enqueueNotification({
      event: NotificationDeliveryEvent.GAME_INITIALIZED,
      payload,
      eventName: 'game-initialized',
      gameId: payload.game.id,
      gameSlug: payload.game.slug,
    });
  }

  async notifyThreadRenamed(payload: ThreadRenameNotificationPayload) {
    if (!payload.game.discordThreadId) {
      this.logger.warn(
        `Skipping thread-rename notification for game ${payload.game.slug} (${payload.game.id}): discordThreadId is missing.`,
      );
      return;
    }

    await this.enqueueNotification({
      event: NotificationDeliveryEvent.THREAD_RENAMED,
      payload,
      eventName: 'thread-rename',
      gameId: payload.game.id,
      gameSlug: payload.game.slug,
    });
  }

  private async enqueueNotification({
    event,
    payload,
    eventName,
    gameId,
    gameSlug,
  }: EnqueueNotificationInput) {
    const delivery = await prisma.notificationDelivery.create({
      data: {
        event,
        gameId,
        gameSlug,
        payload: JSON.stringify(payload),
      },
    });

    this.logger.log(
      `Queued bot notification ${eventName} for game ${gameSlug} (${gameId}) as delivery ${delivery.id}.`,
    );

    void this.processDueNotifications();
  }

  private async processDueNotifications() {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      for (;;) {
        const delivery = await this.claimNextDelivery();

        if (!delivery) {
          return;
        }

        await this.deliverNotification(delivery);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async claimNextDelivery() {
    const now = new Date();
    const staleProcessingBefore = new Date(
      now.getTime() - this.staleProcessingWindowMs,
    );

    for (let index = 0; index < this.maxBatchSize; index += 1) {
      const candidate = await prisma.notificationDelivery.findFirst({
        where: {
          OR: [
            {
              status: NotificationDeliveryStatus.PENDING,
              nextAttemptAt: { lte: now },
            },
            {
              status: NotificationDeliveryStatus.PROCESSING,
              processingStartedAt: { lt: staleProcessingBefore },
            },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      });

      if (!candidate) {
        return null;
      }

      const claimed = await prisma.notificationDelivery.updateMany({
        where: {
          id: candidate.id,
          OR: [
            {
              status: NotificationDeliveryStatus.PENDING,
              nextAttemptAt: { lte: now },
            },
            {
              status: NotificationDeliveryStatus.PROCESSING,
              processingStartedAt: { lt: staleProcessingBefore },
            },
          ],
        },
        data: {
          status: NotificationDeliveryStatus.PROCESSING,
          processingStartedAt: now,
          attempts: { increment: 1 },
          lastError: null,
        },
      });

      if (claimed.count === 1) {
        return {
          ...candidate,
          attempts: candidate.attempts + 1,
          status: NotificationDeliveryStatus.PROCESSING,
          processingStartedAt: now,
        };
      }
    }

    return null;
  }

  private async deliverNotification(
    delivery: Awaited<
      ReturnType<typeof this.claimNextDelivery>
    > extends infer TResult
      ? Exclude<TResult, null>
      : never,
  ) {
    const context = this.getNotificationContext(delivery);
    const endpoint = this.getEndpointForEvent(delivery.event);
    const payload = JSON.parse(delivery.payload) as unknown;

    if (!this.secret) {
      await this.rescheduleDelivery(
        delivery,
        'SHADOW_CLOUD_BOT_NOTIFY_SECRET is not configured in the API process.',
      );
      return;
    }

    const result = await this.postNotification(endpoint, payload, context);

    if (result.ok) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.DELIVERED,
          deliveredAt: new Date(),
          processingStartedAt: null,
          lastError: null,
        },
      });
      return;
    }

    if (result.retryable) {
      await this.rescheduleDelivery(delivery, result.message);
      return;
    }

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        processingStartedAt: null,
        lastError: result.message,
      },
    });

    this.logger.warn(
      `Bot notification ${context.eventName} permanently failed for game ${context.gameSlug} (${context.gameId}) after ${delivery.attempts} attempts: ${result.message}`,
    );
  }

  private async rescheduleDelivery(
    delivery: {
      id: string;
      attempts: number;
    },
    reason: string,
  ) {
    if (delivery.attempts >= this.maxAttempts) {
      await prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.FAILED,
          processingStartedAt: null,
          lastError: reason,
        },
      });

      this.logger.warn(
        `Bot notification delivery ${delivery.id} exhausted retries after ${delivery.attempts} attempts: ${reason}`,
      );
      return;
    }

    const nextAttemptAt = new Date(
      Date.now() + this.getRetryDelayMs(delivery.attempts),
    );

    await prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: NotificationDeliveryStatus.PENDING,
        processingStartedAt: null,
        nextAttemptAt,
        lastError: reason,
      },
    });

    this.logger.warn(
      `Bot notification delivery ${delivery.id} will retry after attempt ${delivery.attempts}: ${reason}`,
    );
  }

  private getNotificationContext(delivery: {
    event: NotificationDeliveryEvent;
    gameId: string;
    gameSlug: string;
  }): NotificationContext {
    return {
      eventName: this.getEventName(delivery.event),
      gameId: delivery.gameId,
      gameSlug: delivery.gameSlug,
    };
  }

  private getEventName(
    event: NotificationDeliveryEvent,
  ): NotificationEventName {
    switch (event) {
      case NotificationDeliveryEvent.SAVE_UPLOADED:
        return 'save-uploaded';
      case NotificationDeliveryEvent.SAVE_REPLACED:
        return 'save-replaced';
      case NotificationDeliveryEvent.GAME_INITIALIZED:
        return 'game-initialized';
      case NotificationDeliveryEvent.THREAD_RENAMED:
        return 'thread-rename';
      case NotificationDeliveryEvent.TURN_NUDGE:
        return 'turn-nudge';
    }
  }

  private getEndpointForEvent(event: NotificationDeliveryEvent) {
    switch (event) {
      case NotificationDeliveryEvent.SAVE_UPLOADED:
        return this.saveUploadedEndpoint;
      case NotificationDeliveryEvent.SAVE_REPLACED:
        return this.saveReplacedEndpoint;
      case NotificationDeliveryEvent.GAME_INITIALIZED:
        return this.gameInitializedEndpoint;
      case NotificationDeliveryEvent.THREAD_RENAMED:
        return this.threadRenameEndpoint;
      case NotificationDeliveryEvent.TURN_NUDGE:
        return this.turnNudgeEndpoint;
    }
  }

  private getRetryDelayMs(attempt: number) {
    const baseDelayMs = 5_000;
    const cappedAttempt = Math.min(attempt - 1, 5);

    return baseDelayMs * 2 ** cappedAttempt;
  }

  private async postNotification(
    endpoint: string,
    payload: unknown,
    context: NotificationContext,
  ) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shadow-cloud-notify-secret': this.secret ?? '',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const message = body || 'No response body.';

        if (response.status === 202) {
          this.logger.warn(
            `Bot notification ${context.eventName} skipped for game ${context.gameSlug} (${context.gameId}): ${message}`,
          );
          return {
            ok: false,
            retryable: false,
            message,
          };
        }

        this.logger.warn(
          `Bot notification ${context.eventName} failed for game ${context.gameSlug} (${context.gameId}) with ${response.status}: ${message}`,
        );

        return {
          ok: false,
          retryable: response.status >= 500 || response.status === 401,
          message: `HTTP ${response.status}: ${message}`,
        };
      }

      this.logger.log(
        `Bot notification ${context.eventName} delivered for game ${context.gameSlug} (${context.gameId}).`,
      );

      return {
        ok: true,
        retryable: false,
        message: '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Bot notification ${context.eventName} request failed for game ${context.gameSlug} (${context.gameId}).`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        ok: false,
        retryable: true,
        message,
      };
    }
  }
}
