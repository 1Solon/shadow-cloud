import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditEventType,
  GameRole,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { TransferHostDto } from '../../dto/transfer-host.dto';
import type { UpdateGameMetadataDto } from '../../dto/update-game-metadata.dto';
import {
  buildCanonicalThreadName,
  mapArmyCount,
  mapDlcMode,
  mapGameMode,
  mapZoneCount,
  normalizeGameNameInput,
  normalizeNotesInput,
} from '../../support/game-configuration.helpers';
import { buildGameIdentifierWhere } from '../../support/game-lookup.helpers';
import type { TurnRecordsService } from '../turn-records.service';
import type { TurnMutationDependencies } from './dependencies';

const administrationInclude = {
  players: { include: { user: true }, orderBy: { turnOrder: 'asc' } },
  turnState: true,
} satisfies Prisma.GameInclude;

type AdministrationGame = Prisma.GameGetPayload<{
  include: typeof administrationInclude;
}>;

function rosterProof(game: AdministrationGame) {
  return JSON.stringify({
    organizerId: game.organizerId,
    playerCount: game.playerCount,
    players: game.players.map(({ id, userId, role, turnOrder }) => ({
      id,
      userId,
      role,
      turnOrder,
    })),
    turnState: game.turnState && {
      activePlayerId: game.turnState.activePlayerId,
      activePlayerEntryId: game.turnState.activePlayerEntryId,
      roundNumber: game.turnState.roundNumber,
    },
  });
}

async function findGame(database: Prisma.TransactionClient, gameId: string) {
  const game = await database.game.findFirst({
    where: buildGameIdentifierWhere(gameId),
    include: administrationInclude,
  });
  if (!game) throw new NotFoundException(`Game ${gameId} was not found.`);
  return game;
}

export async function transferHost(
  database: PrismaClient,
  records: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  gameId: string,
  userId: string | undefined,
  input: TransferHostDto,
) {
  if (!userId)
    throw new UnauthorizedException(
      'Authenticated user id is missing from the token.',
    );
  const observed = await findGame(database, gameId);
  const shadowOverride =
    observed.organizerId !== userId &&
    (await dependencies.authService?.isUserShadowOverride(userId));
  const authorize = (game: AdministrationGame) => {
    if (game.organizerId !== userId && !shadowOverride) {
      throw new ForbiddenException(
        'Only the game organizer can transfer host control.',
      );
    }
  };
  authorize(observed);

  return database.$transaction(async (transaction) => {
    // First-write fencing takes SQLite's writer lock before proving local facts.
    // No retry: a newer revision represents a different administration intent.
    const fenced = await transaction.game.updateMany({
      where: { id: observed.id, turnRevision: observed.turnRevision },
      data: { turnRevision: { increment: 1 } },
    });
    const game = await findGame(transaction, observed.id);
    authorize(game);
    if (fenced.count !== 1 || rosterProof(game) !== rosterProof(observed)) {
      throw new ConflictException(
        'The campaign roster or active turn changed before updating it.',
      );
    }
    await records.assertCurrentTurn(transaction, game.id);
    const target = game.players.find(
      (seat) => seat.id === input.targetPlayerEntryId,
    );
    if (!target?.userId || !target.user) {
      throw new NotFoundException(
        'The selected host transfer target is not an active player in this game.',
      );
    }
    if (target.userId === game.organizerId) {
      throw new BadRequestException(
        'Select a different player to transfer host control.',
      );
    }
    const previous = game.players.find(
      (seat) => seat.userId === game.organizerId,
    );
    await transaction.gamePlayer.updateMany({
      where: {
        gameId: game.id,
        id: { not: target.id },
        role: GameRole.ORGANIZER,
      },
      data: { role: GameRole.PLAYER },
    });
    await transaction.game.update({
      where: { id: game.id },
      data: { organizerId: target.userId },
    });
    await transaction.gamePlayer.update({
      where: { id: target.id },
      data: { role: GameRole.ORGANIZER },
    });
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: userId,
        eventType: AuditEventType.ROSTER_UPDATED,
        payload: JSON.stringify({
          action: 'host_transferred',
          previousOrganizerEntryId: previous?.id ?? null,
          previousOrganizerDisplayName: previous?.user?.displayName ?? null,
          nextOrganizerEntryId: target.id,
          nextOrganizerDisplayName: target.user.displayName,
        }),
      },
    });
    return {
      gameId: game.id,
      gameNumber: game.gameNumber,
      slug: game.slug,
      name: game.name,
      organizerId: target.userId,
      organizerDisplayName: target.user.displayName,
      player: {
        displayName: target.user.displayName,
        turnOrder: target.turnOrder,
      },
    };
  });
}

