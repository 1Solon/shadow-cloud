import { Injectable } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
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

export type {
  ResetPasswordInput,
  UndoPasswordResetInput,
} from '../support/save-publication';

@Injectable()
export class GamesFileService {
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
    void this.cleanupRecovery();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  cleanupRecovery() {
    return this.publication.cleanupRecovery();
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
