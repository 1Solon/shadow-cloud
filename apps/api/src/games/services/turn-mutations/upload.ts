import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AuditEventType,
  GameRole,
  TurnCompletionReason,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { buildGameIdentifierWhere } from '../../support/game-lookup.helpers';
import { assertSaveBaseline } from '../../support/save-baseline';
import { saveStagingLease } from '../../support/save-recovery';
import type {
  UploadedSaveFile,
  UploadSaveSafetyMetadata,
} from '../../support/game-payload.types';
import type { TurnRecordsService } from '../turn-records.service';
import type { TurnMutationDependencies } from './dependencies';

const include = {
  players: {
    include: { user: { include: { identities: true } } },
    orderBy: { turnOrder: 'asc' },
  },
  turnState: true,
} satisfies Prisma.GameInclude;
type UploadGame = Prisma.GameGetPayload<{ include: typeof include }>;

async function findReplay(
  database: Prisma.TransactionClient,
  game: UploadGame,
  userId: string,
  idempotencyKey?: string,
) {
  if (!idempotencyKey) return null;
  const existing = await database.fileVersion.findFirst({
    where: { gameId: game.id, uploadedById: userId, idempotencyKey },
  });
  if (!existing) return null;
  return {
    fileVersionId: existing.id,
    versionNumber: existing.versionNumber,
    originalName: existing.originalName,
    roundNumber: game.turnState?.roundNumber ?? 1,
    roundAdvanced: false,
    activePlayer: null,
    idempotentReplay: true,
  };
}

class UploadReplay extends Error {
  constructor(
    readonly result: NonNullable<Awaited<ReturnType<typeof findReplay>>>,
  ) {
    super('Upload already committed.');
  }
}

function participants(
  game: UploadGame,
  userId: string,
  revalidating = false,
  identifier = game.id,
) {
  if (
    game.organizerId !== userId &&
    !game.players.some((seat) => seat.userId === userId)
  ) {
    throw new ForbiddenException(
      `You do not have access to game ${identifier}.`,
    );
  }
  const InvalidParticipant = revalidating
    ? ConflictException
    : NotFoundException;
  const turnState = game.turnState;
  if (!turnState) {
    throw new InvalidParticipant(
      `Game ${identifier} does not have an active turn state yet.`,
    );
  }
  const occupied = game.players.filter((seat) => seat.userId != null);
  const matches = occupied.filter((seat) =>
    turnState.activePlayerEntryId != null
      ? seat.id === turnState.activePlayerEntryId
      : seat.userId === turnState.activePlayerId,
  );
  const active = matches.length === 1 ? matches[0] : null;
  if (!active || active.userId !== turnState.activePlayerId) {
    throw new InvalidParticipant(
      `Game ${identifier} does not have a resolvable active player entry.`,
    );
  }
  if (active.userId !== userId) {
    throw new ForbiddenException(
      'Only the active player can upload the current save.',
    );
  }
  const index = occupied.findIndex((seat) => seat.id === active.id);
  const next = occupied[(index + 1) % occupied.length];
  if (!next.user?.displayName) {
    throw new ConflictException('The next player is missing a display name.');
  }
  return {
    active,
    next,
    turnState,
    roundAdvanced: index === occupied.length - 1,
  };
}

function checkExpectations(
  current: ReturnType<typeof participants>,
  latestId: string | null,
  metadata: UploadSaveSafetyMetadata,
) {
  if (
    (metadata.expectedActivePlayerEntryId != null &&
      metadata.expectedActivePlayerEntryId !== current.active.id) ||
    (metadata.expectedActivePlayerUserId != null &&
      metadata.expectedActivePlayerUserId !== current.active.userId) ||
    (metadata.expectedRoundNumber != null &&
      metadata.expectedRoundNumber !== current.turnState.roundNumber)
  )
    throw new ConflictException('The turn changed before this upload.');
  if (
    metadata.expectedLatestFileVersionId !== undefined &&
    metadata.expectedLatestFileVersionId !== latestId
  ) {
    throw new ConflictException(
      'A newer save was uploaded before this upload.',
    );
  }
}

