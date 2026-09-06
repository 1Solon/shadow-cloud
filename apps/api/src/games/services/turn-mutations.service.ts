import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  type Prisma,
  PrismaClient,
  TurnCompletionReason,
} from '@prisma/client';
import type { SkipDiscordPlayerDto } from '../dto/skip-discord-player.dto';
import { TurnRecordsService } from './turn-records.service';
import type { TurnMutationDependencies } from './turn-mutations/dependencies';
import { uploadSave } from './turn-mutations/upload';
import type {
  UploadedSaveFile,
  UploadSaveSafetyMetadata,
} from '../support/game-payload.types';
import type { ReorderSeatOrderDto } from '../dto/reorder-seat-order.dto';
import { getSeatOrder, reorderSeatOrder } from './turn-mutations/seat-order';
import type { ReplaceDiscordPlayerDto } from '../dto/replace-discord-player.dto';
import {
  replacePlayerInSeat,
  resignPlayerFromDiscord,
} from './turn-mutations/membership';
import type { ResignDiscordPlayerDto } from '../dto/resign-discord-player.dto';
import type { CreateDiscordGameDto } from '../dto/create-discord-game.dto';
import {
  approveRegistrationRequest,
  createGameFromDiscordInit,
  rejectRegistrationRequest,
} from './turn-mutations/registration';
import {
  transferHost,
  updateGameMetadata,
} from './turn-mutations/administration';
import type { TransferHostDto } from '../dto/transfer-host.dto';
import type { UpdateGameMetadataDto } from '../dto/update-game-metadata.dto';

const skipGameInclude = {
  players: {
    include: { user: { include: { identities: true } } },
    orderBy: { turnOrder: 'asc' },
  },
  turnState: true,
} satisfies Prisma.GameInclude;

type SkipGame = Prisma.GameGetPayload<{ include: typeof skipGameInclude }>;

/** Owns turn-changing decisions and their coupled persistence, not transport. */
export class TurnMutationsService {
  constructor(
    private readonly database: PrismaClient,
    private readonly turnRecords: TurnRecordsService,
    private readonly dependencies: TurnMutationDependencies = {},
  ) {}

  async transferHost(
    gameId: string,
    userId: string | undefined,
    input: TransferHostDto,
  ) {
    return transferHost(
      this.database,
      this.turnRecords,
      this.dependencies,
      gameId,
      userId,
      input,
    );
  }

  async updateGameMetadata(
    gameId: string,
    userId: string | undefined,
    input: UpdateGameMetadataDto,
  ) {
    return updateGameMetadata(
      this.database,
      this.turnRecords,
      this.dependencies,
      gameId,
      userId,
      input,
    );
  }

