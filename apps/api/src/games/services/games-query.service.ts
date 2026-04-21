import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditEventType, GameRole, prisma } from '../../database';
import {
  buildGameStatus,
  getActivePlayer,
  trimFileHistory,
} from '../games-domain';
import { FileStorageService } from '../file-storage.service';
import type { GameDetailResponse } from '../support/game-payload.types';
import { resolveActivePlayerEntry } from '../support/turn-state.utils';
import type {
  FileVersionSummary,
  GameSummary,
  PlayerSummary,
} from '../games.types';

@Injectable()
export class GamesQueryService {
  constructor(private readonly fileStorage: FileStorageService) {}

  async listGames() {
    const games = await prisma.game.findMany({
      include: {
        organizer: true,
        players: {
          include: {
            user: true,
          },
          orderBy: {
            turnOrder: 'asc',
          },
        },
        turnState: {
          include: {
            activePlayerEntry: {
              include: {
                user: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return games.map((game) => {
      const activePlayerEntry = game.turnState
        ? resolveActivePlayerEntry(game.players, game.turnState)
        : null;

      return {
        id: game.id,
        slug: game.slug,
        name: game.name,
        organizerDisplayName: game.organizer.displayName,
        updatedAt: game.updatedAt.toISOString(),
        activePlayerDisplayName:
          activePlayerEntry?.user?.displayName ?? 'Unassigned',
        playerCount: game.players.length,
      };
    });
  }

  async getGameDetail(gameId: string): Promise<GameDetailResponse> {
    const game = await prisma.game.findFirst({
      where: {
        OR: [{ id: gameId }, { slug: gameId }],
      },
      include: {
        organizer: true,
        players: {
          include: {
            user: true,
          },
          orderBy: {
            turnOrder: 'asc',
          },
        },
        turnState: {
          include: {
            activePlayerEntry: {
              include: {
                user: true,
              },
            },
          },
        },
        fileVersions: {
          include: {
            uploadedBy: true,
          },
          orderBy: {
            versionNumber: 'desc',
          },
          take: 8,
        },
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    const activePlayerEntry = game.turnState
      ? resolveActivePlayerEntry(game.players, game.turnState)
      : null;

    return {
      id: game.id,
      slug: game.slug,
      name: game.name,
      organizerId: game.organizerId,
      organizerDisplayName: game.organizer.displayName,
      hasAiPlayers: game.hasAiPlayers,
      dlcMode: game.dlcMode,
      gameMode: game.gameMode,
      techLevel: game.techLevel,
      zoneCount: game.zoneCount,
      armyCount: game.armyCount,
      notes: (game as { notes?: string | null }).notes ?? null,
      roundNumber: game.turnState?.roundNumber ?? 1,
      activePlayerEntryId: activePlayerEntry?.id ?? null,
      activePlayerUserId: activePlayerEntry?.userId ?? null,
      activePlayerDisplayName:
        activePlayerEntry?.user?.displayName ?? 'Unassigned',
      players: game.players.map((player) => ({
        id: player.id,
        userId: player.userId,
        displayName: player.user?.displayName ?? null,
        turnOrder: player.turnOrder,
        isOrganizer:
          player.role === GameRole.ORGANIZER ||
          player.userId === game.organizerId,
      })),
      fileVersions: game.fileVersions.map((fileVersion) => ({
        id: fileVersion.id,
        originalName: fileVersion.originalName,
        uploadedAt: fileVersion.uploadedAt.toISOString(),
        uploadedByDisplayName: fileVersion.uploadedBy.displayName,
      })),
    };
  }

  async getGameStatus(gameId: string, userId?: string) {
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
        organizer: true,
        players: {
          include: {
            user: true,
          },
          orderBy: {
            turnOrder: 'asc',
          },
        },
        turnState: {
          include: {
            activePlayerEntry: {
              include: {
                user: true,
              },
            },
          },
        },
        fileVersions: {
          include: {
            uploadedBy: true,
          },
          orderBy: {
            versionNumber: 'desc',
          },
        },
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    const isOrganizer = game.organizerId === userId;
    const membership = game.players.find((player) => player.userId === userId);

    if (!isOrganizer && !membership) {
      throw new ForbiddenException(`You do not have access to game ${gameId}.`);
    }

    if (!game.turnState) {
      throw new NotFoundException(
        `Game ${gameId} does not have an active turn state yet.`,
      );
    }

    const activePlayerEntry = resolveActivePlayerEntry(
      game.players,
      game.turnState,
    );

    if (!activePlayerEntry) {
      throw new NotFoundException(
        `Game ${gameId} does not have a resolvable active player entry.`,
      );
    }

    const players: PlayerSummary[] = game.players.map((player) => ({
      id: player.id,
      userId: player.userId,
      displayName: player.user?.displayName ?? null,
      turnOrder: player.turnOrder,
      isOrganizer:
        player.role === 'ORGANIZER' || game.organizerId === player.userId,
    }));

    const recentFiles: FileVersionSummary[] = trimFileHistory(
      game.fileVersions.map((fileVersion) => ({
        id: fileVersion.id,
        versionNumber: fileVersion.versionNumber,
        originalName: fileVersion.originalName,
        uploadedAt: fileVersion.uploadedAt.toISOString(),
        uploadedBy: fileVersion.uploadedBy.displayName,
      })),
      game.retentionLimit,
    );

    const summary: GameSummary = {
      id: game.id,
      name: game.name,
      channelName: game.discordThreadId ?? game.discordChannelId ?? game.slug,
      retentionLimit: game.retentionLimit,
      activePlayerEntryId: activePlayerEntry.id,
      players,
      recentFiles,
    };

    return buildGameStatus({
      game: summary,
      activePlayer: getActivePlayer(players, activePlayerEntry.id),
      canCurrentPlayerUpload: activePlayerEntry.userId === userId,
      canParticipantsDownload: true,
    });
  }

  async downloadSave(gameId: string, fileVersionId: string, userId?: string) {
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
        players: true,
      },
    });

    if (!game) {
      throw new NotFoundException(`Game ${gameId} was not found.`);
    }

    const isOrganizer = game.organizerId === userId;
    const membership = game.players.find((player) => player.userId === userId);

    if (!isOrganizer && !membership) {
      throw new ForbiddenException(`You do not have access to game ${gameId}.`);
    }

    const fileVersion = await prisma.fileVersion.findFirst({
      where: {
        id: fileVersionId,
        gameId: game.id,
      },
    });

    if (!fileVersion) {
      throw new NotFoundException(
        `Save file ${fileVersionId} was not found for game ${gameId}.`,
      );
    }

    const fileStats = await this.fileStorage.verifyFileExists(
      fileVersion.storagePath,
    );

    await prisma.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: userId,
        eventType: AuditEventType.FILE_DOWNLOADED,
        payload: JSON.stringify({
          fileVersionId: fileVersion.id,
          versionNumber: fileVersion.versionNumber,
          originalName: fileVersion.originalName,
        }),
      },
    });

    return {
      originalName: fileVersion.originalName,
      size: fileStats.size,
      lastModified: fileStats.lastModified,
      stream: this.fileStorage.createDownloadStream(fileVersion.storagePath),
    };
  }
}
