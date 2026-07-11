import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { prisma, type Prisma } from '../database';
import { GamesQueryService } from './services/games-query.service';
import { GamesFileService } from './services/games-file.service';
import { GamesRegistrationService } from './services/games-registration.service';
import { GamesTurnService } from './services/games-turn.service';
import { TurnRecordsService } from './services/turn-records.service';
import { FileStorageService } from './file-storage.service';
import type { AuthorizeHostCommandDto } from './dto/authorize-host-command.dto';
import type { CreateDiscordGameDto } from './dto/create-discord-game.dto';
import type { LinkDiscordThreadDto } from './dto/link-discord-thread.dto';
import type { RegisterDiscordPlayerDto } from './dto/register-discord-player.dto';
import type { ReorderSeatOrderDto } from './dto/reorder-seat-order.dto';
import type { ReplaceDiscordPlayerDto } from './dto/replace-discord-player.dto';
import type { ResignDiscordPlayerDto } from './dto/resign-discord-player.dto';
import type { SkipDiscordPlayerDto } from './dto/skip-discord-player.dto';
import type { TransferHostDto } from './dto/transfer-host.dto';
import type { UpdateGameMetadataDto } from './dto/update-game-metadata.dto';
import {
  buildCanonicalThreadName,
  mapArmyCount,
  mapDlcMode,
  mapGameMode,
  mapZoneCount,
  metadataUpdatedAuditEventType,
  normalizeGameNameInput,
  normalizeNotesInput,
} from './support/game-configuration.helpers';
import { buildGameIdentifierWhere } from './support/game-lookup.helpers';
import { syncGameSeatCount } from './support/seat-count.helpers';
import type {
  GameDetailResponse,
  GameMetadataResponse,
  ReplaceSaveMetadata,
  UploadSaveSafetyMetadata,
  UploadedSaveFile,
} from './support/game-payload.types';
export type { UploadedSaveFile } from './support/game-payload.types';

@Injectable()
export class GamesService {
  constructor(
    private readonly authService: AuthService,
    private readonly gamesQuery: GamesQueryService,
    private readonly gamesRegistration: GamesRegistrationService,
    private readonly gamesTurn: GamesTurnService,
    private readonly fileStorage: FileStorageService,
    private readonly gamesFile: GamesFileService,
    private readonly turnRecords: TurnRecordsService = new TurnRecordsService(),
  ) {}

