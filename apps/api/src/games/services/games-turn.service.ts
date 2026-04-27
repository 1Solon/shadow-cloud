import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { AuditEventType, GameRole, prisma } from '../../database';
import type { PlayerSummary } from '../games.types';
import { BotNotificationsService } from '../bot-notifications.service';
import { FileStorageService } from '../file-storage.service';
import type { ReorderSeatOrderDto } from '../dto/reorder-seat-order.dto';
import type { ReplaceDiscordPlayerDto } from '../dto/replace-discord-player.dto';
import type { ResignDiscordPlayerDto } from '../dto/resign-discord-player.dto';
import type { SkipDiscordPlayerDto } from '../dto/skip-discord-player.dto';
import type { TransferHostDto } from '../dto/transfer-host.dto';
import {
  getDiscordIdentity,
  upsertDiscordUser,
} from '../support/discord-user.helpers';
import { buildGameIdentifierWhere } from '../support/game-lookup.helpers';
import type { UploadedSaveFile } from '../support/game-payload.types';
import { resolveUploadSaveNaming } from '../support/upload-save-naming';
import { resolveActivePlayerEntry } from '../support/turn-state.utils';

@Injectable()
export class GamesTurnService {
  constructor(
    private readonly authService: AuthService,
    private readonly fileStorage: FileStorageService,
    private readonly botNotifications: BotNotificationsService,
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

  async uploadSave(
    gameId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
  ) {
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
        organizer: {
          include: {
            identities: true,
          },
        },
        players: {
          include: {
            user: {
              include: {
                identities: true,
              },
            },
          },
          orderBy: {
            turnOrder: 'asc',
          },
        },
        turnState: true,
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

    if (activePlayerEntry.userId !== userId) {
      throw new ForbiddenException(
        'Only the active player can upload the current save.',
      );
    }

    const orderedPlayers: PlayerSummary[] = game.players
      .filter((player) => player.userId != null)
      .map((player) => ({
        id: player.id,
        userId: player.userId,
        displayName: player.user!.displayName,
        turnOrder: player.turnOrder,
        isOrganizer:
          player.role === GameRole.ORGANIZER ||
          game.organizerId === player.userId,
      }));

    const firstPlayer = [...orderedPlayers].sort(
      (left, right) => left.turnOrder - right.turnOrder,
    )[0];

    if (!firstPlayer) {
      throw new NotFoundException(
        `Game ${gameId} does not have any registered players.`,
      );
    }

    const uploadSaveNaming = resolveUploadSaveNaming(
      orderedPlayers,
      activePlayerEntry.id,
    );

    let storedPath: string | null = null;

    try {
      const result = await prisma.$transaction(async (transaction) => {
        const latestVersion = await transaction.fileVersion.findFirst({
          where: {
            gameId: game.id,
          },
          orderBy: {
            versionNumber: 'desc',
          },
        });

        const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
        const storedFile = await this.fileStorage.storeFile({
          gameId: game.id,
          gameNumber: game.gameNumber,
          turn: game.turnState!.roundNumber,
          seat: uploadSaveNaming.seat,
          playerName: uploadSaveNaming.playerName,
          originalName: file.originalname,
          content: file.buffer,
        });
        storedPath = storedFile.storagePath;

        const fileVersion = await transaction.fileVersion.create({
          data: {
            gameId: game.id,
            uploadedById: userId,
            storagePath: storedFile.storagePath,
            originalName: storedFile.fileName,
            versionNumber,
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
              originalName: storedFile.fileName,
              storagePath: storedFile.storagePath,
            }),
          },
        });
        const roundAdvanced =
          uploadSaveNaming.nextActivePlayer.id === firstPlayer.id;
        const updatedTurnState = await transaction.turnState.update({
          where: {
            gameId: game.id,
          },
          data: {
            activePlayerId: uploadSaveNaming.nextActivePlayer.userId!,
            activePlayerEntryId: uploadSaveNaming.nextActivePlayer.id,
            roundNumber: {
              increment: roundAdvanced ? 1 : 0,
            },
          },
        });

        await transaction.auditEvent.create({
          data: {
            gameId: game.id,
            actorId: userId,
            eventType: AuditEventType.TURN_ADVANCED,
            payload: JSON.stringify({
              previousActivePlayerEntryId: activePlayerEntry.id,
              previousActivePlayerUserId: activePlayerEntry.userId,
              nextActivePlayerEntryId: uploadSaveNaming.nextActivePlayer.id,
              nextActivePlayerUserId: uploadSaveNaming.nextActivePlayer.userId,
              roundNumber: updatedTurnState.roundNumber,
              roundAdvanced,
              fileVersionId: fileVersion.id,
            }),
          },
        });

        return {
          fileVersion,
          versionNumber,
          nextActivePlayer: uploadSaveNaming.nextActivePlayer,
          roundNumber: updatedTurnState.roundNumber,
          roundAdvanced,
        };
      });

      await this.botNotifications.notifySaveUploaded({
        game: {
          id: game.id,
          gameNumber: game.gameNumber,
          slug: game.slug,
          name: game.name,
          discordThreadId: game.discordThreadId,
        },
        upload: {
          versionId: result.fileVersion.id,
          versionNumber: result.versionNumber,
          originalName: result.fileVersion.originalName,
          uploadedAt: result.fileVersion.uploadedAt.toISOString(),
          uploadedBy: {
            id: activePlayerEntry.userId,
            displayName: activePlayerEntry.user!.displayName,
            discordId: getDiscordIdentity(activePlayerEntry.user!),
          },
        },
        turn: {
          roundNumber: result.roundNumber,
          roundAdvanced: result.roundAdvanced,
          activePlayer: {
            id: result.nextActivePlayer.userId!,
            displayName: result.nextActivePlayer.displayName!,
            discordId: getDiscordIdentity(
              game.players.find(
                (player) => player.id === result.nextActivePlayer.id,
              )?.user ?? {},
            ),
            turnOrder: result.nextActivePlayer.turnOrder,
          },
        },
        players: game.players
          .filter((player) => player.userId != null)
          .map((player) => ({
            id: player.userId!,
            displayName: player.user!.displayName,
            discordId: getDiscordIdentity(player.user!),
            turnOrder: player.turnOrder,
          })),
      });

      return {
        fileVersionId: result.fileVersion.id,
        versionNumber: result.versionNumber,
        originalName: result.fileVersion.originalName,
        roundNumber: result.roundNumber,
        roundAdvanced: result.roundAdvanced,
        activePlayer: result.nextActivePlayer,
      };
    } catch (error) {
      if (storedPath) {
        await this.fileStorage.removeFile(storedPath);
      }

      throw error;
    }
  }

  async reorderSeatOrder(
    gameId: string,
    userId: string | undefined,
    input: ReorderSeatOrderDto,
  ) {
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
          include: {
            user: true,
          },
          orderBy: {
            turnOrder: 'asc',
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
      deniedMessage: 'Only the game organizer can edit seat order.',
    });

    const currentSeatIds = game.players.map((player) => player.id);
    const requestedSeatIds = input.seatEntryIds;
    const clearedSeatIds = input.clearedSeatEntryIds ?? [];
    const removedSeatIds = input.removedSeatEntryIds ?? [];

    if (requestedSeatIds.length === 0) {
      throw new BadRequestException(
        'Seat order must retain at least one seat in the game.',
      );
    }

    const uniqueSeatIds = new Set(requestedSeatIds);

    if (uniqueSeatIds.size !== requestedSeatIds.length) {
      throw new BadRequestException(
        'Seat order contains duplicate seat entries.',
      );
    }

    if (requestedSeatIds.some((seatId) => !currentSeatIds.includes(seatId))) {
      throw new BadRequestException(
        'Seat order contains a seat that does not belong to this game.',
      );
    }

    const uniqueRemovedSeatIds = new Set(removedSeatIds);

    if (uniqueRemovedSeatIds.size !== removedSeatIds.length) {
      throw new BadRequestException(
        'Seat deletion contains duplicate seat entries.',
      );
    }

    if (removedSeatIds.some((seatId) => !currentSeatIds.includes(seatId))) {
      throw new BadRequestException(
        'Seat deletion contains a seat that does not belong to this game.',
      );
    }

    if (removedSeatIds.some((seatId) => uniqueSeatIds.has(seatId))) {
      throw new BadRequestException(
        'Removed seats cannot remain in the requested seat order.',
      );
    }

    if (
      requestedSeatIds.length + removedSeatIds.length !==
      currentSeatIds.length
    ) {
      throw new BadRequestException(
        'Seat order must include every existing seat exactly once unless it is explicitly removed.',
      );
    }

    const uniqueClearedSeatIds = new Set(clearedSeatIds);

    if (uniqueClearedSeatIds.size !== clearedSeatIds.length) {
      throw new BadRequestException(
        'Seat removal contains duplicate seat entries.',
      );
    }

    if (clearedSeatIds.some((seatId) => !currentSeatIds.includes(seatId))) {
      throw new BadRequestException(
        'Seat removal contains a seat that does not belong to this game.',
      );
    }

    if (clearedSeatIds.some((seatId) => uniqueRemovedSeatIds.has(seatId))) {
      throw new BadRequestException('Removed seats cannot also be cleared.');
    }

    if (
      game.players.some(
        (player) =>
          (uniqueClearedSeatIds.has(player.id) ||
            uniqueRemovedSeatIds.has(player.id)) &&
          (player.role === GameRole.ORGANIZER ||
            player.userId === game.organizerId),
      )
    ) {
      throw new BadRequestException(
        'The organizer seat cannot be cleared or removed.',
      );
    }

    const currentOrder = game.players.map((player) => ({
      seatEntryId: player.id,
      turnOrder: player.turnOrder,
      displayName: player.user?.displayName ?? null,
    }));
    const currentActiveSeat = game.turnState
      ? resolveActivePlayerEntry(game.players, game.turnState)
      : null;
    const activeSeatTurnOrder = currentActiveSeat?.turnOrder ?? null;
    const reorderedSeats = requestedSeatIds.map((seatEntryId, index) => {
      const seat = game.players.find((player) => player.id === seatEntryId)!;

      return {
        ...seat,
        turnOrder: index + 1,
        userId: uniqueClearedSeatIds.has(seatEntryId) ? null : seat.userId,
        user: uniqueClearedSeatIds.has(seatEntryId) ? null : seat.user,
      };
    });
    const remainingOccupiedSeats = reorderedSeats.filter(
      (seat) => seat.userId != null,
    );

    if (remainingOccupiedSeats.length === 0) {
      throw new BadRequestException(
        'At least one occupied seat must remain in the game.',
      );
    }

    const explicitActiveEntry =
      input.activePlayerEntryId != null
        ? (reorderedSeats.find(
            (player) => player.id === input.activePlayerEntryId,
          ) ?? null)
        : null;

    if (input.activePlayerEntryId != null && !explicitActiveEntry) {
      throw new BadRequestException(
        'Active player selection does not belong to this game.',
      );
    }

    if (input.activePlayerEntryId != null && !explicitActiveEntry?.userId) {
      throw new BadRequestException(
        'Active player selection cannot be an empty seat.',
      );
    }

    const requestedOrder = reorderedSeats.map((seat) => ({
      seatEntryId: seat.id,
      turnOrder: seat.turnOrder,
      displayName: seat.user?.displayName ?? null,
    }));
    const temporaryTurnOrderBase = game.players.length * 2;
    const nextPlayerCount =
      game.playerCount == null
        ? reorderedSeats.length
        : Math.max(
            reorderedSeats.length,
            game.playerCount - removedSeatIds.length,
          );

    const nextActiveSeat = explicitActiveEntry
      ? explicitActiveEntry
      : currentActiveSeat &&
          reorderedSeats.find(
            (seat) => seat.id === currentActiveSeat.id && seat.userId != null,
          )
        ? reorderedSeats.find((seat) => seat.id === currentActiveSeat.id)!
        : activeSeatTurnOrder != null
          ? (remainingOccupiedSeats.find(
              (seat) => seat.turnOrder >= activeSeatTurnOrder,
            ) ?? remainingOccupiedSeats[0])
          : remainingOccupiedSeats[0];

    await prisma.$transaction(async (transaction) => {
      for (const [index, seat] of reorderedSeats.entries()) {
        await transaction.gamePlayer.update({
          where: { id: seat.id },
          data: {
            turnOrder: temporaryTurnOrderBase + index + 1,
            userId: seat.userId,
          },
        });
      }

      if (removedSeatIds.length > 0) {
        await transaction.gamePlayer.deleteMany({
          where: {
            gameId: game.id,
            id: {
              in: removedSeatIds,
            },
          },
        });

        await transaction.game.update({
          where: { id: game.id },
          data: {
            playerCount: nextPlayerCount,
          },
        });
      }

      for (const seat of reorderedSeats) {
        await transaction.gamePlayer.update({
          where: { id: seat.id },
          data: {
            turnOrder: seat.turnOrder,
            userId: seat.userId,
          },
        });
      }

      if (game.turnState && nextActiveSeat) {
        await transaction.turnState.update({
          where: { gameId: game.id },
          data: {
            activePlayerId: nextActiveSeat.userId!,
            activePlayerEntryId: nextActiveSeat.id,
          },
        });
      }

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: userId,
          eventType: AuditEventType.TURN_REASSIGNED,
          payload: JSON.stringify({
            previousOrder: currentOrder,
            nextOrder: requestedOrder,
            removedSeatEntryIds: removedSeatIds,
            previousPlayerCount: game.playerCount,
            nextPlayerCount,
            previousActivePlayerEntryId:
              game.turnState?.activePlayerEntryId ?? null,
            previousActivePlayerId: game.turnState?.activePlayerId ?? null,
            activeSeatTurnOrder,
            explicitActivePlayerEntryId: explicitActiveEntry?.id ?? null,
            nextActivePlayerEntryId: nextActiveSeat?.id ?? null,
            nextActivePlayerId: nextActiveSeat?.userId ?? null,
          }),
        },
      });
    });

    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      activePlayerEntryId:
        nextActiveSeat?.id ?? game.turnState?.activePlayerEntryId ?? null,
      players: requestedOrder,
    };
  }

  async replacePlayerInSeat(input: ReplaceDiscordPlayerDto) {
    const game = await prisma.game.findUnique({
      where: { discordThreadId: input.discordThreadId },
      include: {
        players: {
          include: { user: { include: { identities: true } } },
          orderBy: { turnOrder: 'asc' },
        },
        turnState: true,
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
        'Only the game organizer can replace a player.',
      );
    }

    const seat =
      game.players.find((player) => player.turnOrder === input.seatNumber) ??
      null;

    if (game.playerCount != null && input.seatNumber > game.playerCount) {
      throw new BadRequestException(
        `Seat ${input.seatNumber} exceeds this game's seat limit.`,
      );
    }

    if (seat?.userId != null) {
      throw new ConflictException(
        `Seat ${input.seatNumber} is already occupied.`,
      );
    }

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: input.newPlayerDiscordId,
        },
      },
    });

    if (existingIdentity) {
      const existingMembership = await prisma.gamePlayer.findFirst({
        where: { gameId: game.id, userId: existingIdentity.userId },
      });

      if (existingMembership) {
        throw new ConflictException(
          'This player is already in another seat in this game.',
        );
      }
    }

    const wasActiveSeat =
      seat != null &&
      (game.turnState?.activePlayerEntryId === seat.id ||
        (game.turnState?.activePlayerId != null &&
          game.turnState.activePlayerId === seat.userId));

    const updatedSeat = await prisma.$transaction(async (transaction) => {
      const newPlayer = await upsertDiscordUser(transaction, {
        discordId: input.newPlayerDiscordId,
        displayName: input.newPlayerDisplayName,
      });

      const seatRecord =
        seat ??
        (await transaction.gamePlayer.create({
          data: {
            gameId: game.id,
            userId: null,
            turnOrder: input.seatNumber,
            role: GameRole.PLAYER,
          },
        }));

      const filled = await transaction.gamePlayer.update({
        where: { id: seatRecord.id },
        data: { userId: newPlayer.id },
        include: { user: true },
      });

      if (wasActiveSeat && game.turnState) {
        await transaction.turnState.update({
          where: { gameId: game.id },
          data: {
            activePlayerId: newPlayer.id,
            activePlayerEntryId: seatRecord.id,
          },
        });
      }

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: newPlayer.id,
          eventType: AuditEventType.PLAYER_REPLACED,
          payload: JSON.stringify({
            seatNumber: seatRecord.turnOrder,
            seatEntryId: seatRecord.id,
            newPlayerDiscordId: input.newPlayerDiscordId,
            newPlayerDisplayName: input.newPlayerDisplayName,
            tookActiveTurn: wasActiveSeat,
          }),
        },
      });

      return filled;
    });

    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      player: {
        displayName: updatedSeat.user!.displayName,
        turnOrder: updatedSeat.turnOrder,
        tookActiveTurn: wasActiveSeat,
      },
    };
  }

  async transferHost(
    gameId: string,
    userId: string | undefined,
    input: TransferHostDto,
  ) {
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
          include: {
            user: true,
          },
          orderBy: {
            turnOrder: 'asc',
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
      deniedMessage: 'Only the game organizer can transfer host control.',
    });

    const targetEntry = game.players.find(
      (player) => player.id === input.targetPlayerEntryId,
    );

    if (!targetEntry || !targetEntry.userId || !targetEntry.user) {
      throw new NotFoundException(
        'The selected host transfer target is not an active player in this game.',
      );
    }

    const targetUser = targetEntry.user;

    if (targetEntry.userId === game.organizerId) {
      throw new BadRequestException(
        'Select a different player to transfer host control.',
      );
    }

    const previousOrganizerEntry =
      game.players.find((player) => player.userId === game.organizerId) ?? null;

    await prisma.$transaction(async (transaction) => {
      if (previousOrganizerEntry) {
        await transaction.gamePlayer.update({
          where: { id: previousOrganizerEntry.id },
          data: { role: GameRole.PLAYER },
        });
      }

      await transaction.game.update({
        where: { id: game.id },
        data: { organizerId: targetEntry.userId! },
      });

      await transaction.gamePlayer.update({
        where: { id: targetEntry.id },
        data: { role: GameRole.ORGANIZER },
      });

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: userId,
          eventType: AuditEventType.ROSTER_UPDATED,
          payload: JSON.stringify({
            action: 'host_transferred',
            previousOrganizerEntryId: previousOrganizerEntry?.id ?? null,
            previousOrganizerDisplayName:
              previousOrganizerEntry?.user?.displayName ?? null,
            nextOrganizerEntryId: targetEntry.id,
            nextOrganizerDisplayName: targetUser.displayName,
          }),
        },
      });
    });

    return {
      gameId: game.id,
      gameNumber: game.gameNumber,
      slug: game.slug,
      name: game.name,
      organizerId: targetEntry.userId,
      organizerDisplayName: targetUser.displayName,
      player: {
        displayName: targetUser.displayName,
        turnOrder: targetEntry.turnOrder,
      },
    };
  }

  async resignPlayerFromDiscord(input: ResignDiscordPlayerDto) {
    const game = await prisma.game.findUnique({
      where: { discordThreadId: input.discordThreadId },
      include: {
        players: {
          include: { user: { include: { identities: true } } },
          orderBy: { turnOrder: 'asc' },
        },
        turnState: true,
      },
    });

    if (!game) {
      throw new NotFoundException(
        `Thread ${input.discordThreadId} is not linked to a game.`,
      );
    }

    const resigningIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: input.playerDiscordId,
        },
      },
    });

    const resigningEntry = resigningIdentity
      ? (game.players.find(
          (player) => player.userId === resigningIdentity.userId,
        ) ?? null)
      : null;

    if (!resigningEntry) {
      throw new NotFoundException('Player is not registered in this game.');
    }

    const orderedPlayers = game.players;
    const activePlayers = orderedPlayers.filter(
      (player) => player.userId != null,
    );

    if (activePlayers.length <= 1) {
      throw new BadRequestException(
        'Cannot resign when you are the only active player in the game.',
      );
    }

    const wasOrganizer =
      resigningEntry.role === GameRole.ORGANIZER ||
      game.organizerId === resigningEntry.userId;

    const activeEntry = game.turnState
      ? resolveActivePlayerEntry(game.players, game.turnState)
      : null;
    const isActivePlayer = activeEntry?.id === resigningEntry.id;

    let nextActivePlayer: (typeof orderedPlayers)[number] | null = null;

    if (isActivePlayer && game.turnState) {
      const remainingActivePlayers = orderedPlayers.filter(
        (player) => player.userId != null && player.id !== resigningEntry.id,
      );
      const resigningIndex = orderedPlayers.findIndex(
        (player) => player.id === resigningEntry.id,
      );
      nextActivePlayer =
        remainingActivePlayers[
          resigningIndex % remainingActivePlayers.length
        ] ?? remainingActivePlayers[0];
    }

    await prisma.$transaction(async (transaction) => {
      if (wasOrganizer && resigningEntry.role === GameRole.ORGANIZER) {
        await transaction.gamePlayer.update({
          where: { id: resigningEntry.id },
          data: { role: GameRole.PLAYER },
        });
      }

      if (isActivePlayer && nextActivePlayer && game.turnState) {
        await transaction.turnState.update({
          where: { gameId: game.id },
          data: {
            activePlayerId: nextActivePlayer.userId!,
            activePlayerEntryId: nextActivePlayer.id,
          },
        });
      }

      await transaction.gamePlayer.update({
        where: { id: resigningEntry.id },
        data: { userId: null },
      });

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: resigningIdentity!.userId,
          eventType: AuditEventType.PLAYER_RESIGNED,
          payload: JSON.stringify({
            playerDiscordId: input.playerDiscordId,
            playerDisplayName: resigningEntry.user!.displayName,
            playerEntryId: resigningEntry.id,
            turnOrder: resigningEntry.turnOrder,
            wasOrganizer,
            turnAdvanced: isActivePlayer,
          }),
        },
      });
    });

    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      player: {
        displayName: resigningEntry.user!.displayName,
        turnOrder: resigningEntry.turnOrder,
        wasOrganizer,
      },
    };
  }

  async skipPlayerTurn(input: SkipDiscordPlayerDto) {
    const game = await prisma.game.findUnique({
      where: { discordThreadId: input.discordThreadId },
      include: {
        players: {
          include: { user: { include: { identities: true } } },
          orderBy: { turnOrder: 'asc' },
        },
        turnState: true,
      },
    });

    if (!game) {
      throw new NotFoundException(
        `Thread ${input.discordThreadId} is not linked to a game.`,
      );
    }

    if (!game.turnState) {
      throw new BadRequestException(
        'This game has no active turn state. Upload a save file to start turns.',
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
        'Only the game organizer can skip a player.',
      );
    }

    const targetEntry = resolveActivePlayerEntry(game.players, game.turnState);

    if (!targetEntry) {
      throw new BadRequestException('No active player found for this game.');
    }

    const activePlayers = game.players.filter(
      (player) => player.userId != null,
    );

    if (activePlayers.length <= 1) {
      throw new BadRequestException(
        'Cannot skip when there is only one active player.',
      );
    }

    const targetIndex = game.players.findIndex(
      (player) => player.id === targetEntry.id,
    );
    const remaining = activePlayers.filter(
      (player) => player.id !== targetEntry.id,
    );
    const nextActivePlayer =
      remaining.find(
        (player) =>
          game.players.findIndex((candidate) => candidate.id === player.id) >
          targetIndex,
      ) ?? remaining[0];

    await prisma.$transaction(async (transaction) => {
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: {
          activePlayerId: nextActivePlayer.userId!,
          activePlayerEntryId: nextActivePlayer.id,
        },
      });

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: callerIdentity.userId,
          eventType: AuditEventType.TURN_SKIPPED,
          payload: JSON.stringify({
            skippedPlayerDisplayName: targetEntry.user?.displayName ?? null,
            skippedPlayerTurnOrder: targetEntry.turnOrder,
            nextPlayerDisplayName: nextActivePlayer.user?.displayName ?? null,
            nextPlayerTurnOrder: nextActivePlayer.turnOrder,
          }),
        },
      });
    });

    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      skippedPlayer: {
        displayName: targetEntry.user?.displayName ?? null,
        turnOrder: targetEntry.turnOrder,
      },
      nextPlayer: {
        displayName: nextActivePlayer.user?.displayName ?? null,
        discordId:
          nextActivePlayer.user?.identities?.find(
            (identity) => identity.provider === 'discord',
          )?.providerId ?? null,
        turnOrder: nextActivePlayer.turnOrder,
      },
    };
  }
}
