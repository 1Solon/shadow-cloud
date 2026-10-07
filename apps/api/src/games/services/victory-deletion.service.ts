import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { prisma } from '../../database';
import { FileStorageService } from '../file-storage.service';
import { deleteDueCampaigns } from '../support/campaign-deletion';

@Injectable()
export class VictoryDeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VictoryDeletionService.name);
  private readonly pollIntervalMs = 60_000;
  private pollInterval: NodeJS.Timeout | null = null;
  private activePoll: Promise<void> | null = null;

  constructor(private readonly fileStorage: FileStorageService) {}

  onModuleInit() {
    this.pollInterval = setInterval(() => {
      void this.startPoll();
    }, this.pollIntervalMs);

    void this.startPoll();
  }

  async onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    await this.activePoll;
  }

  private startPoll() {
    if (this.activePoll) {
      return this.activePoll;
    }

    const activePoll = deleteDueCampaigns(prisma, this.fileStorage)
      .then((failed) => {
        for (const { id, error } of failed) {
          this.logError(`Deleting concluded campaign ${id} failed.`, error);
        }
      })
      .catch((error: unknown) => {
        this.logError('Concluded campaign deletion poll failed.', error);
      })
      .finally(() => {
        if (this.activePoll === activePoll) {
          this.activePoll = null;
        }
      });

    this.activePoll = activePoll;
    return activePoll;
  }

  private logError(message: string, error: unknown) {
    this.logger.error(
      message,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
