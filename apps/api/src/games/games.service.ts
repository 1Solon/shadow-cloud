import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { prisma, type Prisma } from '../database';
import { GamesQueryService } from './services/games-query.service';
import { GamesRegistrationService } from './services/games-registration.service';
import { GamesTurnService } from './services/games-turn.service';
import type { CreateDiscordGameDto } from './dto/create-discord-game.dto';
import type { RegisterDiscordPlayerDto } from './dto/register-discord-player.dto';
import type { ReorderSeatOrderDto } from './dto/reorder-seat-order.dto';
import type { ReplaceDiscordPlayerDto } from './dto/replace-discord-player.dto';
import type { ResignDiscordPlayerDto } from './dto/resign-discord-player.dto';
import type { SkipDiscordPlayerDto } from './dto/skip-discord-player.dto';
import type { UpdateGameMetadataDto } from './dto/update-game-metadata.dto';
import {
  mapArmyCount,
  mapDlcMode,
  mapGameMode,
  mapZoneCount,
  metadataUpdatedAuditEventType,
  normalizeNotesInput,
} from './support/game-configuration.helpers';
import type {
  GameDetailResponse,
  GameMetadataResponse,
  UploadedSaveFile,
} from './support/game-payload.types';
export type { UploadedSaveFile } from './support/game-payload.types';

@Injectable()
export class GamesService {
  constructor(
    private readonly gamesQuery: GamesQueryService,
    private readonly gamesRegistration: GamesRegistrationService,
    private readonly gamesTurn: GamesTurnService,
  ) {}

  async listGames() {
    return this.gamesQuery.listGames();
  }

  async getGameDetail(gameId: string): Promise<GameDetailResponse> {
    return this.gamesQuery.getGameDetail(gameId);
  }

  async updateGameMetadata(
    gameId: string,
    userId: string | undefined,
    input: UpdateGameMetadataDto,
  ): Promise<GameMetadataResponse> {
    if (!userId) {
      throw new UnauthorizedException(
        'Authenticated user id is missing from the token.',
      );
    }

    const game = await prisma.game.findFirst({
      where: {
        OR: [{ id: gameId }, { slug: gameId }],
      },
      include: {
        turnState: true,
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    if (game.organizerId !== userId) {
      throw new ForbiddenException(
        'Only the game organizer can edit game metadata.',
      );
    }

    const previousMetadata = {
      roundNumber: game.turnState?.roundNumber ?? 1,
      hasAiPlayers: game.hasAiPlayers,
      dlcMode: game.dlcMode,
      gameMode: game.gameMode,
      techLevel: game.techLevel,
      zoneCount: game.zoneCount,
      armyCount: game.armyCount,
      notes: (game as { notes?: string | null }).notes ?? null,
    };
    const nextMetadata = {
      roundNumber: input.roundNumber ?? previousMetadata.roundNumber,
      hasAiPlayers: input.hasAiPlayers ?? previousMetadata.hasAiPlayers,
      dlcMode:
        input.dlcMode == null
          ? previousMetadata.dlcMode
          : mapDlcMode(input.dlcMode),
      gameMode:
        input.gameMode == null
          ? previousMetadata.gameMode
          : mapGameMode(input.gameMode),
      techLevel: input.techLevel ?? previousMetadata.techLevel,
      zoneCount:
        input.zoneCount == null
          ? previousMetadata.zoneCount
          : mapZoneCount(input.zoneCount),
      armyCount:
        input.armyCount == null
          ? previousMetadata.armyCount
          : mapArmyCount(input.armyCount),
      notes:
        input.notes === undefined
          ? previousMetadata.notes
          : normalizeNotesInput(input.notes),
    };

    await prisma.$transaction(async (transaction) => {
      if (input.roundNumber != null) {
        await transaction.turnState.update({
          where: { gameId: game.id },
          data: {
            roundNumber: nextMetadata.roundNumber,
          },
        });
      }

      const gameUpdateData: Prisma.GameUpdateInput = {};

      if (input.hasAiPlayers != null) {
        gameUpdateData.hasAiPlayers = nextMetadata.hasAiPlayers;
      }

      if (input.dlcMode != null) {
        gameUpdateData.dlcMode = nextMetadata.dlcMode;
      }

      if (input.gameMode != null) {
        gameUpdateData.gameMode = nextMetadata.gameMode;
      }

      if (input.techLevel != null) {
        gameUpdateData.techLevel = nextMetadata.techLevel;
      }

      if (input.zoneCount != null) {
        gameUpdateData.zoneCount = nextMetadata.zoneCount;
      }

      if (input.armyCount != null) {
        gameUpdateData.armyCount = nextMetadata.armyCount;
      }

      if (input.notes !== undefined) {
        gameUpdateData.notes = nextMetadata.notes;
      }

      if (Object.keys(gameUpdateData).length > 0) {
        await transaction.game.update({
          where: { id: game.id },
          data: gameUpdateData,
        });
      }

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: userId,
          eventType: metadataUpdatedAuditEventType,
          payload: JSON.stringify({
            previousMetadata,
            nextMetadata,
          }),
        },
      });
    });

    return {
      id: game.id,
      slug: game.slug,
      ...nextMetadata,
    };
  }

  async getGameStatus(gameId: string, userId?: string) {
    return this.gamesQuery.getGameStatus(gameId, userId);
  }

  async uploadSave(
    gameId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
  ) {
    return this.gamesTurn.uploadSave(gameId, userId, file);
  }

  async downloadSave(gameId: string, fileVersionId: string, userId?: string) {
    return this.gamesQuery.downloadSave(gameId, fileVersionId, userId);
  }

  async reorderSeatOrder(
    gameId: string,
    userId: string | undefined,
    input: ReorderSeatOrderDto,
  ) {
    return this.gamesTurn.reorderSeatOrder(gameId, userId, input);
  }

  async createGameFromDiscordInit(input: CreateDiscordGameDto) {
    return this.gamesRegistration.createGameFromDiscordInit(input);
  }

  async registerPlayerFromDiscord(input: RegisterDiscordPlayerDto) {
    return this.gamesRegistration.registerPlayerFromDiscord(input);
  }

  async approveRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
  ) {
    return this.gamesRegistration.approveRegistrationRequest(
      requestId,
      discordMessageId,
    );
  }

  async rejectRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
  ) {
    return this.gamesRegistration.rejectRegistrationRequest(
      requestId,
      discordMessageId,
    );
  }

  async replacePlayerInSeat(input: ReplaceDiscordPlayerDto) {
    return this.gamesTurn.replacePlayerInSeat(input);
  }

  async resignPlayerFromDiscord(input: ResignDiscordPlayerDto) {
    return this.gamesTurn.resignPlayerFromDiscord(input);
  }

  async skipPlayerTurn(input: SkipDiscordPlayerDto) {
    return this.gamesTurn.skipPlayerTurn(input);
  }
}
