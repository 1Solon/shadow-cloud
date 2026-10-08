import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditEventType,
  TurnCompletionReason,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { buildGameIdentifierWhere } from '../../support/game-lookup.helpers';
import { assertSaveBaseline } from '../../support/save-baseline';
import { cleanupSaveRecovery } from '../../support/save-recovery';
import { resolveActivePlayerEntry } from '../../support/turn-state.utils';
import { assertCampaignInPlay } from '../../support/campaign-conclusion';
import type { TurnRecordsService } from '../turn-records.service';
import type { TurnMutationDependencies } from './dependencies';

export type RejectSaveInput = {
  fileVersionId: string;
  gameId?: string;
  expectedSaveBaseline?: string;
  shadowOverrideEnabled?: boolean;
};

const gameInclude = {
  players: {
    include: { user: { include: { identities: true } } },
    orderBy: { turnOrder: 'asc' },
  },
  turnState: true,
} satisfies Prisma.GameInclude;

function discordIdOf(user: {
  identities: Array<{ provider: string; providerId: string }>;
}) {
  return (
    user.identities.find((identity) => identity.provider === 'discord')
      ?.providerId ?? null
  );
}

async function loadRejection(
  database: Prisma.TransactionClient,
  input: RejectSaveInput,
) {
  const file = await database.fileVersion.findUnique({
    where: { id: input.fileVersionId },
  });
  if (!file) {
    const rejected = await database.rejectedSave.findUnique({
      where: { id: input.fileVersionId },
    });
    if (rejected) {
      throw new ConflictException(
        `Save #${rejected.versionNumber} was already rejected.`,
      );
    }
    throw new NotFoundException(
      `Save file ${input.fileVersionId} was not found.`,
    );
  }
  const game = await database.game.findFirst({
    where: {
      id: file.gameId,
      ...(input.gameId ? buildGameIdentifierWhere(input.gameId) : {}),
    },
    include: gameInclude,
  });
  if (!game) {
    throw new NotFoundException(
      `Save file ${input.fileVersionId} was not found for game ${input.gameId}.`,
    );
  }
  const [latest, openTurn, uploaderTurn] = await Promise.all([
    database.fileVersion.findFirst({
      where: { gameId: game.id },
      orderBy: { versionNumber: 'desc' },
      select: { id: true },
    }),
    database.turnRecord.findFirst({
      where: { gameId: game.id, endedAt: null },
    }),
    database.turnRecord.findFirst({
      where: {
        gameId: game.id,
        userId: file.uploadedById,
        endedAt: file.uploadedAt,
        completionReason: TurnCompletionReason.SAVE_UPLOADED,
      },
    }),
  ]);
  return { file, game, latest, openTurn, uploaderTurn };
}

function validateRejection(
  {
    file,
    game,
    latest,
    openTurn,
    uploaderTurn,
  }: Awaited<ReturnType<typeof loadRejection>>,
  userId: string,
  hasShadowOverride: boolean,
) {
  const active = game.turnState
    ? resolveActivePlayerEntry(game.players, game.turnState)
    : null;
  if (
    active?.userId !== userId &&
    file.uploadedById !== userId &&
    game.organizerId !== userId &&
    !hasShadowOverride
  ) {
    throw new ForbiddenException(
      'Only the player who received this save, its uploader, or the Overlord can reject it.',
    );
  }
  if (latest?.id !== file.id) {
    throw new ConflictException('Only the latest save can be rejected.');
  }
  const uploaderSeat = game.players.find(
    (seat) => seat.id === uploaderTurn?.gamePlayerId,
  );
  if (
    file.turnRevision !== game.turnRevision ||
    !game.turnState ||
    !active?.userId ||
    !openTurn ||
    openTurn.gamePlayerId !== active.id ||
    openTurn.startedAt.getTime() !== file.uploadedAt.getTime() ||
    !uploaderTurn ||
    uploaderSeat?.userId !== file.uploadedById ||
    !uploaderSeat.user
  ) {
    throw new ConflictException(
      'This save can no longer be rejected because the campaign has moved on since it was uploaded.',
    );
  }
  return {
    active: { ...active, userId: active.userId },
    turnState: game.turnState,
    uploaderSeat: { ...uploaderSeat, user: uploaderSeat.user },
    uploaderTurn,
  };
}