export async function updateGameMetadata(
  database: PrismaClient,
  records: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  gameId: string,
  userId: string | undefined,
  input: UpdateGameMetadataDto,
) {
  if (!userId)
    throw new UnauthorizedException(
      'Authenticated user id is missing from the token.',
    );
  const observed = await findGame(database, gameId);
  const shadowOverride =
    observed.organizerId !== userId &&
    (await dependencies.authService?.isUserShadowOverride(userId));
  const authorize = (game: AdministrationGame) => {
    if (game.organizerId !== userId && !shadowOverride) {
      throw new ForbiddenException(
        'Only the game organizer can edit game metadata.',
      );
    }
  };
  authorize(observed);

  const committed = await database.$transaction(async (transaction) => {
    // Lock without advancing revision: excluded edits and effective no-ops must
    // not stale a Seat Order draft. Advance only after computing actual changes.
    const fenced = await transaction.game.updateMany({
      where: { id: observed.id, turnRevision: observed.turnRevision },
      data: { turnRevision: { increment: 0 } },
    });
    const game = await findGame(transaction, observed.id);
    authorize(game);
    if (fenced.count !== 1 || rosterProof(game) !== rosterProof(observed)) {
      throw new ConflictException(
        'The campaign roster or active turn changed before updating it.',
      );
    }
    await records.assertCurrentTurn(transaction, game.id);
    const previousMetadata = {
      gameNumber: game.gameNumber,
      name: game.name,
      roundNumber: game.turnState?.roundNumber ?? 1,
      playerCount: game.playerCount,
      hasAiPlayers: game.hasAiPlayers,
      dlcMode: game.dlcMode,
      gameMode: game.gameMode,
      techLevel: game.techLevel,
      zoneCount: game.zoneCount,
      armyCount: game.armyCount,
      notes: game.notes,
      turnTargetHours: game.turnTargetHours,
      turnReminderGraceHours: game.turnReminderGraceHours,
      turnReminderRepeatHours: game.turnReminderRepeatHours,
      turnRemindersEnabled: game.turnRemindersEnabled,
    };
    const name =
      input.name === undefined ? game.name : normalizeGameNameInput(input.name);
    if (name == null)
      throw new BadRequestException('Game name cannot be empty.');
    const nextMetadata = {
      gameNumber: input.gameNumber ?? game.gameNumber,
      name,
      roundNumber: input.roundNumber ?? previousMetadata.roundNumber,
      playerCount: input.playerCount ?? game.playerCount,
      hasAiPlayers: input.hasAiPlayers ?? game.hasAiPlayers,
      dlcMode: input.dlcMode == null ? game.dlcMode : mapDlcMode(input.dlcMode),
      gameMode:
        input.gameMode == null ? game.gameMode : mapGameMode(input.gameMode),
      techLevel: input.techLevel ?? game.techLevel,
      zoneCount:
        input.zoneCount == null
          ? game.zoneCount
          : mapZoneCount(input.zoneCount),
      armyCount:
        input.armyCount == null
          ? game.armyCount
          : mapArmyCount(input.armyCount),
      notes:
        input.notes === undefined
          ? game.notes
          : normalizeNotesInput(input.notes),
      turnTargetHours: input.turnTargetHours ?? game.turnTargetHours,
      turnReminderGraceHours:
        input.turnReminderGraceHours ?? game.turnReminderGraceHours,
      turnReminderRepeatHours:
        input.turnReminderRepeatHours ?? game.turnReminderRepeatHours,
      turnRemindersEnabled:
        input.turnRemindersEnabled ?? game.turnRemindersEnabled,
    };
    if (nextMetadata.gameNumber !== game.gameNumber) {
      const existing = await transaction.game.findUnique({
        where: { gameNumber: nextMetadata.gameNumber },
      });
      if (existing && existing.id !== game.id) {
        throw new ConflictException(
          `Game number ${nextMetadata.gameNumber} is already in use.`,
        );
      }
    }
    let seatsChanged = false;
    if (input.playerCount != null) {
      const occupiedCount = game.players.filter(
        (seat) => seat.userId != null,
      ).length;
      if (input.playerCount < occupiedCount) {
        throw new BadRequestException(
          `Seat limit cannot be lower than the ${occupiedCount} occupied seats in this game.`,
        );
      }
      const extraCount = game.players.length - input.playerCount;
      seatsChanged = extraCount !== 0;
      if (extraCount > 0) {
        const removable = game.players
          .filter((seat) => seat.userId == null)
          .reverse()
          .slice(0, extraCount);
        await transaction.gamePlayer.deleteMany({
          where: {
            gameId: game.id,
            id: { in: removable.map((seat) => seat.id) },
          },
        });
      } else if (extraCount < 0) {
        // Fill gaps left by removed open seats without renumbering occupants
        // or allocating beyond the requested cap.
        const usedOrders = new Set(game.players.map((seat) => seat.turnOrder));
        const freeOrders = Array.from(
          { length: input.playerCount },
          (_, index) => index + 1,
        )
          .filter((order) => !usedOrders.has(order))
          .slice(0, -extraCount);
        await transaction.gamePlayer.createMany({
          data: freeOrders.map((turnOrder) => ({
            gameId: game.id,
            turnOrder,
            role: GameRole.PLAYER,
          })),
        });
      }
    }
    const { roundNumber, ...gameData } = nextMetadata;
    const roundChanged = roundNumber !== previousMetadata.roundNumber;
    if (roundChanged) {
      if (!game.turnState)
        throw new ConflictException(
          'The game does not have an active turn state.',
        );
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: { roundNumber: nextMetadata.roundNumber },
      });
      await records.synchronizeOpenRound(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: game.turnState.activePlayerEntryId,
          userId: game.turnState.activePlayerId,
        },
        roundNumber: nextMetadata.roundNumber,
      });
    }
    const policyChanged =
      nextMetadata.turnTargetHours !== game.turnTargetHours ||
      nextMetadata.turnReminderGraceHours !== game.turnReminderGraceHours ||
      nextMetadata.turnReminderRepeatHours !== game.turnReminderRepeatHours ||
      nextMetadata.turnRemindersEnabled !== game.turnRemindersEnabled;
    await transaction.game.update({
      where: { id: game.id },
      data: {
        ...gameData,
        ...(seatsChanged || roundChanged
          ? { turnRevision: { increment: 1 } }
          : {}),
      },
    });
    if (policyChanged) {
      const open = await records.recalculateOpenReminder(transaction, {
        gameId: game.id,
      });
      await transaction.notificationDelivery.updateMany({
        where: {
          turnRecordId: open.id,
          event: 'TURN_NUDGE',
          status: 'PENDING',
        },
        data: { status: 'CANCELLED', processingStartedAt: null },
      });
    }
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: userId,
        eventType: AuditEventType.METADATA_UPDATED,
        payload: JSON.stringify({ previousMetadata, nextMetadata }),
      },
    });
    return { game, metadata: nextMetadata };
  });
  if (committed.game.discordThreadId) {
    await dependencies.botNotifications?.notifyThreadRenamed({
      game: {
        id: committed.game.id,
        slug: committed.game.slug,
        name: committed.metadata.name,
        discordThreadId: committed.game.discordThreadId,
        threadName: buildCanonicalThreadName(committed.metadata),
      },
    });
  }
  return {
    id: committed.game.id,
    slug: committed.game.slug,
    ...committed.metadata,
  };
}
