import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { AuditEventType, prisma } from '../../database';
import { BotNotificationsService } from '../bot-notifications.service';
import { FileStorageService } from '../file-storage.service';
import { getDiscordIdentity } from '../support/discord-user.helpers';
import { buildGameIdentifierWhere } from '../support/game-lookup.helpers';
import type {
  ReplaceSaveMetadata,
  UploadedSaveFile,
} from '../support/game-payload.types';
import { assertReplacementSaveFile } from '../support/save-file-validation';

@Injectable()
export class GamesFileService {
  private readonly logger = new Logger(GamesFileService.name);

  constructor(
    private readonly authService: AuthService,
    private readonly fileStorage: FileStorageService,
    private readonly botNotifications: BotNotificationsService,
  ) {}

  async replaceSave(
    gameId: string,
    fileVersionId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
    metadata: ReplaceSaveMetadata = {},
  ) {
    if (!userId) {
      throw new UnauthorizedException(
        'Authenticated user id is missing from the token.',
      );
    }

    assertReplacementSaveFile(file);

    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      select: {
        id: true,
        gameNumber: true,
        slug: true,
        name: true,
        discordThreadId: true,
        fileVersions: {
          where: { id: fileVersionId },
          select: {
            id: true,
            uploadedById: true,
            storagePath: true,
            originalName: true,
            versionNumber: true,
            clientOriginalName: true,
            clientFileSize: true,
            contentHash: true,
          },
        },
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    const fileVersion = game.fileVersions[0];

    if (!fileVersion) {
      throw new NotFoundException(
        `Save file ${fileVersionId} was not found for game ${gameId}.`,
      );
    }

    const isOwner = fileVersion.uploadedById === userId;
    const hasOverride =
      !isOwner &&
      metadata.shadowOverrideEnabled === true &&
      (await this.authService.isUserShadowOverride(userId));

    if (!isOwner && !hasOverride) {
      throw new ForbiddenException(
        'Only the original uploader can replace this save file.',
      );
    }

    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        identities: {
          select: {
            provider: true,
            providerId: true,
          },
        },
      },
    });

    if (!actor) {
      throw new NotFoundException(`User ${userId} was not found.`);
    }

    let stagedPath: string | null = null;

    try {
      const stagedFile = await this.fileStorage.stageReplacement({
        gameId: game.id,
        canonicalName: fileVersion.originalName,
        content: file.buffer,
      });
      stagedPath = stagedFile.storagePath;
      const replacedAt = new Date();

      await prisma.$transaction(async (transaction) => {
        const replacement = await transaction.fileVersion.updateMany({
          where: {
            id: fileVersion.id,
            gameId: game.id,
            storagePath: fileVersion.storagePath,
          },
          data: {
            storagePath: stagedFile.storagePath,
            clientOriginalName: file.originalname,
            clientFileSize: file.buffer.byteLength,
            contentHash: metadata.contentHash ?? null,
            replacedAt,
            replacedById: userId,
          },
        });

        if (replacement.count !== 1) {
          throw new ConflictException(
            'The save file changed before it could be replaced.',
          );
        }

        await transaction.auditEvent.create({
          data: {
            gameId: game.id,
            actorId: userId,
            eventType: AuditEventType.FILE_REPLACED,
            payload: JSON.stringify({
              fileVersionId: fileVersion.id,
              versionNumber: fileVersion.versionNumber,
              originalName: fileVersion.originalName,
              replacementActor: {
                id: actor.id,
                displayName: actor.displayName,
              },
              previous: {
                storagePath: fileVersion.storagePath,
                clientOriginalName: fileVersion.clientOriginalName,
                clientFileSize: fileVersion.clientFileSize,
                contentHash: fileVersion.contentHash,
              },
              next: {
                storagePath: stagedFile.storagePath,
                clientOriginalName: file.originalname,
                clientFileSize: file.buffer.byteLength,
                contentHash: metadata.contentHash ?? null,
              },
            }),
          },
        });

        await this.botNotifications.enqueueSaveReplaced(transaction, {
          game: {
            id: game.id,
            gameNumber: game.gameNumber,
            slug: game.slug,
            name: game.name,
            discordThreadId: game.discordThreadId,
          },
          replacement: {
            versionId: fileVersion.id,
            versionNumber: fileVersion.versionNumber,
            originalName: fileVersion.originalName,
            replacedAt: replacedAt.toISOString(),
            replacedBy: {
              id: actor.id,
              displayName: actor.displayName,
              discordId: getDiscordIdentity(actor),
            },
          },
        });
      });

      try {
        await this.fileStorage.removeFileOrThrow(fileVersion.storagePath);
      } catch (cleanupError) {
        this.logger.warn(
          `Unable to remove previous save ${fileVersion.storagePath} after replacement.`,
          cleanupError instanceof Error ? cleanupError.stack : undefined,
        );
      }

      return {
        fileVersionId: fileVersion.id,
        versionNumber: fileVersion.versionNumber,
        originalName: fileVersion.originalName,
        replacedAt: replacedAt.toISOString(),
        replacedByDisplayName: actor.displayName,
      };
    } catch (error) {
      if (stagedPath) {
        try {
          await this.fileStorage.removeFileOrThrow(stagedPath);
        } catch (cleanupError) {
          this.logger.warn(
            `Unable to remove staged replacement save ${stagedPath}.`,
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
        }
      }

      throw error;
    }
  }
}