  async rejectRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
    approverDiscordId?: string,
  ) {
    return rejectRegistrationRequest(
      this.database,
      requestId,
      discordMessageId,
      approverDiscordId,
    );
  }

  async approveRegistrationRequest(
    requestId: string,
    discordMessageId?: string,
    approverDiscordId?: string,
  ) {
    return approveRegistrationRequest(
      this.database,
      this.turnRecords,
      requestId,
      discordMessageId,
      approverDiscordId,
    );
  }

  async createGameFromDiscordInit(input: CreateDiscordGameDto) {
    return createGameFromDiscordInit(
      this.database,
      this.turnRecords,
      this.dependencies,
      input,
    );
  }

  async replacePlayerInSeat(input: ReplaceDiscordPlayerDto) {
    return replacePlayerInSeat(this.database, this.turnRecords, input);
  }

  async resignPlayerFromDiscord(input: ResignDiscordPlayerDto) {
    return resignPlayerFromDiscord(this.database, this.turnRecords, input);
  }

  async getSeatOrder(gameId: string, userId: string | undefined) {
    return getSeatOrder(this.database, this.dependencies, gameId, userId);
  }

  async reorderSeatOrder(
    gameId: string,
    userId: string | undefined,
    input: ReorderSeatOrderDto,
  ) {
    return reorderSeatOrder(
      this.database,
      this.turnRecords,
      this.dependencies,
      gameId,
      userId,
      input,
    );
  }

  uploadSave(
    gameId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
    metadata: UploadSaveSafetyMetadata = {},
  ) {
    return uploadSave(
      this.database,
      this.turnRecords,
      this.dependencies,
      gameId,
      userId,
      file,
      metadata,
    );
  }

  async skipPlayerTurn(input: SkipDiscordPlayerDto) {
    const observed = await this.findSkipGame(
      this.database,
      input.discordThreadId,
    );
    await this.authorizeSkip(this.database, observed, input.callerDiscordId);
    const expected = this.skipParticipants(observed);

    return this.database.$transaction(async (transaction) => {
      // Reserve this revision before reading the proof. SQLite's write lock then
      // prevents even not-yet-migrated writers from changing local facts before
      // commit. A failed proof rolls this increment back. Never retry an intent.
      const fenced = await transaction.game.updateMany({
        where: { id: observed.id, turnRevision: observed.turnRevision },
        data: { turnRevision: { increment: 1 } },
      });
      const game = await this.findSkipGame(transaction, input.discordThreadId);
      const callerIdentity = await this.authorizeSkip(
        transaction,
        game,
        input.callerDiscordId,
      );
      const { active, next, turnState } = this.skipParticipants(game, true);
      if (
        fenced.count !== 1 ||
        game.id !== observed.id ||
        turnState.activePlayerEntryId !==
          expected.turnState.activePlayerEntryId ||
        turnState.roundNumber !== expected.turnState.roundNumber ||
        active.id !== expected.active.id ||
        active.userId !== expected.active.userId ||
        active.turnOrder !== expected.active.turnOrder ||
        next.id !== expected.next.id ||
        next.userId !== expected.next.userId ||
        next.turnOrder !== expected.next.turnOrder
      ) {
        throw new ConflictException(
          'The active turn or next player changed before advancing.',
        );
      }
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: { activePlayerId: next.userId!, activePlayerEntryId: next.id },
      });
      await this.turnRecords.transitionTurn(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: active.id,
          userId: active.userId!,
          roundNumber: turnState.roundNumber,
        },
        next: {
          gamePlayerId: next.id,
          userId: next.userId,
          seatNumber: next.turnOrder,
          playerDisplayName: next.user!.displayName,
          roundNumber: turnState.roundNumber,
        },
        completionReason: TurnCompletionReason.SKIPPED,
        transitionedAt: new Date(),
      });
      await transaction.auditEvent.create({
        data: {
          gameId: game.id,
          actorId: callerIdentity.userId,
          eventType: AuditEventType.TURN_SKIPPED,
          payload: JSON.stringify({
            skippedPlayerDisplayName: active.user?.displayName ?? null,
            skippedPlayerTurnOrder: active.turnOrder,
            nextPlayerDisplayName: next.user?.displayName ?? null,
            nextPlayerTurnOrder: next.turnOrder,
          }),
        },
      });
      return {
        gameId: game.id,
        slug: game.slug,
        name: game.name,
        skippedPlayer: {
          displayName: active.user?.displayName ?? null,
          turnOrder: active.turnOrder,
        },
        nextPlayer: {
          displayName: next.user?.displayName ?? null,
          discordId:
            next.user?.identities.find(
              (identity) => identity.provider === 'discord',
            )?.providerId ?? null,
          turnOrder: next.turnOrder,
        },
      };
    });
  }

  private async findSkipGame(
    database: Prisma.TransactionClient,
    discordThreadId: string,
  ) {
    const game = await database.game.findUnique({
      where: { discordThreadId },
      include: skipGameInclude,
    });
    if (!game) {
      throw new NotFoundException(
        `Thread ${discordThreadId} is not linked to a game.`,
      );
    }
    if (!game.turnState) {
      throw new BadRequestException(
        'This game has no active turn state. Upload a save file to start turns.',
      );
    }
    return game;
  }

  private async authorizeSkip(
    database: Prisma.TransactionClient,
    game: SkipGame,
    callerDiscordId: string,
  ) {
    const identity = await database.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: callerDiscordId,
        },
      },
    });
    if (!identity || identity.userId !== game.organizerId) {
      throw new ForbiddenException(
        'Only the game organizer can skip a player.',
      );
    }
    return identity;
  }

  private skipParticipants(game: SkipGame, revalidating = false) {
    const InvalidParticipant = revalidating
      ? ConflictException
      : BadRequestException;
    const turnState = game.turnState;
    const occupied = game.players.filter((seat) => seat.userId != null);
    // Older initialized campaigns can lack the seat reference. Resolve only a
    // unique occupant in that case; never hide an invalid explicit reference.
    const matchingSeats = occupied.filter((seat) =>
      turnState?.activePlayerEntryId != null
        ? seat.id === turnState.activePlayerEntryId
        : seat.userId === turnState?.activePlayerId,
    );
    const activeIndex =
      matchingSeats.length === 1
        ? occupied.findIndex((seat) => seat.id === matchingSeats[0].id)
        : -1;
    const active = occupied[activeIndex];
    if (!turnState || !active || active.userId !== turnState.activePlayerId) {
      throw new InvalidParticipant('No active player found for this game.');
    }
    if (occupied.length <= 1) {
      throw new InvalidParticipant(
        'Cannot skip when there is only one active player.',
      );
    }
    return {
      active,
      next: occupied[(activeIndex + 1) % occupied.length],
      turnState,
    };
  }
}
