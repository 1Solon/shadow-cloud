import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
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
import { assertSaveBaseline, saveBaseline } from '../support/save-baseline';
import {
  closeSaveRecovery,
  cleanupSaveRecovery,
  saveStagingLease,
} from '../support/save-recovery';
import {
  inspectSave,
  replacePassword,
  MAX_ARCHIVE_BYTES,
  SaveFormatError,
} from '../../save-format';

export type ResetPasswordInput = {
  fileVersionId: string;
  sourceId: string;
  expectedSaveBaseline: string;
  regimeId: string;
  password: string;
  confirmed: boolean;
};

export type UndoPasswordResetInput = {
  resetId: string;
  outputId: string;
  outputRevision: number;
  expectedSaveBaseline: string;
  confirmed: boolean;
};

@Injectable()
export class GamesFileService {
  private readonly logger = new Logger(GamesFileService.name);
  private cleanupTimer?: NodeJS.Timeout;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupRecovery();
    }, 30_000);
    void this.cleanupRecovery();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  async cleanupRecovery() {
    try {
      await cleanupSaveRecovery(prisma, this.fileStorage);
    } catch {
      this.logger.warn('Save recovery cleanup will retry.');
    }
  }

  private async readSave(path: string) {
    try {
      const download = await this.fileStorage.openDownload(path);
      try {
        if (download.size > MAX_ARCHIVE_BYTES)
          throw new SaveFormatError('limit');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of download.stream as AsyncIterable<Uint8Array>) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_ARCHIVE_BYTES) throw new SaveFormatError('limit');
          chunks.push(buffer);
        }
        return Buffer.concat(chunks, size);
      } finally {
        download.stream.destroy();
      }
    } catch {
      throw new ServiceUnavailableException(
        'The save artifact is unavailable. Refresh and try again.',
      );
    }
  }

  private async recoverySnapshot(gameId: string, userId: string | undefined) {
    if (!userId)
      throw new UnauthorizedException('Sign in to manage password recovery.');
    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      include: {
        fileVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        turnRecords: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
    if (game.organizerId !== userId)
      throw new ForbiddenException(
        'Only the current Overlord can manage password recovery.',
      );
    const file = game.fileVersions[0];
    const reset = file
      ? await prisma.passwordReset.findFirst({
          where: {
            gameId: game.id,
            fileVersionId: file.id,
            state: 'ACTIVE',
            outputRevision: file.contentRevision,
            saveRevision: game.saveRevision,
            turnRecordId: game.turnRecords[0]?.id ?? null,
          },
        })
      : null;
    return { game, file, reset };
  }

  async getPasswordResetRecovery(gameId: string, userId: string | undefined) {
    const { game, file, reset } = await this.recoverySnapshot(gameId, userId);
    if (!reset) return { undo: null };
    const source = await this.readSave(reset.sourcePath);
    const output = await this.readSave(file.storagePath);
    const hash = (bytes: Buffer) =>
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (hash(source) !== reset.sourceId || hash(output) !== reset.outputId)
      return { undo: null };
    const current = await this.recoverySnapshot(gameId, userId);
    if (
      current.reset?.id !== reset.id ||
      saveBaseline(current.game) !== saveBaseline(game) ||
      current.file.storagePath !== file.storagePath
    ) {
      throw new ConflictException(
        'The campaign or latest save changed. Refresh password recovery.',
      );
    }
    return {
      undo: {
        resetId: reset.id,
        outputId: reset.outputId,
        outputRevision: reset.outputRevision,
        expectedSaveBaseline: saveBaseline(game),
        regimeName: reset.regimeName,
      },
    };
  }

  async undoPasswordReset(
    gameId: string,
    userId: string | undefined,
    input: UndoPasswordResetInput,
  ) {
    const { game, file, reset } = await this.recoverySnapshot(gameId, userId);
    const conflict = () =>
      new ConflictException(
        'This reset can no longer be undone. Refresh the campaign and download the latest save.',
      );
    if (!input || input.confirmed !== true)
      throw new BadRequestException(
        'Confirm that undo restores the previous password.',
      );
    assertSaveBaseline(game, input.expectedSaveBaseline ?? '');
    if (
      !reset ||
      reset.id !== input.resetId ||
      reset.outputId !== input.outputId ||
      reset.outputRevision !== input.outputRevision
    )
      throw conflict();
    const hash = (bytes: Buffer) =>
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const source = await this.readSave(reset.sourcePath);
    if (
      hash(source) !== reset.sourceId ||
      hash(await this.readSave(file.storagePath)) !== reset.outputId
    )
      throw conflict();
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    const lease = saveStagingLease(prisma, this.fileStorage);
    let result;
    try {
      const staged = await this.fileStorage.stageReplacement({
        gameId: game.id,
        canonicalName: file.originalName,
        content: source,
        prepare: lease.prepare,
      });
      const replacedAt = new Date();
      result = await prisma.$transaction(async (tx) => {
        const fenced = await tx.game.updateMany({
          where: {
            id: game.id,
            organizerId: userId,
            turnRevision: game.turnRevision,
            saveRevision: game.saveRevision,
          },
          data: { saveRevision: { increment: 1 } },
        });
        if (!fenced.count) throw conflict();
        const current = await tx.fileVersion.findFirst({
          where: { gameId: game.id },
          orderBy: { versionNumber: 'desc' },
        });
        const recovery = await tx.passwordReset.findUnique({
          where: { id: reset.id },
        });
        const turn = await tx.turnRecord.findFirst({
          where: { gameId: game.id, endedAt: null },
          orderBy: { startedAt: 'desc' },
        });
        if (
          !current ||
          current.id !== file.id ||
          current.storagePath !== file.storagePath ||
          current.contentRevision !== reset.outputRevision ||
          recovery?.state !== 'ACTIVE' ||
          (turn?.id ?? null) !== reset.turnRecordId
        )
          throw conflict();
        if (
          hash(await this.readSave(current.storagePath)) !== reset.outputId ||
          hash(await this.readSave(reset.sourcePath)) !== reset.sourceId
        )
          throw conflict();
        if (hash(await this.readSave(staged.storagePath)) !== reset.sourceId)
          throw new ServiceUnavailableException(
            'The staged save failed verification.',
          );
        await closeSaveRecovery(tx, game.id);
        await tx.saveCleanup.upsert({
          where: { storagePath: file.storagePath },
          create: { storagePath: file.storagePath },
          update: { dueAt: new Date() },
        });
        await tx.fileVersion.update({
          where: { id: file.id },
          data: {
            storagePath: staged.storagePath,
            contentHash: reset.sourceId,
            clientFileSize: source.length,
            contentRevision: { increment: 1 },
            replacedAt,
            replacedById: userId,
          },
        });
        await tx.saveCleanup.delete({
          where: { storagePath: staged.storagePath },
        });
        await tx.auditEvent.create({
          data: {
            gameId: game.id,
            actorId: userId,
            eventType: AuditEventType.FILE_REPLACED,
            payload: JSON.stringify({
              operation: 'password-reset-undo',
              resetId: reset.id,
              fileVersionId: file.id,
              sourceId: reset.outputId,
              outputId: reset.sourceId,
              regimeId: reset.regimeId,
              regimeName: reset.regimeName,
            }),
          },
        });
        await this.botNotifications.enqueueSaveReplaced(tx, {
          game: {
            id: game.id,
            gameNumber: game.gameNumber,
            slug: game.slug,
            name: game.name,
            discordThreadId: game.discordThreadId,
          },
          replacement: {
            versionId: file.id,
            versionNumber: file.versionNumber,
            originalName: file.originalName,
            replacedAt: replacedAt.toISOString(),
            replacedBy: {
              id: actor.id,
              displayName: actor.displayName,
              discordId: getDiscordIdentity(actor),
            },
            passwordRecovery: {
              operation: 'undo',
              regimeName: reset.regimeName,
            },
          },
        });
        return {
          resetId: reset.id,
          fileVersionId: file.id,
          contentRevision: file.contentRevision + 1,
          regimeName: reset.regimeName,
          replacedAt: replacedAt.toISOString(),
        };
      });
    } catch (error) {
      await lease.discard();
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        'Undo could not be published. Refresh and try again.',
      );
    }
    await this.cleanupRecovery();
    return result;
  }

  async resetPassword(
    gameId: string,
    userId: string | undefined,
    input: ResetPasswordInput,
  ) {
    if (!userId)
      throw new UnauthorizedException('Sign in to reset a password.');
    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      include: {
        fileVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        turnRecords: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
    if (game.organizerId !== userId)
      throw new ForbiddenException(
        'Only the current Overlord can reset passwords.',
      );
    if (!input || input.confirmed !== true)
      throw new BadRequestException(
        'Confirm the selected regime and restart warning.',
      );
    assertSaveBaseline(game, input.expectedSaveBaseline ?? '');
    const file = game.fileVersions[0];
    const conflict = () =>
      new ConflictException(
        'The campaign or latest save changed. Inspect it again before resetting.',
      );
    if (!file || file.id !== input.fileVersionId) throw conflict();
    const key = process.env.SHADOW_CLOUD_SAVE_ARCHIVE_KEY;
    if (!key || Buffer.byteLength(key) > 1024)
      throw new ServiceUnavailableException(
        'Save inspection is not configured on this server.',
      );
    const source = await this.readSave(file.storagePath);
    const hash = (bytes: Buffer) =>
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (hash(source) !== input.sourceId) throw conflict();
    let output: Buffer;
    let regime;
    try {
      regime = inspectSave(source, Buffer.from(key)).regimes.find(
        (r) => r.id === input.regimeId && r.eligible,
      );
      if (!regime) throw new SaveFormatError('unsupported');
      output = replacePassword(source, Buffer.from(key), input);
    } catch (error) {
      throw new UnprocessableEntityException(
        error instanceof SaveFormatError
          ? error.message
          : 'Save processing failed.',
      );
    }
    const outputId = hash(output);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    const lease = saveStagingLease(prisma, this.fileStorage);
    let result;
    try {
      const staged = await this.fileStorage.stageReplacement({
        gameId: game.id,
        canonicalName: file.originalName,
        content: output,
        prepare: lease.prepare,
      });
      const replacedAt = new Date();
      result = await prisma.$transaction(async (tx) => {
        const fenced = await tx.game.updateMany({
          where: {
            id: game.id,
            organizerId: userId,
            turnRevision: game.turnRevision,
            saveRevision: game.saveRevision,
          },
          data: { saveRevision: { increment: 1 } },
        });
        if (!fenced.count) throw conflict();
        const current = await tx.fileVersion.findFirst({
          where: { gameId: game.id },
          orderBy: { versionNumber: 'desc' },
        });
        if (
          !current ||
          current.id !== file.id ||
          current.storagePath !== file.storagePath ||
          current.contentRevision !== file.contentRevision
        )
          throw conflict();
        if (hash(await this.readSave(current.storagePath)) !== input.sourceId)
          throw conflict();
        if (hash(await this.readSave(staged.storagePath)) !== outputId)
          throw new ServiceUnavailableException(
            'The staged save failed verification.',
          );
        await closeSaveRecovery(tx, game.id);
        const reset = await tx.passwordReset.create({
          data: {
            gameId: game.id,
            fileVersionId: file.id,
            sourcePath: file.storagePath,
            sourceId: input.sourceId,
            outputId,
            outputRevision: file.contentRevision + 1,
            saveRevision: game.saveRevision + 1,
            turnRecordId: game.turnRecords[0]?.id ?? null,
            actorId: userId,
            regimeId: regime.id,
            regimeName: regime.name,
          },
        });
        await tx.fileVersion.update({
          where: { id: file.id },
          data: {
            storagePath: staged.storagePath,
            contentHash: outputId,
            clientFileSize: output.length,
            contentRevision: { increment: 1 },
            replacedAt,
            replacedById: userId,
          },
        });
        await tx.saveCleanup.delete({
          where: { storagePath: staged.storagePath },
        });
        await tx.auditEvent.create({
          data: {
            gameId: game.id,
            actorId: userId,
            eventType: AuditEventType.FILE_REPLACED,
            payload: JSON.stringify({
              operation: 'password-reset',
              resetId: reset.id,
              fileVersionId: file.id,
              sourceId: input.sourceId,
              outputId,
              regimeId: regime.id,
              regimeName: regime.name,
            }),
          },
        });
        await this.botNotifications.enqueueSaveReplaced(tx, {
          game: {
            id: game.id,
            gameNumber: game.gameNumber,
            slug: game.slug,
            name: game.name,
            discordThreadId: game.discordThreadId,
          },
          replacement: {
            versionId: file.id,
            versionNumber: file.versionNumber,
            originalName: file.originalName,
            replacedAt: replacedAt.toISOString(),
            replacedBy: {
              id: actor.id,
              displayName: actor.displayName,
              discordId: getDiscordIdentity(actor),
            },
            passwordRecovery: { operation: 'reset', regimeName: regime.name },
          },
        });
        return {
          resetId: reset.id,
          fileVersionId: file.id,
          contentRevision: file.contentRevision + 1,
          regimeName: regime.name,
          replacedAt: replacedAt.toISOString(),
        };
      });
    } catch (error) {
      await lease.discard();
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        'Password reset could not be published. Refresh and try again.',
      );
    }
    await this.cleanupRecovery();
    return result;
  }

  constructor(
    private readonly authService: AuthService,
    private readonly fileStorage: FileStorageService,
    private readonly botNotifications: BotNotificationsService,
  ) {}

  async inspectLatestSave(gameId: string, userId: string | undefined) {
    if (!userId)
      throw new UnauthorizedException('Sign in to inspect this save.');
    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      select: {
        id: true,
        organizerId: true,
        turnRevision: true,
        saveRevision: true,
        fileVersions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, storagePath: true },
        },
      },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
    if (game.organizerId !== userId)
      throw new ForbiddenException(
        'Only the current Overlord can inspect regimes.',
      );
    const file = game.fileVersions[0];
    if (!file)
      throw new NotFoundException('This campaign has no save to inspect.');
    const key = process.env.SHADOW_CLOUD_SAVE_ARCHIVE_KEY;
    if (!key || Buffer.byteLength(key) > 1024)
      throw new ServiceUnavailableException(
        'Save inspection is not configured on this server.',
      );
    let bytes: Buffer;
    try {
      const download = await this.fileStorage.openDownload(file.storagePath);
      try {
        if (download.size > MAX_ARCHIVE_BYTES)
          throw new SaveFormatError('limit');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of download.stream as AsyncIterable<Uint8Array>) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_ARCHIVE_BYTES) throw new SaveFormatError('limit');
          chunks.push(buffer);
        }
        bytes = Buffer.concat(chunks, size);
      } finally {
        download.stream.destroy();
      }
    } catch (error) {
      if (error instanceof SaveFormatError)
        throw new UnprocessableEntityException(error.message);
      throw new ServiceUnavailableException(
        'The latest save is unavailable. Refresh and try again.',
      );
    }
    let inspection;
    try {
      inspection = inspectSave(bytes, Buffer.from(key));
    } catch (error) {
      throw new UnprocessableEntityException(
        error instanceof SaveFormatError
          ? error.message
          : 'Save inspection failed.',
      );
    }
    const current = await prisma.game.findUnique({
      where: { id: game.id },
      select: {
        organizerId: true,
        fileVersions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true, storagePath: true },
        },
      },
    });
    if (!current || current.organizerId !== userId)
      throw new ForbiddenException(
        'Only the current Overlord can inspect regimes.',
      );
    if (
      current.fileVersions[0]?.id !== file.id ||
      current.fileVersions[0]?.storagePath !== file.storagePath
    )
      throw new ConflictException('The latest save changed. Inspect it again.');
    return {
      fileVersionId: file.id,
      expectedSaveBaseline: saveBaseline(game),
      ...inspection,
    };
  }

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
        turnRevision: true,
        saveRevision: true,
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
            contentRevision: true,
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

    assertSaveBaseline(game, metadata.expectedSaveBaseline);

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

    const lease = saveStagingLease(prisma, this.fileStorage);

    try {
      const stagedFile = await this.fileStorage.stageReplacement({
        gameId: game.id,
        canonicalName: fileVersion.originalName,
        content: file.buffer,
        prepare: lease.prepare,
      });
      const replacedAt = new Date();
      const contentHash = `sha256:${createHash('sha256').update(file.buffer).digest('hex')}`;

      await prisma.$transaction(async (transaction) => {
        const fenced = await transaction.game.updateMany({
          where: {
            id: game.id,
            turnRevision: game.turnRevision,
            saveRevision: game.saveRevision,
          },
          data: { saveRevision: { increment: 1 } },
        });
        if (fenced.count !== 1) {
          throw new ConflictException(
            'The campaign or save changed. Refresh and review the latest save before trying again.',
          );
        }
        const current = await transaction.fileVersion.findUnique({
          where: { id: fileVersion.id },
        });
        if (!current || current.gameId !== game.id) {
          throw new ConflictException(
            'The save no longer exists. Refresh the campaign.',
          );
        }
        if (
          current.uploadedById !== userId &&
          !(
            metadata.shadowOverrideEnabled === true &&
            (await this.authService.isUserShadowOverride(userId))
          )
        ) {
          throw new ForbiddenException(
            'Only the original uploader can replace this save file.',
          );
        }
        if (
          !(await transaction.user.findUnique({
            where: { id: userId },
            select: { id: true },
          }))
        ) {
          throw new ForbiddenException(
            'The authenticated user no longer exists.',
          );
        }
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
            contentHash,
            contentRevision: { increment: 1 },
            replacedAt,
            replacedById: userId,
          },
        });

        if (replacement.count !== 1) {
          throw new ConflictException(
            'The save file changed before it could be replaced.',
          );
        }

        await closeSaveRecovery(transaction, game.id);
        await transaction.saveCleanup.delete({
          where: { storagePath: stagedFile.storagePath },
        });
        await transaction.saveCleanup.upsert({
          where: { storagePath: fileVersion.storagePath },
          create: { storagePath: fileVersion.storagePath },
          update: { dueAt: new Date() },
        });

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
                contentHash,
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

      await this.cleanupRecovery();

      return {
        fileVersionId: fileVersion.id,
        versionNumber: fileVersion.versionNumber,
        originalName: fileVersion.originalName,
        replacedAt: replacedAt.toISOString(),
        replacedByDisplayName: actor.displayName,
        contentRevision: fileVersion.contentRevision + 1,
      };
    } catch (error) {
      await lease.discard();

      throw error;
    }
  }
}
