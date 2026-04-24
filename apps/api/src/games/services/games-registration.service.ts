import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  GameRole,
  RegistrationRequestStatus,
  prisma,
} from '../../database';
import { BotNotificationsService } from '../bot-notifications.service';
import type { ThreadRenameNotificationPayload } from '../bot-notifications.service';
import type { CreateDiscordGameDto } from '../dto/create-discord-game.dto';
import type { RegisterDiscordPlayerDto } from '../dto/register-discord-player.dto';
import {
  buildCanonicalThreadName,
  mapOptionalArmyCount,
  mapOptionalDlcMode,
  mapOptionalGameMode,
  mapOptionalZoneCount,
  slugify,
} from '../support/game-configuration.helpers';
import {
  getDiscordIdentity,
  upsertDiscordUser,
} from '../support/discord-user.helpers';
import { syncGameSeatCount } from '../support/seat-count.helpers';

@Injectable()
export class GamesRegistrationService {
  constructor(private readonly botNotifications: BotNotificationsService) {}

  async notifyThreadRename(payload: ThreadRenameNotificationPayload['game']) {
    await this.botNotifications.notifyThreadRenamed({ game: payload });
  }

  async createGameFromDiscordInit(input: CreateDiscordGameDto) {
    const existingThread = await prisma.game.findUnique({
      where: {
        discordThreadId: input.discordThreadId,
      },
    });

    if (existingThread) {
      throw new ConflictException(
        `Thread ${input.discordThreadId} is already linked to game ${existingThread.slug}.`,
      );
    }

    const organizer = await prisma.$transaction((transaction) =>
      upsertDiscordUser(transaction, {
        discordId: input.organizerDiscordId,
        displayName: input.organizerDisplayName,
      }),
    );

    const baseSlug =
      slugify(input.slug?.trim() || input.name) ||
      `game-${input.discordThreadId}`;
    let resolvedSlug = baseSlug;
    let suffix = 2;

    while (await prisma.game.findUnique({ where: { slug: resolvedSlug } })) {
      resolvedSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const game = await prisma.$transaction(async (transaction) => {
      if (input.gameNumber != null) {
        const existingNumber = await transaction.game.findUnique({
          where: { gameNumber: input.gameNumber },
          select: { id: true },
        });

        if (existingNumber) {
          throw new ConflictException(
            `Game number ${input.gameNumber} is already in use.`,
          );
        }
      }

      const resolvedGameNumber = input.gameNumber;

      const createdGame = await transaction.game.create({
        data: {
          gameNumber: resolvedGameNumber,
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
        },
      });

      const organizerEntry = await transaction.gamePlayer.create({
        data: {
          gameId: createdGame.id,
          userId: organizer.id,
          turnOrder: 1,
          role: GameRole.ORGANIZER,
        },
      });

      await transaction.turnState.create({
        data: {
          gameId: createdGame.id,
          activePlayerId: organizer.id,
          activePlayerEntryId: organizerEntry.id,
          roundNumber: 1,
        },
      });

      if (input.playerCount != null) {
        await syncGameSeatCount({
          transaction,
          gameId: createdGame.id,
          players: [
            {
              id: organizerEntry.id,
              turnOrder: organizerEntry.turnOrder,
              userId: organizerEntry.userId,
            },
          ],
          targetPlayerCount: input.playerCount,
        });
      }

      await transaction.auditEvent.create({
        data: {
          gameId: createdGame.id,
          actorId: organizer.id,
          eventType: AuditEventType.GAME_CREATED,
          payload: JSON.stringify({
            source: 'discord-init',
            gameNumber: resolvedGameNumber,
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

      return createdGame;
    });

    const threadName = buildCanonicalThreadName({
      gameNumber: game.gameNumber,
      name: game.name,
      playerCount: input.playerCount ?? game.playerCount ?? null,
      gameMode: input.gameMode ?? game.gameMode ?? null,
      techLevel: input.techLevel ?? game.techLevel ?? null,
      zoneCount: input.zoneCount ?? game.zoneCount ?? null,
      armyCount: input.armyCount ?? game.armyCount ?? null,
    });

    await this.botNotifications.notifyGameInitialized({
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

  async registerPlayerFromDiscord(input: RegisterDiscordPlayerDto) {
    const game = await prisma.game.findUnique({
      where: {
        discordThreadId: input.discordThreadId,
      },
      include: {
        organizer: {
          include: { identities: true },
        },
      },
    });

    if (!game) {
      throw new NotFoundException(
        `Thread ${input.discordThreadId} is not linked to a game.`,
      );
    }

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: input.playerDiscordId,
        },
      },
    });

    if (existingIdentity) {
      const existingMembership = await prisma.gamePlayer.findFirst({
        where: { gameId: game.id, userId: existingIdentity.userId },
      });

      if (existingMembership) {
        throw new ConflictException(
          'Player is already registered in this game.',
        );
      }
    }

    const existingRequest = await prisma.registrationRequest.findFirst({
      where: {
        gameId: game.id,
        playerDiscordId: input.playerDiscordId,
        status: RegistrationRequestStatus.PENDING,
      },
    });

    if (existingRequest) {
      throw new ConflictException(
        'A registration request for this player is already pending approval.',
      );
    }

    if (game.playerCount != null) {
      const currentOccupiedSeatCount = await prisma.gamePlayer.count({
        where: {
          gameId: game.id,
          userId: {
            not: null,
          },
        },
      });

      if (currentOccupiedSeatCount >= game.playerCount) {
        throw new ConflictException('This game is already at its seat limit.');
      }
    }

    const registrationRequest = await prisma.registrationRequest.create({
      data: {
        gameId: game.id,
        playerDiscordId: input.playerDiscordId,
        playerDisplayName: input.playerDisplayName,
        playerUsername: input.playerUsername ?? null,
        status: RegistrationRequestStatus.PENDING,
      },
    });

    await prisma.auditEvent.create({
      data: {
        gameId: game.id,
        eventType: AuditEventType.REGISTRATION_REQUESTED,
        payload: JSON.stringify({
          requestId: registrationRequest.id,
          playerDiscordId: input.playerDiscordId,
          playerDisplayName: input.playerDisplayName,
          playerUsername: input.playerUsername ?? null,
          discordThreadId: input.discordThreadId,
        }),
      },
    });

    const organizerDiscordId = getDiscordIdentity(game.organizer);

    return {
      requestId: registrationRequest.id,
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      organizerDiscordId,
      player: {
        displayName: input.playerDisplayName,
        discordId: input.playerDiscordId,
      },
    };
  }

  async approveRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
    approverDiscordId?: string,
  ) {
    const request = await prisma.registrationRequest.findUnique({
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

    const registeredPlayer = await prisma.$transaction(async (transaction) => {
      await transaction.registrationRequest.update({
        where: { id: requestId },
        data: {
          status: RegistrationRequestStatus.APPROVED,
          respondedAt: new Date(),
          ...(discordMessageId ? { discordMessageId } : {}),
        },
      });

      const player = await upsertDiscordUser(transaction, {
        discordId: request.playerDiscordId,
        displayName: request.playerDisplayName,
      });

      const availableSeat = await transaction.gamePlayer.findFirst({
        where: {
          gameId: request.gameId,
          userId: null,
        },
        orderBy: { turnOrder: 'asc' },
      });

      const latestSeat = await transaction.gamePlayer.findFirst({
        where: { gameId: request.gameId },
        orderBy: { turnOrder: 'desc' },
      });

      if (
        !availableSeat &&
        request.game.playerCount != null &&
        (latestSeat?.turnOrder ?? 0) >= request.game.playerCount
      ) {
        throw new ConflictException('This game is already at its seat limit.');
      }

      const seat = availableSeat
        ? await transaction.gamePlayer.update({
            where: { id: availableSeat.id },
            data: {
              userId: player.id,
            },
            include: { user: true },
          })
        : await transaction.gamePlayer.create({
            data: {
              gameId: request.gameId,
              userId: player.id,
              turnOrder: (latestSeat?.turnOrder ?? 0) + 1,
              role: GameRole.PLAYER,
            },
            include: { user: true },
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

      return seat;
    });

    return {
      gameId: request.gameId,
      gameNumber: request.game.gameNumber,
      slug: request.game.slug,
      name: request.game.name,
      player: {
        id: registeredPlayer.id,
        userId: registeredPlayer.userId,
        displayName: registeredPlayer.user!.displayName,
        turnOrder: registeredPlayer.turnOrder,
        discordId: request.playerDiscordId,
      },
    };
  }

  async rejectRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
    approverDiscordId?: string,
  ) {
    const request = await prisma.registrationRequest.findUnique({
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
        'Only the game overlord can reject registration requests.',
      );
    }

    await prisma.registrationRequest.update({
      where: { id: requestId },
      data: {
        status: RegistrationRequestStatus.REJECTED,
        respondedAt: new Date(),
        ...(discordMessageId ? { discordMessageId } : {}),
      },
    });

    await prisma.auditEvent.create({
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
  }
}
