import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { prisma } from '../database';
import { GamesQueryService } from './services/games-query.service';
import { GamesFileService } from './services/games-file.service';
import { GamesRegistrationService } from './services/games-registration.service';
import { GamesTurnService } from './services/games-turn.service';
import { TurnMutationsService } from './services/turn-mutations.service';
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
import { buildGameIdentifierWhere } from './support/game-lookup.helpers';
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
    private readonly turnMutations: TurnMutationsService,
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
    return this.turnMutations.updateGameMetadata(gameId, userId, input);
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

  inspectLatestSave(gameId: string, userId: string | undefined) {
    return this.gamesFile.inspectLatestSave(gameId, userId);
  }

  resetPassword(
    gameId: string,
    userId: string | undefined,
    input: Parameters<GamesFileService['resetPassword']>[2],
  ) {
    return this.gamesFile.resetPassword(gameId, userId, input);
  }

  getPasswordResetRecovery(gameId: string, userId: string | undefined) {
    return this.gamesFile.getPasswordResetRecovery(gameId, userId);
  }

  undoPasswordReset(
    gameId: string,
    userId: string | undefined,
    input: Parameters<GamesFileService['undoPasswordReset']>[2],
  ) {
    return this.gamesFile.undoPasswordReset(gameId, userId, input);
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

  async getSeatOrder(gameId: string, userId: string | undefined) {
    return this.turnMutations.getSeatOrder(gameId, userId);
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
