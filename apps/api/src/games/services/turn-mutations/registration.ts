import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  GameRole,
  RegistrationRequestStatus,
  type PrismaClient,
} from '@prisma/client';
import type { CreateDiscordGameDto } from '../../dto/create-discord-game.dto';
import {
  buildCanonicalThreadName,
  mapOptionalArmyCount,
  mapOptionalDlcMode,
  mapOptionalGameMode,
  mapOptionalZoneCount,
  slugify,
} from '../../support/game-configuration.helpers';
import {
  getDiscordIdentity,
  upsertDiscordUser,
} from '../../support/discord-user.helpers';
import { syncGameSeatCount } from '../../support/seat-count.helpers';
import type { TurnRecordsService } from '../turn-records.service';
import type { TurnMutationDependencies } from './dependencies';

export async function createGameFromDiscordInit(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  input: CreateDiscordGameDto,
) {
  const { game, organizer } = await database.$transaction(
    async (transaction) => {
      // Even with no matching campaign, this first write reserves SQLite's writer
      // lock before resolving unique names or identities. Failed intents roll back.
      await transaction.game.updateMany({
        where: { discordThreadId: input.discordThreadId },
        data: { turnRevision: { increment: 0 } },
      });
      const existingThread = await transaction.game.findUnique({
        where: { discordThreadId: input.discordThreadId },
      });
      if (existingThread) {
        throw new ConflictException(
          `Thread ${input.discordThreadId} is already linked to game ${existingThread.slug}.`,
        );
      }
      if (input.gameNumber != null) {
        const existingNumber = await transaction.game.findUnique({
          where: { gameNumber: input.gameNumber },
        });
        if (existingNumber) {
          throw new ConflictException(
            `Game number ${input.gameNumber} is already in use.`,
          );
        }
      }
      const baseSlug =
        slugify(input.slug?.trim() || input.name) ||
        `game-${input.discordThreadId}`;
      let resolvedSlug = baseSlug;
      let suffix = 2;
      while (
        await transaction.game.findUnique({ where: { slug: resolvedSlug } })
      ) {
        resolvedSlug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }
      const organizer = await upsertDiscordUser(transaction, {
        discordId: input.organizerDiscordId,
        displayName: input.organizerDisplayName,
      });
      const game = await transaction.game.create({
        data: {
          gameNumber: input.gameNumber,
          name: input.name,
          slug: resolvedSlug,
          playerCount: input.playerCount,
          hasAiPlayers: input.hasAiPlayers,
          dlcMode: mapOptionalDlcMode(input.dlcMode),
          gameMode: mapOptionalGameMode(input.gameMode),
          techLevel: input.techLevel,
          zoneCount: mapOptionalZoneCount(input.zoneCount),
          armyCount: mapOptionalArmyCount(input.armyCount),
          discordGuildId: input.discordGuildId,
          discordChannelId: input.discordChannelId,
          discordThreadId: input.discordThreadId,
          organizerId: organizer.id,
          turnTargetHours: input.turnTargetHours ?? 24,
          turnReminderGraceHours: input.turnReminderGraceHours ?? 12,
          turnReminderRepeatHours: input.turnReminderRepeatHours ?? 24,
          turnRemindersEnabled: true,
        },
      });
      const organizerEntry = await transaction.gamePlayer.create({
        data: {
          gameId: game.id,
          userId: organizer.id,
          turnOrder: 1,
          role: GameRole.ORGANIZER,
        },
      });
      await transaction.turnState.create({
        data: {
          gameId: game.id,
          activePlayerId: organizer.id,
          activePlayerEntryId: organizerEntry.id,
          roundNumber: 1,
        },
      });
      await turnRecords.createInitialTurn(transaction, {
        gameId: game.id,
        participant: {
          gamePlayerId: organizerEntry.id,
          userId: organizer.id,
          seatNumber: organizerEntry.turnOrder,
          playerDisplayName: organizer.displayName,
        },
        roundNumber: 1,
        startedAt: new Date(),
      });
      if (input.playerCount != null) {
        await syncGameSeatCount({
          transaction,
          gameId: game.id,
          players: [organizerEntry],
          targetPlayerCount: input.playerCount,
        });
      }
      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: organizer.id,
          eventType: AuditEventType.GAME_CREATED,
          payload: JSON.stringify({
            source: 'discord-init',
            gameNumber: input.gameNumber,
            playerCount: input.playerCount,
            hasAiPlayers: input.hasAiPlayers,
            dlcMode: input.dlcMode,
            gameMode: input.gameMode,
            techLevel: input.techLevel,
            zoneCount: input.zoneCount,
            armyCount: input.armyCount,
            organizerDiscordId: input.organizerDiscordId,
            organizerUsername: input.organizerUsername ?? null,
            discordThreadId: input.discordThreadId,
          }),
        },
      });
      return { game, organizer };
    },
  );

  const threadName = buildCanonicalThreadName({
    gameNumber: game.gameNumber,
    name: game.name,
    playerCount: input.playerCount ?? game.playerCount ?? null,
    gameMode: input.gameMode ?? game.gameMode ?? null,
    techLevel: input.techLevel ?? game.techLevel ?? null,
    zoneCount: input.zoneCount ?? game.zoneCount ?? null,
    armyCount: input.armyCount ?? game.armyCount ?? null,
  });
  await dependencies.botNotifications?.notifyGameInitialized({
    game: {
      id: game.id,
      slug: game.slug,
      name: game.name,
      threadName,
      gameNumber: game.gameNumber,
      discordThreadId: game.discordThreadId,
      playerCount: input.playerCount ?? game.playerCount ?? null,
      hasAiPlayers: input.hasAiPlayers ?? game.hasAiPlayers ?? null,
      dlcMode: input.dlcMode ?? game.dlcMode ?? null,
      gameMode: input.gameMode ?? game.gameMode ?? null,
      techLevel: input.techLevel ?? game.techLevel ?? null,
      zoneCount: input.zoneCount ?? game.zoneCount ?? null,
      armyCount: input.armyCount ?? game.armyCount ?? null,
    },
    organizer: {
      id: organizer.id,
      displayName: organizer.displayName,
      discordId: input.organizerDiscordId,
    },
  });
  return {
    id: game.id,
    gameNumber: game.gameNumber,
    slug: game.slug,
    name: game.name,
    organizerId: organizer.id,
    discordThreadId: game.discordThreadId,
  };
}

