import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import {
  AuditEventType,
  GameRole,
  prisma,
  TurnCompletionReason,
  type Prisma,
} from '../../database';
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
import type {
  UploadedSaveFile,
  UploadSaveSafetyMetadata,
} from '../support/game-payload.types';
import { resolveUploadSaveNaming } from '../support/upload-save-naming';
import { resolveActivePlayerEntry } from '../support/turn-state.utils';
import { TurnRecordsService } from './turn-records.service';

@Injectable()
export class GamesTurnService {
  constructor(
    private readonly authService: AuthService,
    private readonly fileStorage: FileStorageService,
    private readonly botNotifications: BotNotificationsService,
    private readonly turnRecords: TurnRecordsService,
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

  private async revalidateTurnSnapshot(
    transaction: Prisma.TransactionClient,
    input: {
      gameId: string;
      expectedTurnState: {
        activePlayerId: string;
        activePlayerEntryId: string | null;
        roundNumber: number;
      } | null;
      expectedActiveSeat: { id: string; userId: string | null } | null;
    },
  ) {
    const turnState = await transaction.turnState.findUnique({
      where: { gameId: input.gameId },
    });
    const players = await transaction.gamePlayer.findMany({
      where: { gameId: input.gameId },
      include: { user: true },
      orderBy: { turnOrder: 'asc' },
    });

    if (
      (input.expectedTurnState == null && turnState != null) ||
      (input.expectedTurnState != null &&
        (turnState == null ||
          turnState.activePlayerId !== input.expectedTurnState.activePlayerId ||
          turnState.activePlayerEntryId !==
            input.expectedTurnState.activePlayerEntryId ||
          turnState.roundNumber !== input.expectedTurnState.roundNumber))
    ) {
      throw new ConflictException(
        'The active turn changed before updating it.',
      );
    }

    if (!turnState) {
      return { turnState, players, activeSeat: null };
    }

    const activeSeat = resolveActivePlayerEntry(players, turnState);

    if (
      !activeSeat ||
      !input.expectedActiveSeat ||
      activeSeat.id !== input.expectedActiveSeat.id ||
      activeSeat.userId !== input.expectedActiveSeat.userId
    ) {
      throw new ConflictException('The active turn could not be resolved.');
    }

    return { turnState, players, activeSeat };
  }

  private revalidateNextPlayer<
    T extends {
      id: string;
      userId: string | null;
      turnOrder: number;
      user: { displayName: string } | null;
    },
  >(
    players: T[],
    activeSeat: { id: string },
    expected: {
      id: string;
      userId: string;
      turnOrder: number;
      playerDisplayName: string;
    },
  ) {
    const occupiedPlayers = [...players]
      .filter((player) => player.userId != null)
      .sort((left, right) => left.turnOrder - right.turnOrder);
    const activePlayerIndex = occupiedPlayers.findIndex(
      (player) => player.id === activeSeat.id,
    );

    if (activePlayerIndex === -1) {
      throw new ConflictException(
        'The active player changed before advancing.',
      );
    }

    const nextPlayer =
      occupiedPlayers[(activePlayerIndex + 1) % occupiedPlayers.length];

    if (
      !nextPlayer ||
      nextPlayer.id !== expected.id ||
      nextPlayer.userId !== expected.userId ||
      nextPlayer.turnOrder !== expected.turnOrder ||
      nextPlayer.user?.displayName !== expected.playerDisplayName
    ) {
      throw new ConflictException('The next player changed before advancing.');
    }

    return {
      nextPlayer,
      roundAdvanced: activePlayerIndex === occupiedPlayers.length - 1,
    };
  }

  async uploadSave(
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

    if (metadata.idempotencyKey) {
      const existingUpload = await prisma.fileVersion.findFirst({
        where: {
          gameId: game.id,
          uploadedById: userId,
          idempotencyKey: metadata.idempotencyKey,
        },
      });

      if (existingUpload) {
        return {
          fileVersionId: existingUpload.id,
          versionNumber: existingUpload.versionNumber,
          originalName: existingUpload.originalName,
          roundNumber: game.turnState?.roundNumber ?? 1,
          roundAdvanced: false,
          activePlayer: null,
          idempotentReplay: true,
        };
      }
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

    if (
      (metadata.expectedActivePlayerEntryId != null &&
        metadata.expectedActivePlayerEntryId !== activePlayerEntry.id) ||
      (metadata.expectedActivePlayerUserId != null &&
        metadata.expectedActivePlayerUserId !== activePlayerEntry.userId) ||
      (metadata.expectedRoundNumber != null &&
        metadata.expectedRoundNumber !== game.turnState.roundNumber)
    ) {
      throw new ConflictException('The turn changed before this upload.');
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
    const roundAdvanced =
      uploadSaveNaming.nextActivePlayer.id === firstPlayer.id;
    const storedFileRoundNumber =
      game.turnState.roundNumber + (roundAdvanced ? 1 : 0);

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

        if (
          metadata.expectedLatestFileVersionId !== undefined &&
          (latestVersion?.id ?? null) !== metadata.expectedLatestFileVersionId
        ) {
          throw new ConflictException(
            'A newer save was uploaded before this upload.',
          );
        }

        const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
        const storedFile = await this.fileStorage.storeFile({
          gameId: game.id,
          gameNumber: game.gameNumber,
          turn: storedFileRoundNumber,
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
            contentHash: metadata.contentHash,
            idempotencyKey: metadata.idempotencyKey,
            clientOriginalName: file.originalname,
            clientFileSize: file.size,
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
        const revalidated = await this.revalidateTurnSnapshot(transaction, {
          gameId: game.id,
          expectedTurnState: game.turnState,
          expectedActiveSeat: activePlayerEntry,
        });
        const activeSeat = revalidated.activeSeat;

        if (!activeSeat) {
          throw new ConflictException('The active turn could not be resolved.');
        }

        const {
          nextPlayer: revalidatedNextPlayer,
          roundAdvanced: revalidatedRoundAdvanced,
        } = this.revalidateNextPlayer(revalidated.players, activeSeat, {
          id: uploadSaveNaming.nextActivePlayer.id,
          userId: uploadSaveNaming.nextActivePlayer.userId!,
          turnOrder: uploadSaveNaming.nextActivePlayer.turnOrder,
          playerDisplayName: uploadSaveNaming.nextActivePlayer.displayName!,
        });

        if (revalidatedRoundAdvanced !== roundAdvanced) {
          throw new ConflictException(
            'The turn order changed before this upload.',
          );
        }
        const nextActivePlayer = {
          id: revalidatedNextPlayer.id,
          userId: revalidatedNextPlayer.userId!,
          displayName: revalidatedNextPlayer.user!.displayName,
          turnOrder: revalidatedNextPlayer.turnOrder,
          isOrganizer:
            revalidatedNextPlayer.role === GameRole.ORGANIZER ||
            game.organizerId === revalidatedNextPlayer.userId,
        };
        const updatedTurnState = await transaction.turnState.update({
          where: {
            gameId: game.id,
          },
          data: {
            activePlayerId: nextActivePlayer.userId,
            activePlayerEntryId: nextActivePlayer.id,
            roundNumber: {
              increment: revalidatedRoundAdvanced ? 1 : 0,
            },
          },
        });
        const transitionedAt = new Date();

        await this.turnRecords.transitionTurn(transaction, {
          gameId: game.id,
          expectedCurrent: {
            gamePlayerId: activePlayerEntry.id,
            userId: activePlayerEntry.userId!,
            roundNumber: game.turnState!.roundNumber,
          },
          next: {
            gamePlayerId: nextActivePlayer.id,
            userId: nextActivePlayer.userId,
            seatNumber: nextActivePlayer.turnOrder,
            playerDisplayName: nextActivePlayer.displayName,
            roundNumber: updatedTurnState.roundNumber,
          },
          completionReason: TurnCompletionReason.SAVE_UPLOADED,
          transitionedAt,
          policy: game,
        });

        await transaction.auditEvent.create({
          data: {
            gameId: game.id,
            actorId: userId,
            eventType: AuditEventType.TURN_ADVANCED,
            payload: JSON.stringify({
              previousActivePlayerEntryId: activePlayerEntry.id,
              previousActivePlayerUserId: activePlayerEntry.userId,
              nextActivePlayerEntryId: nextActivePlayer.id,
              nextActivePlayerUserId: nextActivePlayer.userId,
              roundNumber: updatedTurnState.roundNumber,
              roundAdvanced: revalidatedRoundAdvanced,
              fileVersionId: fileVersion.id,
            }),
          },
        });

        return {
          fileVersion,
          versionNumber,
          nextActivePlayer,
          roundNumber: updatedTurnState.roundNumber,
          roundAdvanced: revalidatedRoundAdvanced,
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
            id: result.nextActivePlayer.userId,
            displayName: result.nextActivePlayer.displayName,
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
      throw new BadRequestException(
        'Occupied seats must be cleared and saved before they can be removed.',
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
        role: uniqueClearedSeatIds.has(seatEntryId)
          ? GameRole.PLAYER
          : seat.role,
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
      const revalidated = await this.revalidateTurnSnapshot(transaction, {
        gameId: game.id,
        expectedTurnState: game.turnState,
        expectedActiveSeat: currentActiveSeat,
      });

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
            role: seat.role,
          },
        });
      }

      const activeSeat = revalidated.activeSeat;

      if (revalidated.turnState && activeSeat && nextActiveSeat) {
        const transitionedAt = new Date();

        if (activeSeat.id !== nextActiveSeat.id) {
          await transaction.turnState.update({
            where: { gameId: game.id },
            data: {
              activePlayerId: nextActiveSeat.userId!,
              activePlayerEntryId: nextActiveSeat.id,
            },
          });

          await this.turnRecords.transitionTurn(transaction, {
            gameId: game.id,
            expectedCurrent: {
              gamePlayerId: activeSeat.id,
              userId: activeSeat.userId!,
              roundNumber: revalidated.turnState.roundNumber,
            },
            next: {
              gamePlayerId: nextActiveSeat.id,
              userId: nextActiveSeat.userId,
              seatNumber: nextActiveSeat.turnOrder,
              playerDisplayName: nextActiveSeat.user!.displayName,
              roundNumber: revalidated.turnState.roundNumber,
            },
            completionReason: TurnCompletionReason.REASSIGNED,
            transitionedAt,
            policy: game,
          });
        }
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

    let wasActiveSeat = false;

    const updatedSeat = await prisma.$transaction(async (transaction) => {
      const revalidated = await this.revalidateTurnSnapshot(transaction, {
        gameId: game.id,
        expectedTurnState: game.turnState,
        expectedActiveSeat: game.turnState
          ? resolveActivePlayerEntry(game.players, game.turnState)
          : null,
      });
      const currentSeat =
        revalidated.players.find(
          (player) => player.turnOrder === input.seatNumber,
        ) ?? null;

      if (
        currentSeat?.id !== seat?.id ||
        currentSeat?.userId !== seat?.userId
      ) {
        throw new ConflictException(
          'The selected seat changed before replacement.',
        );
      }

      const newPlayer = await upsertDiscordUser(transaction, {
        discordId: input.newPlayerDiscordId,
        displayName: input.newPlayerDisplayName,
      });

      const seatRecord =
        currentSeat ??
        (await transaction.gamePlayer.create({
          data: {
            gameId: game.id,
            userId: null,
            turnOrder: input.seatNumber,
            role: GameRole.PLAYER,
          },
        }));

      wasActiveSeat = revalidated.activeSeat?.id === seatRecord.id;

      if (wasActiveSeat && revalidated.turnState && seatRecord.userId) {
        const transitionedAt = new Date();

        await this.turnRecords.transitionTurn(transaction, {
          gameId: game.id,
          expectedCurrent: {
            gamePlayerId: seatRecord.id,
            userId: seatRecord.userId,
            roundNumber: revalidated.turnState.roundNumber,
          },
          next: {
            gamePlayerId: seatRecord.id,
            userId: newPlayer.id,
            seatNumber: seatRecord.turnOrder,
            playerDisplayName: newPlayer.displayName,
            roundNumber: revalidated.turnState.roundNumber,
          },
          completionReason: TurnCompletionReason.REPLACED,
          transitionedAt,
          policy: game,
        });
      }

      const filled = await transaction.gamePlayer.update({
        where: { id: seatRecord.id },
        data: { userId: newPlayer.id },
        include: { user: true },
      });

      if (wasActiveSeat && revalidated.turnState) {
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

    const wasOrganizer =
      resigningEntry.role === GameRole.ORGANIZER ||
      game.organizerId === resigningEntry.userId;

    await prisma.$transaction(async (transaction) => {
      const revalidated = await this.revalidateTurnSnapshot(transaction, {
        gameId: game.id,
        expectedTurnState: game.turnState,
        expectedActiveSeat: game.turnState
          ? resolveActivePlayerEntry(game.players, game.turnState)
          : null,
      });
      const currentResigningEntry = revalidated.players.find(
        (player) => player.id === resigningEntry.id,
      );

      if (
        !currentResigningEntry ||
        currentResigningEntry.userId !== resigningEntry.userId
      ) {
        throw new ConflictException(
          'The resigning player changed before removal.',
        );
      }

      const activePlayers = revalidated.players.filter(
        (player) => player.userId != null,
      );

      if (activePlayers.length <= 1) {
        throw new BadRequestException(
          'Cannot resign when you are the only active player in the game.',
        );
      }

      const isActivePlayer =
        revalidated.activeSeat?.id === currentResigningEntry.id;
      const remainingActivePlayers = activePlayers.filter(
        (player) => player.id !== currentResigningEntry.id,
      );
      const resigningIndex = revalidated.players.findIndex(
        (player) => player.id === currentResigningEntry.id,
      );
      const nextActivePlayer = isActivePlayer
        ? (remainingActivePlayers[
            resigningIndex % remainingActivePlayers.length
          ] ?? remainingActivePlayers[0])
        : null;

      if (wasOrganizer && resigningEntry.role === GameRole.ORGANIZER) {
        await transaction.gamePlayer.update({
          where: { id: resigningEntry.id },
          data: { role: GameRole.PLAYER },
        });
      }

      if (isActivePlayer && nextActivePlayer && revalidated.turnState) {
        const transitionedAt = new Date();

        await transaction.turnState.update({
          where: { gameId: game.id },
          data: {
            activePlayerId: nextActivePlayer.userId!,
            activePlayerEntryId: nextActivePlayer.id,
          },
        });

        await this.turnRecords.transitionTurn(transaction, {
          gameId: game.id,
          expectedCurrent: {
            gamePlayerId: resigningEntry.id,
            userId: resigningEntry.userId!,
            roundNumber: revalidated.turnState.roundNumber,
          },
          next: {
            gamePlayerId: nextActivePlayer.id,
            userId: nextActivePlayer.userId,
            seatNumber: nextActivePlayer.turnOrder,
            playerDisplayName: nextActivePlayer.user!.displayName,
            roundNumber: revalidated.turnState.roundNumber,
          },
          completionReason: TurnCompletionReason.RESIGNED,
          transitionedAt,
          policy: game,
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
      const revalidated = await this.revalidateTurnSnapshot(transaction, {
        gameId: game.id,
        expectedTurnState: game.turnState,
        expectedActiveSeat: targetEntry,
      });
      const activeSeat = revalidated.activeSeat;

      if (!activeSeat) {
        throw new ConflictException('The active turn could not be resolved.');
      }

      const { nextPlayer: revalidatedNextPlayer } = this.revalidateNextPlayer(
        revalidated.players,
        activeSeat,
        {
          id: nextActivePlayer.id,
          userId: nextActivePlayer.userId!,
          turnOrder: nextActivePlayer.turnOrder,
          playerDisplayName: nextActivePlayer.user!.displayName,
        },
      );
      const transitionedAt = new Date();

      await transaction.turnState.update({
        where: { gameId: game.id },
        data: {
          activePlayerId: revalidatedNextPlayer.userId!,
          activePlayerEntryId: revalidatedNextPlayer.id,
        },
      });

      await this.turnRecords.transitionTurn(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: activeSeat.id,
          userId: activeSeat.userId!,
          roundNumber: revalidated.turnState.roundNumber,
        },
        next: {
          gamePlayerId: revalidatedNextPlayer.id,
          userId: revalidatedNextPlayer.userId,
          seatNumber: revalidatedNextPlayer.turnOrder,
          playerDisplayName: revalidatedNextPlayer.user!.displayName,
          roundNumber: revalidated.turnState.roundNumber,
        },
        completionReason: TurnCompletionReason.SKIPPED,
        transitionedAt,
        policy: game,
      });

      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: callerIdentity.userId,
          eventType: AuditEventType.TURN_SKIPPED,
          payload: JSON.stringify({
            skippedPlayerDisplayName: targetEntry.user?.displayName ?? null,
            skippedPlayerTurnOrder: targetEntry.turnOrder,
            nextPlayerDisplayName:
              revalidatedNextPlayer.user?.displayName ?? null,
            nextPlayerTurnOrder: revalidatedNextPlayer.turnOrder,
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