  private async assertGameManagementAccess(input: {
    organizerId: string;
    userId: string;
    deniedMessage: string;
  }) {
    if (input.organizerId === input.userId) {
      return;
    }

    const hasShadowOverride = await this.authService.isUserShadowOverride(
      input.userId,
    );

    if (!hasShadowOverride) {
      throw new ForbiddenException(input.deniedMessage);
    }
  }

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
        ...buildGameIdentifierWhere(gameId),
      },
      include: {
        players: {
          select: {
            id: true,
            turnOrder: true,
            userId: true,
          },
        },
        turnState: true,
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    await this.assertGameManagementAccess({
      organizerId: game.organizerId,
      userId,
      deniedMessage: 'Only the game organizer can edit game metadata.',
    });

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
      notes: (game as { notes?: string | null }).notes ?? null,
      turnTargetHours: game.turnTargetHours,
      turnReminderGraceHours: game.turnReminderGraceHours,
      turnReminderRepeatHours: game.turnReminderRepeatHours,
      turnRemindersEnabled: game.turnRemindersEnabled,
    };
    const nextName =
      input.name === undefined
        ? previousMetadata.name
        : normalizeGameNameInput(input.name);

    if (nextName == null) {
      throw new BadRequestException('Game name cannot be empty.');
    }

    const occupiedSeatCount = game.players.filter(
      (player) => player.userId != null,
    ).length;
    const nextMetadata = {
      gameNumber: input.gameNumber ?? previousMetadata.gameNumber,
      name: nextName,
      roundNumber: input.roundNumber ?? previousMetadata.roundNumber,
      playerCount: input.playerCount ?? previousMetadata.playerCount,
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
      turnTargetHours:
        input.turnTargetHours ?? previousMetadata.turnTargetHours,
      turnReminderGraceHours:
        input.turnReminderGraceHours ?? previousMetadata.turnReminderGraceHours,
      turnReminderRepeatHours:
        input.turnReminderRepeatHours ??
        previousMetadata.turnReminderRepeatHours,
      turnRemindersEnabled:
        input.turnRemindersEnabled ?? previousMetadata.turnRemindersEnabled,
    };

    if (
      input.playerCount != null &&
      nextMetadata.playerCount != null &&
      nextMetadata.playerCount < occupiedSeatCount
    ) {
      throw new BadRequestException(
        `Seat limit cannot be lower than the ${occupiedSeatCount} occupied seats in this game.`,
      );
    }

    let committedMetadata = nextMetadata;

    await prisma.$transaction(async (transaction) => {
      if (
        input.gameNumber != null &&
        input.gameNumber !== previousMetadata.gameNumber
      ) {
        const existingGame = await transaction.game.findUnique({
          where: { gameNumber: input.gameNumber },
          select: { id: true },
        });

        if (existingGame && existingGame.id !== game.id) {
          throw new ConflictException(
            `Game number ${input.gameNumber} is already in use.`,
          );
        }
      }

      const currentPolicy = await transaction.game.findUnique({
        where: { id: game.id },
        select: {
          turnTargetHours: true,
          turnReminderGraceHours: true,
          turnReminderRepeatHours: true,
          turnRemindersEnabled: true,
        },
      });

      if (!currentPolicy) {
        throw new NotFoundException(`Game ${gameId} was not found.`);
      }

      const transactionNextMetadata = {
        ...nextMetadata,
        turnTargetHours: input.turnTargetHours ?? currentPolicy.turnTargetHours,
        turnReminderGraceHours:
          input.turnReminderGraceHours ?? currentPolicy.turnReminderGraceHours,
        turnReminderRepeatHours:
          input.turnReminderRepeatHours ??
          currentPolicy.turnReminderRepeatHours,
        turnRemindersEnabled:
          input.turnRemindersEnabled ?? currentPolicy.turnRemindersEnabled,
      };
      const policyChanged =
        transactionNextMetadata.turnTargetHours !==
          currentPolicy.turnTargetHours ||
        transactionNextMetadata.turnReminderGraceHours !==
          currentPolicy.turnReminderGraceHours ||
        transactionNextMetadata.turnReminderRepeatHours !==
          currentPolicy.turnReminderRepeatHours ||
        transactionNextMetadata.turnRemindersEnabled !==
          currentPolicy.turnRemindersEnabled;

      if (
        input.roundNumber != null &&
        nextMetadata.roundNumber !== previousMetadata.roundNumber
      ) {
        await transaction.turnState.update({
          where: { gameId: game.id },
          data: {
            roundNumber: nextMetadata.roundNumber,
          },
        });

        await this.turnRecords.synchronizeOpenRound(transaction, {
          gameId: game.id,
          expectedCurrent: {
            gamePlayerId: game.turnState?.activePlayerEntryId ?? null,
            userId: game.turnState!.activePlayerId,
          },
          roundNumber: nextMetadata.roundNumber,
        });
      }

      if (input.playerCount != null && nextMetadata.playerCount != null) {
        await syncGameSeatCount({
          transaction,
          gameId: game.id,
          players: game.players,
          targetPlayerCount: nextMetadata.playerCount,
        });
      }

      const gameUpdateData: Prisma.GameUpdateInput = {};

      if (input.gameNumber != null) {
        gameUpdateData.gameNumber = transactionNextMetadata.gameNumber;
      }

      if (input.name !== undefined) {
        gameUpdateData.name = transactionNextMetadata.name;
      }

      if (input.playerCount != null) {
        gameUpdateData.playerCount = transactionNextMetadata.playerCount;
      }

      if (input.hasAiPlayers != null) {
        gameUpdateData.hasAiPlayers = transactionNextMetadata.hasAiPlayers;
      }

      if (input.dlcMode != null) {
        gameUpdateData.dlcMode = transactionNextMetadata.dlcMode;
      }

      if (input.gameMode != null) {
        gameUpdateData.gameMode = transactionNextMetadata.gameMode;
      }

      if (input.techLevel != null) {
        gameUpdateData.techLevel = transactionNextMetadata.techLevel;
      }

      if (input.zoneCount != null) {
        gameUpdateData.zoneCount = transactionNextMetadata.zoneCount;
      }

      if (input.armyCount != null) {
        gameUpdateData.armyCount = transactionNextMetadata.armyCount;
      }

      if (input.notes !== undefined) {
        gameUpdateData.notes = transactionNextMetadata.notes;
      }

      if (input.turnTargetHours !== undefined) {
        gameUpdateData.turnTargetHours =
          transactionNextMetadata.turnTargetHours;
      }

      if (input.turnReminderGraceHours !== undefined) {
        gameUpdateData.turnReminderGraceHours =
          transactionNextMetadata.turnReminderGraceHours;
      }

      if (input.turnReminderRepeatHours !== undefined) {
        gameUpdateData.turnReminderRepeatHours =
          transactionNextMetadata.turnReminderRepeatHours;
      }

      if (input.turnRemindersEnabled !== undefined) {
        gameUpdateData.turnRemindersEnabled =
          transactionNextMetadata.turnRemindersEnabled;
      }

      if (Object.keys(gameUpdateData).length > 0) {
        await transaction.game.update({
          where: { id: game.id },
          data: gameUpdateData,
        });
      }

      if (policyChanged) {
        await this.turnRecords.recalculateOpenReminder(transaction, {
          gameId: game.id,
        });
      }

      committedMetadata = transactionNextMetadata;

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: userId,
          eventType: metadataUpdatedAuditEventType,
          payload: JSON.stringify({
            previousMetadata: { ...previousMetadata, ...currentPolicy },
            nextMetadata: committedMetadata,
          }),
        },
      });
    });

    const nextThreadName = buildCanonicalThreadName({
      gameNumber: committedMetadata.gameNumber,
      name: committedMetadata.name,
      playerCount: committedMetadata.playerCount,
      gameMode: committedMetadata.gameMode,
      techLevel: committedMetadata.techLevel,
      zoneCount: committedMetadata.zoneCount,
      armyCount: committedMetadata.armyCount,
    });

    if (game.discordThreadId) {
      await this.gamesRegistration.notifyThreadRename({
        id: game.id,
        slug: game.slug,
        name: committedMetadata.name,
        threadName: nextThreadName,
        discordThreadId: game.discordThreadId,
      });
    }

    return {
      id: game.id,
      slug: game.slug,
      ...committedMetadata,
    };
  }

  async getGameStatus(gameId: string, userId?: string) {
    return this.gamesQuery.getGameStatus(gameId, userId);
  }

  async uploadSave(
    gameId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
    metadata?: UploadSaveSafetyMetadata,
  ) {
    return this.gamesTurn.uploadSave(gameId, userId, file, metadata);
  }

  replaceSave(
    gameId: string,
    fileVersionId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
    metadata?: ReplaceSaveMetadata,
  ) {
    return this.gamesFile.replaceSave(
      gameId,
      fileVersionId,
      userId,
      file,
      metadata,
    );
  }

  async downloadSave(gameId: string, fileVersionId: string) {
    return this.gamesQuery.downloadSave(gameId, fileVersionId);
  }

  async deleteGame(gameId: string, userId: string | undefined) {
    if (!userId) {
      throw new UnauthorizedException(
        'Authenticated user id is missing from the token.',
      );
    }

    const game = await prisma.game.findFirst({
      where: {
        ...buildGameIdentifierWhere(gameId),
      },
      select: {
        id: true,
        gameNumber: true,
        slug: true,
        name: true,
        organizerId: true,
        fileVersions: {
          select: {
            storagePath: true,
          },
        },
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    await this.assertGameManagementAccess({
      organizerId: game.organizerId,
      userId,
      deniedMessage: 'Only the game organizer can delete this game.',
    });

    await prisma.game.delete({
      where: {
        id: game.id,
      },
    });

    await Promise.all(
      game.fileVersions.map((fileVersion) =>
        this.fileStorage.removeFile(fileVersion.storagePath),
      ),
    );

    return {
      id: game.id,
      gameNumber: game.gameNumber,
      slug: game.slug,
      name: game.name,
      deleted: true,
    };
  }

  async reorderSeatOrder(
    gameId: string,
    userId: string | undefined,
    input: ReorderSeatOrderDto,
  ) {
    return this.gamesTurn.reorderSeatOrder(gameId, userId, input);
  }

  async transferHost(
    gameId: string,
    userId: string | undefined,
    input: TransferHostDto,
  ) {
    return this.gamesTurn.transferHost(gameId, userId, input);
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
    approverDiscordId?: string,
  ) {
    return this.gamesRegistration.approveRegistrationRequest(
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
    return this.gamesRegistration.rejectRegistrationRequest(
      requestId,
      discordMessageId,
      approverDiscordId,
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

  async linkGameFromDiscordThread(input: LinkDiscordThreadDto) {
    return this.gamesQuery.getGameLinkByDiscordThread(input);
  }

  async authorizeHostCommand(input: AuthorizeHostCommandDto) {
    const game = await prisma.game.findUnique({
      where: { discordThreadId: input.discordThreadId },
      select: {
        id: true,
        slug: true,
        name: true,
        organizerId: true,
      },
    });

    if (!game) {
      throw new NotFoundException(
        `Thread ${input.discordThreadId} is not linked to a game.`,
      );
    }

    const callerIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: input.callerDiscordId,
        },
      },
    });

    if (!callerIdentity || callerIdentity.userId !== game.organizerId) {
      throw new ForbiddenException(
        `Only the game organizer can use /${input.commandName}.`,
      );
    }

    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
    };
  }
}