export async function rejectRegistrationRequest(
  database: PrismaClient,
  requestId: string,
  discordMessageId?: string,
  approverDiscordId?: string,
) {
  return database.$transaction(async (transaction) => {
    // Conditional consumption also acquires SQLite's writer lock. Authorization
    // and audit failure roll it back; an already-consumed request is never changed.
    const consumed = await transaction.registrationRequest.updateMany({
      where: { id: requestId, status: RegistrationRequestStatus.PENDING },
      data: {
        status: RegistrationRequestStatus.REJECTED,
        respondedAt: new Date(),
        ...(discordMessageId ? { discordMessageId } : {}),
      },
    });
    const request = await transaction.registrationRequest.findUnique({
      where: { id: requestId },
      include: {
        game: { include: { organizer: { include: { identities: true } } } },
      },
    });
    if (!request) {
      throw new NotFoundException(
        `Registration request ${requestId} was not found.`,
      );
    }
    if (consumed.count !== 1) {
      throw new ConflictException(
        `Registration request ${requestId} has already been ${request.status.toLowerCase()}.`,
      );
    }
    const organizerDiscordId = getDiscordIdentity(request.game.organizer);
    if (!approverDiscordId || approverDiscordId !== organizerDiscordId) {
      throw new ForbiddenException(
        'Only the game overlord can reject registration requests.',
      );
    }
    await transaction.auditEvent.create({
      data: {
        gameId: request.gameId,
        eventType: AuditEventType.REGISTRATION_REJECTED,
        payload: JSON.stringify({
          requestId,
          playerDiscordId: request.playerDiscordId,
          playerDisplayName: request.playerDisplayName,
        }),
      },
    });
    return {
      gameId: request.gameId,
      slug: request.game.slug,
      name: request.game.name,
      player: {
        displayName: request.playerDisplayName,
        discordId: request.playerDiscordId,
      },
    };
  });
}

