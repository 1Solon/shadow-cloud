import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { prisma } from '../../database';
import { BotNotificationsService } from '../bot-notifications.service';
import { FileStorageService } from '../file-storage.service';
import type {
  ReplaceSaveMetadata,
  UploadedSaveFile,
} from '../support/game-payload.types';
import {
  SavePublication,
  type ResetPasswordInput,
  type UndoPasswordResetInput,
} from '../support/save-publication';
import {
  pruneRetainedSaves,
  resolveSaveRetentionLimit,
} from '../support/save-retention';

export type {
  ResetPasswordInput,
  UndoPasswordResetInput,
} from '../support/save-publication';

@Injectable()
export class GamesFileService {
  private readonly logger = new Logger(GamesFileService.name);
  private readonly publication: SavePublication;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    authService: AuthService,
    fileStorage: FileStorageService,
    botNotifications: BotNotificationsService,
  ) {
    this.publication = new SavePublication(
      authService,
      fileStorage,
      botNotifications,
    );
  }

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupRecovery();
    }, 30_000);
    void this.pruneBacklog().finally(() => this.cleanupRecovery());
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  cleanupRecovery() {
    return this.publication.cleanupRecovery();
  }

  // Uploads keep campaigns within the limit; this catches a lowered limit.
  private async pruneBacklog() {
    try {
      const { saves, campaigns, failed } = await pruneRetainedSaves(
        prisma,
        resolveSaveRetentionLimit(),
      );
      this.logger.log(
        `Pruned ${saves} saves across ${campaigns} campaigns under the save retention limit.`,
      );
      for (const { gameId, error } of failed) {
        this.logger.error(
          `Pruning campaign ${gameId} failed; its next upload or restart retries.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    } catch (error) {
      this.logger.error(
        'Pruning saves under the save retention limit failed; it retries on restart.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  inspectLatestSave(
    gameId: string,
    userId: string | undefined,
    shadowOverrideEnabled = false,
  ) {
    return this.publication.inspectLatestSave(
      gameId,
      userId,
      shadowOverrideEnabled,
    );
  }

  getPasswordResetRecovery(
    gameId: string,
    userId: string | undefined,
    shadowOverrideEnabled = false,
  ) {
    return this.publication.getPasswordResetRecovery(
      gameId,
      userId,
      shadowOverrideEnabled,
    );
  }

  resetPassword(
    gameId: string,
    userId: string | undefined,
    input: ResetPasswordInput,
    shadowOverrideEnabled = false,
  ) {
    return this.publication.resetPassword(
      gameId,
      userId,
      input,
      shadowOverrideEnabled,
    );
  }

  undoPasswordReset(
    gameId: string,
    userId: string | undefined,
    input: UndoPasswordResetInput,
    shadowOverrideEnabled = false,
  ) {
    return this.publication.undoPasswordReset(
      gameId,
      userId,
      input,
      shadowOverrideEnabled,
    );
  }

  replaceSave(
    gameId: string,
    fileVersionId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
    metadata: ReplaceSaveMetadata = {},
  ) {
    return this.publication.replaceSave(
      gameId,
      fileVersionId,
      userId,
      file,
      metadata,
    );
  }
}