export async function uploadSave(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  gameId: string,
  userId: string | undefined,
  file: UploadedSaveFile,
  metadata: UploadSaveSafetyMetadata = {},
) {
  if (!userId) {
    throw new UnauthorizedException(
      'Authenticated user id is missing from the token.',
    );
  }
  const observed = await database.game.findFirst({
    where: buildGameIdentifierWhere(gameId),
    include,
  });
  if (!observed) throw new NotFoundException(`Game ${gameId} was not found.`);
  const replay = await findReplay(
    database,
    observed,
    userId,
    metadata.idempotencyKey,
  );
  if (replay) return replay;
  const expected = participants(observed, userId, false, gameId);
  assertSaveBaseline(observed, metadata.expectedSaveBaseline);
  const observedLatest = await database.fileVersion.findFirst({
    where: { gameId: observed.id },
    orderBy: { versionNumber: 'desc' },
  });
  checkExpectations(expected, observedLatest?.id ?? null, metadata);
  const fileStorage = dependencies.fileStorage;
  if (!fileStorage) throw new Error('Upload file storage is not configured.');
  const lease = saveStagingLease(database, fileStorage);
  let result;
  try {
    const stored = await fileStorage.stageUpload({
      gameId: observed.id,
      gameNumber: observed.gameNumber,
      turn: expected.turnState.roundNumber + (expected.roundAdvanced ? 1 : 0),
      seat: expected.next.turnOrder,
      playerName: expected.next.user!.displayName,
      originalName: file.originalname,
      content: file.buffer,
      prepare: lease.prepare,
    });

    result = await database.$transaction(async (transaction) => {
      // The first write reserves the revision and acquires SQLite's write lock.
      // Every proof below is protected until commit; never retry changed intent.
      const fenced = await transaction.game.updateMany({
        where: {
          id: observed.id,
          turnRevision: observed.turnRevision,
          saveRevision: observed.saveRevision,
        },
        data: {
          turnRevision: { increment: 1 },
          saveRevision: { increment: 1 },
        },
      });
      const game = await transaction.game.findUnique({
        where: { id: observed.id },
        include,
      });
      if (!game)
        throw new ConflictException(
          'The campaign or save changed. Refresh and review the latest save before uploading again.',
        );
      const replay = await findReplay(
        transaction,
        game,
        userId,
        metadata.idempotencyKey,
      );
      // Roll back even a successful reservation on replay, including updatedAt.
      if (replay) throw new UploadReplay(replay);
      const { active, next, turnState, roundAdvanced } = participants(
        game,
        userId,
        true,
      );
      if (fenced.count !== 1)
        throw new ConflictException(
          'The campaign or save changed. Refresh and review the latest save before uploading again.',
        );
      const latest = await transaction.fileVersion.findFirst({
        where: { gameId: game.id },
        orderBy: { versionNumber: 'desc' },
      });
      checkExpectations(
        { active, next, turnState, roundAdvanced },
        latest?.id ?? null,
        metadata,
      );
      if (
        turnState.activePlayerEntryId !==
          expected.turnState.activePlayerEntryId ||
        turnState.activePlayerId !== expected.turnState.activePlayerId ||
        turnState.roundNumber !== expected.turnState.roundNumber ||
        active.id !== expected.active.id ||
        active.userId !== expected.active.userId ||
        active.turnOrder !== expected.active.turnOrder ||
        next.id !== expected.next.id ||
        next.userId !== expected.next.userId ||
        next.turnOrder !== expected.next.turnOrder ||
        next.user!.displayName !== expected.next.user!.displayName ||
        game.gameNumber !== observed.gameNumber ||
        roundAdvanced !== expected.roundAdvanced
      )
        throw new ConflictException(
          'The active turn or next player changed before this upload.',
        );
      if ((latest?.id ?? null) !== (observedLatest?.id ?? null)) {
        throw new ConflictException(
          'A newer save was uploaded before this upload.',
        );
      }
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      const roundNumber = turnState.roundNumber + (roundAdvanced ? 1 : 0);
      const transitionedAt = new Date();
      const fileVersion = await transaction.fileVersion.create({
        data: {
          gameId: game.id,
          uploadedById: userId,
          storagePath: stored.storagePath,
          originalName: stored.fileName,
          versionNumber,
          contentHash: `sha256:${createHash('sha256').update(file.buffer).digest('hex')}`,
          idempotencyKey: metadata.idempotencyKey,
          clientOriginalName: file.originalname,
          clientFileSize: file.size,
          uploadedAt: transitionedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: userId,
          eventType: AuditEventType.FILE_UPLOADED,
          payload: JSON.stringify({
            fileVersionId: fileVersion.id,
            versionNumber,
            originalName: stored.fileName,
            storagePath: stored.storagePath,
          }),
        },
      });
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: {
          activePlayerId: next.userId!,
          activePlayerEntryId: next.id,
          roundNumber,
        },
      });
      await turnRecords.transitionTurn(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: active.id,
          userId: active.userId!,
          roundNumber: turnState.roundNumber,
        },
        next: {
          gamePlayerId: next.id,
          userId: next.userId,
          seatNumber: next.turnOrder,
          playerDisplayName: next.user!.displayName,
          roundNumber,
        },
        completionReason: TurnCompletionReason.SAVE_UPLOADED,
        transitionedAt,
      });
      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: userId,
          eventType: AuditEventType.TURN_ADVANCED,
          payload: JSON.stringify({
            previousActivePlayerEntryId: active.id,
            previousActivePlayerUserId: active.userId,
            nextActivePlayerEntryId: next.id,
            nextActivePlayerUserId: next.userId,
            roundNumber,
            roundAdvanced,
            fileVersionId: fileVersion.id,
          }),
        },
      });
      await transaction.saveCleanup.delete({
        where: { storagePath: stored.storagePath },
      });
      return { game, active, next, fileVersion, roundNumber, roundAdvanced };
    });
  } catch (error) {
    await lease.discard();
    if (error instanceof UploadReplay) return error.result;
    throw error;
  }

  const { game, active, next, fileVersion, roundNumber, roundAdvanced } =
    result;
  const discordId = (user: NonNullable<typeof next.user>) =>
    user.identities.find((identity) => identity.provider === 'discord')
      ?.providerId ?? null;
  try {
    await dependencies.botNotifications?.notifySaveUploaded({
      game: {
        id: game.id,
        gameNumber: game.gameNumber,
        slug: game.slug,
        name: game.name,
        discordThreadId: game.discordThreadId,
      },
      upload: {
        versionId: fileVersion.id,
        versionNumber: fileVersion.versionNumber,
        originalName: fileVersion.originalName,
        uploadedAt: fileVersion.uploadedAt.toISOString(),
        uploadedBy: {
          id: active.userId!,
          displayName: active.user!.displayName,
          discordId: discordId(active.user!),
        },
      },
      turn: {
        roundNumber,
        roundAdvanced,
        activePlayer: {
          id: next.userId!,
          displayName: next.user!.displayName,
          discordId: discordId(next.user!),
          turnOrder: next.turnOrder,
        },
      },
      players: game.players
        .filter((seat) => seat.userId != null)
        .map((seat) => ({
          id: seat.userId!,
          displayName: seat.user!.displayName,
          discordId: discordId(seat.user!),
          turnOrder: seat.turnOrder,
        })),
    });
  } catch (error) {
    // The save and turn are committed. Delivery failure must not invite a retry
    // as though the upload failed, or enter the uncommitted-file cleanup path.
    new Logger('TurnMutationsService').error(
      `Save ${fileVersion.id} committed but upload notification failed.`,
      error instanceof Error ? error.stack : String(error),
    );
  }
  return {
    fileVersionId: fileVersion.id,
    versionNumber: fileVersion.versionNumber,
    originalName: fileVersion.originalName,
    roundNumber,
    roundAdvanced,
    activePlayer: {
      id: next.id,
      userId: next.userId!,
      displayName: next.user!.displayName,
      turnOrder: next.turnOrder,
      isOrganizer:
        next.role === GameRole.ORGANIZER || game.organizerId === next.userId,
    },
  };
}