export async function approveRegistrationRequest(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  requestId: string,
  discordMessageId?: string,
  approverDiscordId?: string,
) {
  return database.$transaction(async (transaction) => {
    // Reserve the campaign revision and SQLite writer lock before reading any
    // request or authorization facts. Rejection rolls back the reservation.
    await transaction.game.updateMany({
      where: { registrationRequests: { some: { id: requestId } } },
      data: { turnRevision: { increment: 1 } },
    });
    const request = await transaction.registrationRequest.findUnique({
      where: { id: requestId },
      include: {
        game: { include: { organizer: { include: { identities: true } } } },
      },
    });
    if (!request) {
      throw new NotFoundException(
        `Registration request ${requestId} was not found.`,
      );
    }
    if (request.status !== RegistrationRequestStatus.PENDING) {
      throw new ConflictException(
        `Registration request ${requestId} has already been ${request.status.toLowerCase()}.`,
      );
    }
    const organizerDiscordId = getDiscordIdentity(request.game.organizer);
    if (!approverDiscordId || approverDiscordId !== organizerDiscordId) {
      throw new ForbiddenException(
        'Only the game overlord can approve registration requests.',
      );
    }
    await turnRecords.assertCurrentTurn(transaction, request.gameId);
    const player = await upsertDiscordUser(transaction, {
      discordId: request.playerDiscordId,
      displayName: request.playerDisplayName,
    });
    const existingMembership = await transaction.gamePlayer.findFirst({
      where: { gameId: request.gameId, userId: player.id },
    });
    if (existingMembership) {
      throw new ConflictException('Player is already registered in this game.');
    }
    const availableSeat = await transaction.gamePlayer.findFirst({
      where: { gameId: request.gameId, userId: null },
      orderBy: { turnOrder: 'asc' },
    });
    const latestSeat = await transaction.gamePlayer.findFirst({
      where: { gameId: request.gameId },
      orderBy: { turnOrder: 'desc' },
    });
    if (request.game.playerCount != null) {
      const occupiedSeatCount = await transaction.gamePlayer.count({
        where: { gameId: request.gameId, userId: { not: null } },
      });
      if (
        occupiedSeatCount >= request.game.playerCount ||
        (!availableSeat &&
          (latestSeat?.turnOrder ?? 0) >= request.game.playerCount)
      ) {
        throw new ConflictException('This game is already at its seat limit.');
      }
    }
    const seat = availableSeat
      ? await transaction.gamePlayer.update({
          where: { id: availableSeat.id },
          data: { userId: player.id },
        })
      : await transaction.gamePlayer.create({
          data: {
            gameId: request.gameId,
            userId: player.id,
            turnOrder: (latestSeat?.turnOrder ?? 0) + 1,
            role: GameRole.PLAYER,
          },
        });
    await transaction.registrationRequest.update({
      where: { id: requestId },
      data: {
        status: RegistrationRequestStatus.APPROVED,
        respondedAt: new Date(),
        ...(discordMessageId ? { discordMessageId } : {}),
      },
    });
    await transaction.auditEvent.create({
      data: {
        gameId: request.gameId,
        actorId: player.id,
        eventType: AuditEventType.REGISTRATION_APPROVED,
        payload: JSON.stringify({
          requestId,
          playerDiscordId: request.playerDiscordId,
          playerUsername: request.playerUsername ?? null,
          playerEntryId: seat.id,
          turnOrder: seat.turnOrder,
        }),
      },
    });
    await transaction.auditEvent.create({
      data: {
        gameId: request.gameId,
        actorId: player.id,
        eventType: AuditEventType.ROSTER_UPDATED,
        payload: JSON.stringify({
          source: 'discord-register-approved',
          playerDiscordId: request.playerDiscordId,
          playerUsername: request.playerUsername ?? null,
          playerEntryId: seat.id,
          turnOrder: seat.turnOrder,
        }),
      },
    });
    return {
      gameId: request.gameId,
      gameNumber: request.game.gameNumber,
      slug: request.game.slug,
      name: request.game.name,
      player: {
        id: seat.id,
        userId: seat.userId,
        displayName: player.displayName,
        turnOrder: seat.turnOrder,
        discordId: request.playerDiscordId,
      },
    };
  });
}
