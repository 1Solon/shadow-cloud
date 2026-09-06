import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  GameRole,
  type Prisma,
  type PrismaClient,
  TurnCompletionReason,
} from '@prisma/client';
import type { ReplaceDiscordPlayerDto } from '../../dto/replace-discord-player.dto';
import type { ResignDiscordPlayerDto } from '../../dto/resign-discord-player.dto';
import { upsertDiscordUser } from '../../support/discord-user.helpers';
import type { TurnRecordsService } from '../turn-records.service';

async function findGame(
  database: Prisma.TransactionClient,
  discordThreadId: string,
) {
  const game = await database.game.findUnique({
    where: { discordThreadId },
    include: {
      players: { include: { user: true }, orderBy: { turnOrder: 'asc' } },
      turnState: true,
    },
  });
  if (!game)
    throw new NotFoundException(
      `Thread ${discordThreadId} is not linked to a game.`,
    );
  return game;
}

type MembershipGame = Awaited<ReturnType<typeof findGame>>;

function activeSeat(game: MembershipGame) {
  if (!game.turnState) return null;
  const state = game.turnState;
  const matches = game.players.filter(
    (seat) =>
      seat.userId != null &&
      (state.activePlayerEntryId != null
        ? seat.id === state.activePlayerEntryId
        : seat.userId === state.activePlayerId),
  );
  if (matches.length !== 1 || matches[0].userId !== state.activePlayerId) {
    throw new ConflictException('The active turn could not be resolved.');
  }
  return matches[0];
}

function participantFacts(game: MembershipGame) {
  // Include open seats and roles: they can change the target or successor even
  // when a legacy writer has not advanced the revision. Ignore cosmetic data.
  return JSON.stringify({
    id: game.id,
    organizerId: game.organizerId,
    playerCount: game.playerCount,
    seats: game.players.map(({ id, userId, turnOrder, role }) => ({
      id,
      userId,
      turnOrder,
      role,
    })),
    turn: game.turnState && {
      activePlayerId: game.turnState.activePlayerId,
      activePlayerEntryId: game.turnState.activePlayerEntryId,
      roundNumber: game.turnState.roundNumber,
    },
  });
}

async function discordIdentity(
  database: Prisma.TransactionClient,
  discordId: string,
) {
  return database.authIdentity.findUnique({
    where: {
      provider_providerId: { provider: 'discord', providerId: discordId },
    },
  });
}

async function authorizeReplacement(
  database: Prisma.TransactionClient,
  game: MembershipGame,
  input: ReplaceDiscordPlayerDto,
) {
  const caller = await discordIdentity(database, input.callerDiscordId);
  if (!caller || caller.userId !== game.organizerId) {
    throw new ForbiddenException(
      'Only the game organizer can replace a player.',
    );
  }
  if (game.playerCount != null && input.seatNumber > game.playerCount) {
    throw new BadRequestException(
      `Seat ${input.seatNumber} exceeds this game's seat limit.`,
    );
  }
  const identity = await discordIdentity(database, input.newPlayerDiscordId);
  const userId =
    identity?.userId ??
    (
      await database.user.findUnique({
        where: {
          email: `${input.newPlayerDiscordId}@discord.shadow-cloud.local`,
        },
      })
    )?.id ??
    null;
  if (userId && game.players.some((seat) => seat.userId === userId)) {
    throw new ConflictException(
      'This player is already in another seat in this game.',
    );
  }
  return userId;
}

async function fenceGame(
  transaction: Prisma.TransactionClient,
  observed: MembershipGame,
) {
  // Take SQLite's write lock before reading the transaction-local proof.
  const fenced = await transaction.game.updateMany({
    where: { id: observed.id, turnRevision: observed.turnRevision },
    data: { turnRevision: { increment: 1 } },
  });
  return {
    game: await findGame(transaction, observed.discordThreadId!),
    revisionMatched: fenced.count === 1,
  };
}

