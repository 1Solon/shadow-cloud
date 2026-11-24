import {
  ConflictException,
  ForbiddenException,
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
import type { Prisma } from '../../database';
import {
  BotNotificationsService,
  type PasswordResetActorRole,
} from '../bot-notifications.service';
import { FileStorageService } from '../file-storage.service';
import { assertCampaignInPlay } from './campaign-conclusion';
import { getDiscordIdentity } from './discord-user.helpers';
import { buildGameIdentifierWhere } from './game-lookup.helpers';
import type {
  ReplaceSaveMetadata,
  UploadedSaveFile,
} from './game-payload.types';
import { assertReplacementSaveFile } from './save-file-validation';
import { assertSaveBaseline, saveBaseline } from './save-baseline';
import {
  type ApproverRole,
  approvalBinding,
  isApprovalBound,
  lapseUnboundApprovals,
} from './password-reset-approval';
import {
  closeSaveRecovery,
  cleanupSaveRecovery,
  saveStagingLease,
} from './save-recovery';
import {
  type SaveInspection,
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
  reason?: string;
};

export type GrantPasswordResetApprovalInput = {
  fileVersionId: string;
  sourceId: string;
  expectedSaveBaseline: string;
  reason?: string;
};

export type WithdrawPasswordResetApprovalInput = {
  approvalId: string;
};

export type SetApprovedPasswordInput = {
  approvalId: string;
  expectedSaveBaseline: string;
  password: string;
  confirmed: boolean;
};

export type UndoPasswordResetInput = {
  resetId: string;
  outputId: string;
  outputRevision: number;
  expectedSaveBaseline: string;
  confirmed: boolean;
  reason?: string;
};

export const MAX_PASSWORD_RESET_REASON_LENGTH = 500;

function isOverlord(overlordId: string, userId: string) {
  return overlordId === userId;
}

function reasonUnlessOverlord(
  overlordId: string,
  userId: string,
  reason: unknown,
) {
  if (isOverlord(overlordId, userId)) return null;
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed || trimmed.length > MAX_PASSWORD_RESET_REASON_LENGTH)
    throw new BadRequestException(
      `Give a reason of 1 to ${MAX_PASSWORD_RESET_REASON_LENGTH} characters, such as how the Overlord approved this.`,
    );
  return trimmed;
}

function actorRole(overlordId: string, userId: string) {
  return isOverlord(overlordId, userId)
    ? ('overlord' as const)
    : ('shadowLord' as const);
}

function isSetByActivePlayer(
  reset: { approvalId: string | null; actorId: string } | null,
  activePlayerId: string | null | undefined,
  userId: string,
) {
  return (
    reset?.approvalId != null &&
    reset.actorId === userId &&
    activePlayerId === userId
  );
}

function passwordResetConflict() {
  return new ConflictException(
    'The campaign or latest save changed. Inspect it again before resetting.',
  );
}

function sha256(bytes: Buffer) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

const notifiedUserSelect = {
  select: {
    id: true,
    displayName: true,
    identities: { select: { provider: true, providerId: true } },
  },
} as const;

const activePlayerSelect = {
  select: { activePlayerEntryId: true, activePlayer: notifiedUserSelect },
} as const;

function notifiedUser(user: {
  id: string;
  displayName: string;
  identities: Array<{ provider: string; providerId: string }>;
}) {
  return {
    id: user.id,
    displayName: user.displayName,
    discordId: getDiscordIdentity(user),
  };
}

function activePlayerOf(
  turnState: Prisma.TurnStateGetPayload<typeof activePlayerSelect> | null,
) {
  return turnState?.activePlayer ? notifiedUser(turnState.activePlayer) : null;
}

export class SavePublication {
  private readonly logger = new Logger('GamesFileService');

