import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEventType, RegistrationRequestStatus } from '@prisma/client';
import { prisma } from '../../database';
import { BotNotificationsService } from '../bot-notifications.service';
import type { ThreadRenameNotificationPayload } from '../bot-notifications.service';
import type { CreateDiscordGameDto } from '../dto/create-discord-game.dto';
import type { RegisterDiscordPlayerDto } from '../dto/register-discord-player.dto';
import { getDiscordIdentity } from '../support/discord-user.helpers';
import { TurnMutationsService } from './turn-mutations.service';

@Injectable()
export class GamesRegistrationService {
  constructor(
    private readonly botNotifications: BotNotificationsService,
    private readonly turnMutations: TurnMutationsService,
  ) {}

  async notifyThreadRename(payload: ThreadRenameNotificationPayload['game']) {
    await this.botNotifications.notifyThreadRenamed({ game: payload });
  }

  async createGameFromDiscordInit(input: CreateDiscordGameDto) {
    return this.turnMutations.createGameFromDiscordInit(input);
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
    return this.turnMutations.approveRegistrationRequest(
      requestId,
      discordMessageId,
      approverDiscordId,
    );
  }

  async rejectRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
    approverDiscordId?: string,
  ) {
    return this.turnMutations.rejectRegistrationRequest(
      requestId,
      discordMessageId,
      approverDiscordId,
    );
  }
}