export async function replacePlayerInSeat(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  input: ReplaceDiscordPlayerDto,
) {
  const observed = await findGame(database, input.discordThreadId);
  const expectedUserId = await authorizeReplacement(database, observed, input);
  activeSeat(observed);
  return database.$transaction(async (transaction) => {
    const { game, revisionMatched } = await fenceGame(transaction, observed);
    const userId = await authorizeReplacement(transaction, game, input);
    if (
      !revisionMatched ||
      participantFacts(game) !== participantFacts(observed) ||
      userId !== expectedUserId
    ) {
      throw new ConflictException(
        'The selected seat or active turn changed before replacement.',
      );
    }
    await turnRecords.assertCurrentTurn(transaction, game.id);
    const active = activeSeat(game);
    const newPlayer = await upsertDiscordUser(transaction, {
      discordId: input.newPlayerDiscordId,
      displayName: input.newPlayerDisplayName,
    });
    const seat =
      game.players.find((player) => player.turnOrder === input.seatNumber) ??
      (await transaction.gamePlayer.create({
        data: {
          gameId: game.id,
          turnOrder: input.seatNumber,
          role: GameRole.PLAYER,
        },
      }));
    const tookActiveTurn = active?.id === seat.id;
    if (tookActiveTurn && game.turnState) {
      await turnRecords.transitionTurn(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: seat.id,
          userId: seat.userId!,
          roundNumber: game.turnState.roundNumber,
        },
        next: {
          gamePlayerId: seat.id,
          userId: newPlayer.id,
          seatNumber: seat.turnOrder,
          playerDisplayName: newPlayer.displayName,
          roundNumber: game.turnState.roundNumber,
        },
        completionReason: TurnCompletionReason.REPLACED,
        transitionedAt: new Date(),
      });
    }
    await transaction.gamePlayer.update({
      where: { id: seat.id },
      data: { userId: newPlayer.id },
    });
    if (tookActiveTurn && game.turnState) {
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: {
          activePlayerId: newPlayer.id,
          activePlayerEntryId: seat.id,
        },
      });
    }
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: newPlayer.id,
        eventType: AuditEventType.PLAYER_REPLACED,
        payload: JSON.stringify({
          seatNumber: seat.turnOrder,
          seatEntryId: seat.id,
          newPlayerDiscordId: input.newPlayerDiscordId,
          newPlayerDisplayName: input.newPlayerDisplayName,
          tookActiveTurn,
        }),
      },
    });
    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      player: {
        displayName: newPlayer.displayName,
        turnOrder: seat.turnOrder,
        tookActiveTurn,
      },
    };
  });
}

export async function resignPlayerFromDiscord(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  input: ResignDiscordPlayerDto,
) {
  const observed = await findGame(database, input.discordThreadId);
  const identity = await discordIdentity(database, input.playerDiscordId);
  const expectedSeat = observed.players.find(
    (seat) => identity != null && seat.userId === identity.userId,
  );
  if (!expectedSeat)
    throw new NotFoundException('Player is not registered in this game.');
  activeSeat(observed);
  return database.$transaction(async (transaction) => {
    const { game, revisionMatched } = await fenceGame(transaction, observed);
    const currentIdentity = await discordIdentity(
      transaction,
      input.playerDiscordId,
    );
    const seat = game.players.find((player) => player.id === expectedSeat.id);
    if (
      !revisionMatched ||
      !currentIdentity ||
      currentIdentity.userId !== identity!.userId ||
      !seat ||
      seat.userId !== currentIdentity.userId ||
      participantFacts(game) !== participantFacts(observed)
    ) {
      throw new ConflictException(
        'The resigning player or active turn changed before removal.',
      );
    }
    const occupied = game.players.filter((player) => player.userId != null);
    if (
      occupied.filter((player) => player.userId === currentIdentity.userId)
        .length !== 1
    ) {
      throw new ConflictException(
        'The resigning player has an ambiguous membership.',
      );
    }
    if (occupied.length <= 1) {
      throw new BadRequestException(
        'Cannot resign when you are the only active player in the game.',
      );
    }
    await turnRecords.assertCurrentTurn(transaction, game.id);
    const active = activeSeat(game);
    const turnAdvanced = active?.id === seat.id;
    const wasOrganizer =
      seat.role === GameRole.ORGANIZER || game.organizerId === seat.userId;
    if (turnAdvanced && game.turnState) {
      const next =
        occupied[
          (occupied.findIndex((player) => player.id === seat.id) + 1) %
            occupied.length
        ];
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: {
          activePlayerId: next.userId!,
          activePlayerEntryId: next.id,
        },
      });
      await turnRecords.transitionTurn(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: seat.id,
          userId: seat.userId,
          roundNumber: game.turnState.roundNumber,
        },
        next: {
          gamePlayerId: next.id,
          userId: next.userId,
          seatNumber: next.turnOrder,
          playerDisplayName: next.user!.displayName,
          roundNumber: game.turnState.roundNumber,
        },
        completionReason: TurnCompletionReason.RESIGNED,
        transitionedAt: new Date(),
      });
    }
    await transaction.gamePlayer.update({
      where: { id: seat.id },
      data: { userId: null, role: GameRole.PLAYER },
    });
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: currentIdentity.userId,
        eventType: AuditEventType.PLAYER_RESIGNED,
        payload: JSON.stringify({
          playerDiscordId: input.playerDiscordId,
          playerDisplayName: seat.user!.displayName,
          playerEntryId: seat.id,
          turnOrder: seat.turnOrder,
          wasOrganizer,
          turnAdvanced,
        }),
      },
    });
    return {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      player: {
        displayName: seat.user!.displayName,
        turnOrder: seat.turnOrder,
        wasOrganizer,
      },
    };
  });
}
