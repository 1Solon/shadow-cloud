import { Injectable, Logger } from '@nestjs/common';

export type UploadNotificationPayload = {
  game: {
    id: string;
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

export type GameInitializedNotificationPayload = {
  game: {
    id: string;
    slug: string;
    name: string;
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

@Injectable()
export class BotNotificationsService {
  private readonly logger = new Logger(BotNotificationsService.name);
  private readonly notificationBaseUrl =
    process.env.SHADOW_CLOUD_BOT_NOTIFY_BASE_URL?.replace(/\/$/, '') ??
    'http://127.0.0.1:3011';
  private readonly saveUploadedEndpoint = `${this.notificationBaseUrl}/notify/save-uploaded`;
  private readonly gameInitializedEndpoint = `${this.notificationBaseUrl}/notify/game-initialized`;
  private readonly secret = process.env.SHADOW_CLOUD_BOT_NOTIFY_SECRET;

  async notifySaveUploaded(payload: UploadNotificationPayload) {
    if (!this.secret || !payload.game.discordThreadId) {
      return;
    }

    await this.postNotification(this.saveUploadedEndpoint, payload);
  }

  async notifyGameInitialized(payload: GameInitializedNotificationPayload) {
    if (!this.secret || !payload.game.discordThreadId) {
      return;
    }

    await this.postNotification(this.gameInitializedEndpoint, payload);
  }

  private async postNotification(endpoint: string, payload: unknown) {
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
        this.logger.warn(
          `Bot notification failed with ${response.status}: ${body}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        'Bot notification request failed.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