  // Only named operations below supply transaction work. Callers cannot stage
  // files or construct publication proofs, and cleanup cannot undo a commit.
  private async publish<T>(
    input: { gameId: string; canonicalName: string; content: Buffer },
    commit: (
      tx: Prisma.TransactionClient,
      staged: { storagePath: string },
      replacedAt: Date,
    ) => Promise<T>,
    failureMessage?: string,
  ): Promise<T> {
    const lease = saveStagingLease(prisma, this.fileStorage);
    let result: T;
    try {
      const staged = await this.fileStorage.stageReplacement({
        ...input,
        prepare: lease.prepare,
      });
      const replacedAt = new Date();
      result = await prisma.$transaction(async (tx) => {
        const published = await commit(tx, staged, replacedAt);
        // After commit's first write, so a concurrent victory cannot slip past.
        await assertCampaignInPlay(tx, input.gameId);
        // Consuming the lease atomically prevents publication after reclamation.
        await tx.saveCleanup.delete({
          where: { storagePath: staged.storagePath },
        });
        return published;
      });
    } catch (error) {
      await lease.discard();
      if (
        !failureMessage ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(failureMessage);
    }
    await this.cleanupRecovery();
    return result;
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

  private async canManagePasswords(
    organizerId: string,
    userId: string,
    shadowOverrideEnabled: boolean,
  ) {
    return (
      organizerId === userId ||
      (shadowOverrideEnabled === true &&
        (await this.authService.isUserShadowOverride(userId)))
    );
  }

  private async recoverySnapshot(
    gameId: string,
    userId: string | undefined,
    shadowOverrideEnabled = false,
  ) {
    if (!userId)
      throw new UnauthorizedException('Sign in to manage password recovery.');
    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      include: {
        fileVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        turnState: activePlayerSelect,
        organizer: notifiedUserSelect,
        turnRecords: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
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
    const setByActor = isSetByActivePlayer(
      reset,
      game.turnState?.activePlayer?.id,
      userId,
    );
    if (
      !setByActor &&
      !(await this.canManagePasswords(
        game.organizerId,
        userId,
        shadowOverrideEnabled,
      ))
    )
      throw new ForbiddenException(
        'Only the current Overlord, an enabled Shadow Override, or the player who set the password can manage password recovery.',
      );
    return { game, file, reset, setByActor };
  }

  async getPasswordResetRecovery(
    gameId: string,
    userId: string | undefined,
    shadowOverrideEnabled = false,
  ) {
    const { game, file, reset } = await this.recoverySnapshot(
      gameId,
      userId,
      shadowOverrideEnabled,
    );
    if (!reset) return { undo: null };
    const source = await this.readSave(reset.sourcePath);
    const output = await this.readSave(file.storagePath);
    const hash = (bytes: Buffer) =>
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (hash(source) !== reset.sourceId || hash(output) !== reset.outputId)
      return { undo: null };
    const current = await this.recoverySnapshot(
      gameId,
      userId,
      shadowOverrideEnabled,
    );
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
    shadowOverrideEnabled = false,
  ) {
    const { game, file, reset, setByActor } = await this.recoverySnapshot(
      gameId,
      userId,
      shadowOverrideEnabled,
    );
    const conflict = () =>
      new ConflictException(
        'This reset can no longer be undone. Refresh the campaign and download the latest save.',
      );
    if (!input || input.confirmed !== true)
      throw new BadRequestException(
        'Confirm that undo restores the previous password.',
      );
    const reason = setByActor
      ? null
      : reasonUnlessOverlord(game.organizerId, userId!, input.reason);
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
    return this.publish(
      {
        gameId: game.id,
        canonicalName: file.originalName,
        content: source,
      },
      async (tx, staged, replacedAt) => {
        const fenced = await tx.game.updateMany({
          where: {
            id: game.id,
            organizerId: game.organizerId,
            turnRevision: game.turnRevision,
            saveRevision: game.saveRevision,
          },
          data: { saveRevision: { increment: 1 } },
        });
        if (!fenced.count) throw conflict();
        if (
          setByActor &&
          (await tx.turnState.findUnique({ where: { gameId: game.id } }))
            ?.activePlayerId !== userId
        )
          throw new ForbiddenException(
            'Password recovery permission was lost.',
          );
        if (
          !setByActor &&
          !(await this.canManagePasswords(
            game.organizerId,
            userId!,
            shadowOverrideEnabled,
          ))
        )
          throw new ForbiddenException(
            'Password recovery permission was lost.',
          );
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
        await tx.passwordReset.update({
          where: { id: reset.id },
          data: {
            undoReason: reason,
            undoRevision: file.contentRevision + 1,
          },
        });
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
          activePlayer: activePlayerOf(game.turnState),
          overlord: notifiedUser(game.organizer),
          replacement: {
            contentRevision: file.contentRevision + 1,
            versionId: file.id,
            versionNumber: file.versionNumber,
            originalName: file.originalName,
            replacedAt: replacedAt.toISOString(),
            replacedBy: notifiedUser(actor),
            passwordRecovery: {
              operation: 'undo',
              regimeName: reset.regimeName,
              actorRole: setByActor
                ? 'player'
                : actorRole(game.organizerId, userId!),
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
      },
      'Undo could not be published. Refresh and try again.',
    );
  }

  async resetPassword(
    gameId: string,
    userId: string | undefined,
    input: ResetPasswordInput,
    shadowOverrideEnabled = false,
  ) {
    if (!userId)
      throw new UnauthorizedException('Sign in to reset a password.');
    const game = await this.passwordResetSnapshot(gameId);
    if (
      !(await this.canManagePasswords(
        game.organizerId,
        userId,
        shadowOverrideEnabled,
      ))
    )
      throw new ForbiddenException(
        'Only the current Overlord or an enabled Shadow Override can reset passwords.',
      );
    if (!input || input.confirmed !== true)
      throw new BadRequestException(
        'Confirm the selected regime and restart warning.',
      );
    const reason = reasonUnlessOverlord(game.organizerId, userId, input.reason);
    assertSaveBaseline(game, input.expectedSaveBaseline ?? '');
    const file = game.fileVersions[0];
    if (!file || file.id !== input.fileVersionId) throw passwordResetConflict();
    return this.publishPasswordReset({
      game,
      file,
      userId,
      sourceId: input.sourceId,
      password: input.password,
      selectRegime: (regime) => regime.id === input.regimeId,
      reason,
      actorRole: actorRole(game.organizerId, userId),
      recheck: async () => {
        if (
          !(await this.canManagePasswords(
            game.organizerId,
            userId,
            shadowOverrideEnabled,
          ))
        )
          throw new ForbiddenException('Password reset permission was lost.');
      },
    });
  }

  async setApprovedPassword(
    gameId: string,
    userId: string | undefined,
    input: SetApprovedPasswordInput,
  ) {
    if (!userId) throw new UnauthorizedException('Sign in to set a password.');
    const game = await this.passwordResetSnapshot(gameId);
    if (typeof input?.approvalId !== 'string')
      throw new BadRequestException('Choose the approval to use.');
    const approval = await prisma.passwordResetApproval.findFirst({
      where: { id: input.approvalId, gameId: game.id },
    });
    if (!approval) throw new NotFoundException('Approval not found.');
    if (
      approval.playerId !== userId ||
      game.turnState?.activePlayer?.id !== userId ||
      game.turnState.activePlayerEntryId !== approval.gamePlayerId
    )
      throw new ForbiddenException(
        'Only the active player named in the approval can set this password.',
      );
    if (input.confirmed !== true)
      throw new BadRequestException('Confirm the regime and restart warning.');
    assertSaveBaseline(game, input.expectedSaveBaseline ?? '');
    const file = game.fileVersions[0];
    const ended = () =>
      new ConflictException(
        'This approval has ended. Ask the Overlord for a new one.',
      );
    if (approval.state !== 'OPEN') throw ended();
    if (!file || !isApprovalBound(approval, approvalBinding(game, file))) {
      await prisma.$transaction((tx) =>
        lapseUnboundApprovals(
          tx,
          game.id,
          file ? approvalBinding(game, file) : null,
        ),
      );
      throw ended();
    }
    return this.publishPasswordReset({
      game,
      file,
      userId,
      sourceId: approval.sourceId,
      password: input.password,
      selectRegime: (regime) =>
        regime.id === approval.regimeId && regime.current,
      reason: null,
      actorRole: 'player',
      approval: {
        id: approval.id,
        approverRole: approval.approverRole as ApproverRole,
      },
      recheck: async (tx) => {
        const used = await tx.passwordResetApproval.updateMany({
          where: { id: approval.id, state: 'OPEN' },
          data: { state: 'USED', endedAt: new Date() },
        });
        const turnState = await tx.turnState.findUnique({
          where: { gameId: game.id },
        });
        if (
          !used.count ||
          turnState?.activePlayerId !== userId ||
          turnState.activePlayerEntryId !== approval.gamePlayerId
        )
          throw ended();
      },
    });
  }

  async withdrawPasswordResetApproval(
    gameId: string,
    userId: string | undefined,
    input: WithdrawPasswordResetApprovalInput,
    shadowOverrideEnabled = false,
  ) {
    if (!userId)
      throw new UnauthorizedException('Sign in to withdraw an approval.');
    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      select: { id: true, organizerId: true },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
    if (
      !(await this.canManagePasswords(
        game.organizerId,
        userId,
        shadowOverrideEnabled,
      ))
    )
      throw new ForbiddenException(
        'Only the current Overlord or an enabled Shadow Override can withdraw an approval.',
      );
    if (typeof input?.approvalId !== 'string')
      throw new BadRequestException('Choose the approval to withdraw.');
    const withdrawn = await prisma.passwordResetApproval.updateMany({
      where: { id: input.approvalId, gameId: game.id, state: 'OPEN' },
      data: { state: 'WITHDRAWN', endedAt: new Date() },
    });
    if (!withdrawn.count)
      throw new ConflictException('This approval has already ended.');
    return { approvalId: input.approvalId };
  }

  private async passwordResetSnapshot(gameId: string) {
    const game = await prisma.game.findFirst({
      where: buildGameIdentifierWhere(gameId),
      include: {
        fileVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        turnState: activePlayerSelect,
        organizer: notifiedUserSelect,
        turnRecords: {
          where: { endedAt: null },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
    return game;
  }

  private async publishPasswordReset({
    game,
    file,
    userId,
    sourceId,
    password,
    selectRegime,
    reason,
    actorRole,
    approval,
    recheck,
  }: {
    game: Awaited<ReturnType<SavePublication['passwordResetSnapshot']>>;
    file: Awaited<
      ReturnType<SavePublication['passwordResetSnapshot']>
    >['fileVersions'][number];
    userId: string;
    sourceId: string;
    password: string;
    selectRegime: (regime: SaveInspection['regimes'][number]) => boolean;
    reason: string | null;
    actorRole: PasswordResetActorRole;
    approval?: { id: string; approverRole: ApproverRole };
    recheck: (tx: Prisma.TransactionClient) => Promise<void>;
  }) {
    const key = this.archiveKey();
    const source = await this.readSave(file.storagePath);
    if (sha256(source) !== sourceId) throw passwordResetConflict();
    let output: Buffer;
    let regime;
    try {
      regime = inspectSave(source, key).regimes.find(
        (candidate) => candidate.eligible && selectRegime(candidate),
      );
      if (!regime) throw new SaveFormatError('unsupported');
      output = replacePassword(source, key, {
        sourceId,
        regimeId: regime.id,
        password,
      });
    } catch (error) {
      throw new UnprocessableEntityException(
        error instanceof SaveFormatError
          ? error.message
          : 'Save processing failed.',
      );
    }
    const outputId = sha256(output);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    return this.publish(
      {
        gameId: game.id,
        canonicalName: file.originalName,
        content: output,
      },
      async (tx, staged, replacedAt) => {
        const fenced = await tx.game.updateMany({
          where: {
            id: game.id,
            organizerId: game.organizerId,
            turnRevision: game.turnRevision,
            saveRevision: game.saveRevision,
          },
          data: { saveRevision: { increment: 1 } },
        });
        if (!fenced.count) throw passwordResetConflict();
        await recheck(tx);
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
          throw passwordResetConflict();
        if (sha256(await this.readSave(current.storagePath)) !== sourceId)
          throw passwordResetConflict();
        if (sha256(await this.readSave(staged.storagePath)) !== outputId)
          throw new ServiceUnavailableException(
            'The staged save failed verification.',
          );
        await closeSaveRecovery(tx, game.id);
        await lapseUnboundApprovals(tx, game.id, null);
        const reset = await tx.passwordReset.create({
          data: {
            gameId: game.id,
            fileVersionId: file.id,
            sourcePath: file.storagePath,
            sourceId,
            outputId,
            outputRevision: file.contentRevision + 1,
            saveRevision: game.saveRevision + 1,
            turnRecordId: game.turnRecords[0]?.id ?? null,
            actorId: userId,
            regimeId: regime.id,
            regimeName: regime.name,
            reason,
            approvalId: approval?.id ?? null,
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
        await tx.auditEvent.create({
          data: {
            gameId: game.id,
            actorId: userId,
            eventType: AuditEventType.FILE_REPLACED,
            payload: JSON.stringify({
              operation: 'password-reset',
              resetId: reset.id,
              fileVersionId: file.id,
              sourceId,
              outputId,
              regimeId: regime.id,
              regimeName: regime.name,
              ...(approval ? { approvalId: approval.id } : {}),
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
          activePlayer: activePlayerOf(game.turnState),
          overlord: notifiedUser(game.organizer),
          replacement: {
            contentRevision: file.contentRevision + 1,
            versionId: file.id,
            versionNumber: file.versionNumber,
            originalName: file.originalName,
            replacedAt: replacedAt.toISOString(),
            replacedBy: notifiedUser(actor),
            passwordRecovery: {
              operation: 'reset',
              regimeName: regime.name,
              actorRole,
              ...(approval
                ? {
                    approverRole: approval.approverRole,
                  }
                : {}),
            },
          },
        });
        return {
          resetId: reset.id,
          fileVersionId: file.id,
          contentRevision: file.contentRevision + 1,
          regimeName: regime.name,
          replacedAt: replacedAt.toISOString(),
        };
      },
      'Password reset could not be published. Refresh and try again.',
    );
  }

  private archiveKey() {
    const key = process.env.SHADOW_CLOUD_SAVE_ARCHIVE_KEY;
    if (!key || Buffer.byteLength(key) > 1024)
      throw new ServiceUnavailableException(
        'Save inspection is not configured on this server.',
      );
    return Buffer.from(key);
  }

  async grantPasswordResetApproval(
    gameId: string,
    userId: string | undefined,
    input: GrantPasswordResetApprovalInput,
    shadowOverrideEnabled = false,
  ) {
    if (!userId)
      throw new UnauthorizedException('Sign in to approve a password reset.');
    const game = await this.passwordResetSnapshot(gameId);
    if (
      !(await this.canManagePasswords(
        game.organizerId,
        userId,
        shadowOverrideEnabled,
      ))
    )
      throw new ForbiddenException(
        'Only the current Overlord or an enabled Shadow Override can approve a password reset.',
      );
    if (!input)
      throw new BadRequestException(
        'Inspect the latest save before approving.',
      );
    const reason = reasonUnlessOverlord(game.organizerId, userId, input.reason);
    assertSaveBaseline(game, input.expectedSaveBaseline ?? '');
    const file = game.fileVersions[0];
    const conflict = () =>
      new ConflictException(
        'The campaign or latest save changed. Inspect it again before approving.',
      );
    if (!file || file.id !== input.fileVersionId) throw conflict();
    const activePlayer = game.turnState?.activePlayer;
    const activeSeatId = game.turnState?.activePlayerEntryId;
    if (!activePlayer || !activeSeatId)
      throw new ConflictException(
        'The turn is vacant, so there is no active player to approve. Fill the seat first.',
      );
    const source = await this.readSave(file.storagePath);
    const sourceId = sha256(source);
    if (sourceId !== input.sourceId) throw conflict();
    let regime;
    try {
      regime = inspectSave(source, this.archiveKey()).regimes.find(
        (candidate) => candidate.current,
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnprocessableEntityException(
        error instanceof SaveFormatError
          ? error.message
          : 'Save inspection failed.',
      );
    }
    if (!regime)
      throw new UnprocessableEntityException(
        'The latest save is not waiting on a human-controlled regime.',
      );
    if (!regime.eligible)
      throw new UnprocessableEntityException(
        regime.reason ?? `${regime.name} is not eligible for password reset.`,
      );
    const binding = approvalBinding(game, file);
    return prisma.$transaction(async (tx) => {
      await lapseUnboundApprovals(tx, game.id, binding);
      const current = await tx.game.findUnique({
        where: { id: game.id },
        include: {
          fileVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
          turnState: { select: { activePlayerId: true } },
        },
      });
      if (
        !current?.fileVersions[0] ||
        current.organizerId !== game.organizerId ||
        current.turnState?.activePlayerId !== activePlayer.id ||
        !isApprovalBound(
          binding,
          approvalBinding(current, current.fileVersions[0]),
        )
      )
        throw conflict();
      if (
        !(await this.canManagePasswords(
          game.organizerId,
          userId,
          shadowOverrideEnabled,
        ))
      )
        throw new ForbiddenException('Password reset permission was lost.');
      if (
        await tx.passwordResetApproval.findFirst({
          where: { gameId: game.id, state: 'OPEN' },
        })
      )
        throw new ConflictException(
          'A password reset approval is already open. Withdraw it before approving another.',
        );
      const approverRole = actorRole(game.organizerId, userId);
      const approver = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { identities: true },
      });
      const approval = await tx.passwordResetApproval.create({
        data: {
          gameId: game.id,
          ...binding,
          sourceId,
          regimeId: regime.id,
          regimeName: regime.name,
          gamePlayerId: activeSeatId,
          playerId: activePlayer.id,
          approverId: userId,
          approverRole,
          reason,
        },
      });
      await this.botNotifications.enqueuePasswordResetApproved(tx, {
        game: {
          id: game.id,
          gameNumber: game.gameNumber,
          slug: game.slug,
          name: game.name,
          discordThreadId: game.discordThreadId,
        },
        player: notifiedUser(activePlayer),
        approval: {
          regimeName: regime.name,
          grantedAt: approval.createdAt.toISOString(),
          approver: notifiedUser(approver),
          approverRole,
        },
      });
      return { approvalId: approval.id, regimeName: regime.name };
    });
  }

  constructor(
    private readonly authService: AuthService,
    private readonly fileStorage: FileStorageService,
    private readonly botNotifications: BotNotificationsService,
  ) {}

  async inspectLatestSave(
    gameId: string,
    userId: string | undefined,
    shadowOverrideEnabled = false,
  ) {
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
          select: { id: true, storagePath: true, contentRevision: true },
        },
      },
    });
    if (!game) throw new NotFoundException('Campaign not found.');
    if (
      !(await this.canManagePasswords(
        game.organizerId,
        userId,
        shadowOverrideEnabled,
      ))
    )
      throw new ForbiddenException(
        'Only the current Overlord or an enabled Shadow Override can inspect regimes.',
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
          select: { id: true, storagePath: true, contentRevision: true },
        },
      },
    });
    if (
      !current ||
      !(await this.canManagePasswords(
        current.organizerId,
        userId,
        shadowOverrideEnabled,
      ))
    )
      throw new ForbiddenException(
        'Only the current Overlord or an enabled Shadow Override can inspect regimes.',
      );
    if (
      current.fileVersions[0]?.id !== file.id ||
      current.fileVersions[0]?.storagePath !== file.storagePath ||
      current.fileVersions[0]?.contentRevision !== file.contentRevision
    )
      throw new ConflictException('The latest save changed. Inspect it again.');
    return {
      fileVersionId: file.id,
      contentRevision: file.contentRevision,
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
        turnState: activePlayerSelect,
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

    const contentHash = `sha256:${createHash('sha256').update(file.buffer).digest('hex')}`;
    return this.publish(
      {
        gameId: game.id,
        canonicalName: fileVersion.originalName,
        content: file.buffer,
      },
      async (transaction, stagedFile, replacedAt) => {
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
          activePlayer: activePlayerOf(game.turnState),
          replacement: {
            contentRevision: fileVersion.contentRevision + 1,
            versionId: fileVersion.id,
            versionNumber: fileVersion.versionNumber,
            originalName: fileVersion.originalName,
            replacedAt: replacedAt.toISOString(),
            replacedBy: notifiedUser(actor),
          },
        });
        return {
          fileVersionId: fileVersion.id,
          versionNumber: fileVersion.versionNumber,
          originalName: fileVersion.originalName,
          replacedAt: replacedAt.toISOString(),
          replacedByDisplayName: actor.displayName,
          contentRevision: fileVersion.contentRevision + 1,
        };
      },
    );
  }
}