export async function rejectSave(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  userId: string | undefined,
  input: RejectSaveInput,
) {
  if (!userId) {
    throw new UnauthorizedException(
      'Authenticated user id is missing from the token.',
    );
  }
  const hasShadowOverride =
    input.shadowOverrideEnabled === true &&
    (await dependencies.authService?.isUserShadowOverride(userId)) === true;
  const observed = await loadRejection(database, input);
  validateRejection(observed, userId, hasShadowOverride);
  assertSaveBaseline(observed.game, input.expectedSaveBaseline);

  const result = await database.$transaction(async (transaction) => {
    const fenced = await transaction.game.updateMany({
      where: {
        id: observed.game.id,
        turnRevision: observed.game.turnRevision,
        saveRevision: observed.game.saveRevision,
      },
      data: {
        turnRevision: { increment: 1 },
        saveRevision: { increment: 1 },
      },
    });
    if (fenced.count !== 1) {
      throw new ConflictException(
        'The campaign or save changed. Refresh and review the latest save before trying again.',
      );
    }
    await assertCampaignInPlay(transaction, observed.game.id);
    const current = await loadRejection(transaction, input);
    const { active, turnState, uploaderSeat, uploaderTurn } = validateRejection(
      {
        ...current,
        game: { ...current.game, turnRevision: observed.game.turnRevision },
      },
      userId,
      hasShadowOverride,
    );
    const actor = await transaction.user.findUnique({
      where: { id: userId },
      include: { identities: true },
    });
    if (!actor) {
      throw new ForbiddenException('The authenticated user no longer exists.');
    }
    const { file, game } = current;
    const rejectedAt = new Date();
    await turnRecords.returnTurn(transaction, {
      gameId: game.id,
      expectedCurrent: {
        gamePlayerId: active.id,
        userId: active.userId,
        roundNumber: turnState.roundNumber,
      },
      previousTurnId: uploaderTurn.id,
      returnedAt: rejectedAt,
    });
    await transaction.turnState.update({
      where: { gameId: game.id },
      data: {
        activePlayerId: uploaderSeat.user.id,
        activePlayerEntryId: uploaderSeat.id,
        roundNumber: uploaderTurn.roundNumber,
      },
    });
    await transaction.rejectedSave.create({
      data: {
        id: file.id,
        gameId: game.id,
        versionNumber: file.versionNumber,
        originalName: file.originalName,
        contentHash: file.contentHash,
        uploadedById: file.uploadedById,
        uploadedAt: file.uploadedAt,
        rejectedById: actor.id,
        rejectedAt,
      },
    });
    await transaction.fileVersion.delete({ where: { id: file.id } });
    await transaction.saveCleanup.upsert({
      where: { storagePath: file.storagePath },
      create: { storagePath: file.storagePath },
      update: { dueAt: rejectedAt },
    });
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: actor.id,
        eventType: AuditEventType.SAVE_REJECTED,
        payload: JSON.stringify({
          fileVersionId: file.id,
          versionNumber: file.versionNumber,
          originalName: file.originalName,
          storagePath: file.storagePath,
          contentHash: file.contentHash,
          idempotencyKey: file.idempotencyKey,
          receivingPlayerEntryId: active.id,
          receivingPlayerUserId: active.userId,
          uploaderPlayerEntryId: uploaderSeat.id,
          uploaderUserId: uploaderSeat.user.id,
          previousRoundNumber: turnState.roundNumber,
          roundNumber: uploaderTurn.roundNumber,
        }),
      },
    });
    await dependencies.botNotifications?.enqueueSaveRejected?.(transaction, {
      game: {
        id: game.id,
        gameNumber: game.gameNumber,
        slug: game.slug,
        name: game.name,
        discordThreadId: game.discordThreadId,
      },
      rejection: {
        versionNumber: file.versionNumber,
        originalName: file.originalName,
        rejectedAt: rejectedAt.toISOString(),
        rejectedBy: {
          id: actor.id,
          displayName: actor.displayName,
          discordId: discordIdOf(actor),
        },
      },
      turn: {
        roundNumber: uploaderTurn.roundNumber,
        activePlayer: {
          id: uploaderSeat.user.id,
          displayName: uploaderSeat.user.displayName,
          discordId: discordIdOf(uploaderSeat.user),
          turnOrder: uploaderSeat.turnOrder,
        },
      },
    });
    return { file, game, uploaderSeat, roundNumber: uploaderTurn.roundNumber };
  });

  if (dependencies.fileStorage) {
    await cleanupSaveRecovery(database, dependencies.fileStorage).catch(
      (error: unknown) => {
        new Logger('TurnMutationsService').warn(
          `Save ${result.file.id} was rejected but its file cleanup will be retried.`,
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
  }

  return {
    fileVersionId: result.file.id,
    versionNumber: result.file.versionNumber,
    gameNumber: result.game.gameNumber,
    name: result.game.name,
    roundNumber: result.roundNumber,
    activePlayer: {
      id: result.uploaderSeat.id,
      userId: result.uploaderSeat.user.id,
      displayName: result.uploaderSeat.user.displayName,
      turnOrder: result.uploaderSeat.turnOrder,
    },
  };
}
