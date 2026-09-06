import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditEventType,
  GameRole,
  type Prisma,
  type PrismaClient,
  TurnCompletionReason,
} from '@prisma/client';
import type { ReorderSeatOrderDto } from '../../dto/reorder-seat-order.dto';
import type { SeatOrderSnapshot } from '../../games.types';
import { buildGameIdentifierWhere } from '../../support/game-lookup.helpers';
import type { TurnRecordsService } from '../turn-records.service';
import type { TurnMutationDependencies } from './dependencies';

const include = {
  players: { include: { user: true }, orderBy: { turnOrder: 'asc' } },
  turnState: true,
} satisfies Prisma.GameInclude;

function snapshot(
  game: Prisma.GameGetPayload<{ include: typeof include }>,
): SeatOrderSnapshot {
  const state = game.turnState;
  const activeSeats = state
    ? game.players.filter(
        (seat) =>
          seat.userId === state.activePlayerId &&
          (state.activePlayerEntryId == null ||
            seat.id === state.activePlayerEntryId),
      )
    : [];
  const active = activeSeats.length === 1 ? activeSeats[0] : null;
  return {
    gameId: game.id,
    slug: game.slug,
    name: game.name,
    organizerId: game.organizerId,
    players: game.players.map((seat) => ({
      id: seat.id,
      userId: seat.userId,
      displayName: seat.user?.displayName ?? null,
      turnOrder: seat.turnOrder,
      isOrganizer:
        seat.role === GameRole.ORGANIZER || seat.userId === game.organizerId,
    })),
    activePlayerEntryId: active?.id ?? null,
    activePlayerUserId: active?.userId ?? null,
    roundNumber: state?.roundNumber ?? null,
    seatOrderBaseline: { campaignId: game.id, revision: game.turnRevision },
  };
}

export async function getSeatOrder(
  database: PrismaClient,
  dependencies: TurnMutationDependencies,
  gameId: string,
  userId: string | undefined,
): Promise<SeatOrderSnapshot> {
  if (!userId)
    throw new UnauthorizedException(
      'Authenticated user id is missing from the token.',
    );
  const observed = await database.game.findFirst({
    where: buildGameIdentifierWhere(gameId),
    select: { id: true, organizerId: true },
  });
  if (!observed) throw new NotFoundException(`Game ${gameId} was not found.`);
  const shadowOverride =
    observed.organizerId !== userId &&
    (await dependencies.authService?.isUserShadowOverride(userId)) === true;
  if (observed.organizerId !== userId && !shadowOverride)
    throw new ForbiddenException(
      'Only the game organizer can edit seat order.',
    );
  return database.$transaction(async (transaction) => {
    const game = await transaction.game.findUnique({
      where: { id: observed.id },
      include,
    });
    if (!game) throw new NotFoundException(`Game ${gameId} was not found.`);
    if (game.organizerId !== userId && !shadowOverride)
      throw new ForbiddenException(
        'Only the game organizer can edit seat order.',
      );
    return snapshot(game);
  });
}

export async function reorderSeatOrder(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  gameId: string,
  userId: string | undefined,
  input: ReorderSeatOrderDto,
) {
  if (!userId)
    throw new UnauthorizedException(
      'Authenticated user id is missing from the token.',
    );
  const observed = await database.game.findFirst({
    where: buildGameIdentifierWhere(gameId),
    include,
  });
  if (!observed) throw new NotFoundException(`Game ${gameId} was not found.`);
  const shadowOverride =
    observed.organizerId !== userId &&
    (await dependencies.authService?.isUserShadowOverride(userId)) === true;
  if (observed.organizerId !== userId && !shadowOverride) {
    throw new ForbiddenException(
      'Only the game organizer can edit seat order.',
    );
  }

  const baseline = input?.baseline;
  if (
    baseline == null ||
    typeof baseline !== 'object' ||
    Array.isArray(baseline) ||
    typeof baseline.campaignId !== 'string' ||
    !baseline.campaignId.trim() ||
    !Number.isSafeInteger(baseline.revision) ||
    baseline.revision < 0
  ) {
    throw new BadRequestException({
      code: 'SEAT_ORDER_BASELINE_REQUIRED',
      message:
        'A valid Seat Order baseline is required. Reload the latest roster before saving.',
    });
  }

  return database.$transaction(async (transaction) => {
    // Lock before reading the proof without changing revision or updatedAt for
    // no-ops. A failed proof aborts; never retry intent against a newer roster.
    const fenced = await transaction.$executeRaw`
      UPDATE "Game" SET "turnRevision" = "turnRevision"
      WHERE "id" = ${observed.id} AND "turnRevision" = ${baseline.revision}
    `;
    const game = await transaction.game.findUnique({
      where: { id: observed.id },
      include,
    });
    if (!game) throw new NotFoundException(`Game ${gameId} was not found.`);
    if (game.organizerId !== userId && !shadowOverride) {
      throw new ForbiddenException(
        'Only the game organizer can edit seat order.',
      );
    }
    if (
      fenced !== 1 ||
      baseline.campaignId !== game.id ||
      game.turnRevision !== observed.turnRevision ||
      game.organizerId !== observed.organizerId ||
      game.playerCount !== observed.playerCount ||
      game.players.length !== observed.players.length ||
      game.players.some((seat, index) => {
        const previous = observed.players[index];
        return (
          seat.id !== previous.id ||
          seat.userId !== previous.userId ||
          seat.turnOrder !== previous.turnOrder ||
          seat.role !== previous.role
        );
      }) ||
      game.turnState?.id !== observed.turnState?.id ||
      game.turnState?.activePlayerId !== observed.turnState?.activePlayerId ||
      game.turnState?.activePlayerEntryId !==
        observed.turnState?.activePlayerEntryId ||
      game.turnState?.roundNumber !== observed.turnState?.roundNumber
    )
      throw new ConflictException({
        code: 'STALE_SEAT_ORDER',
        message:
          'This Seat Order draft is stale. Discard it and reload the latest roster before saving.',
      });

    const currentSeatIds = new Set(game.players.map((seat) => seat.id));
    const requestedSeatIds = input.seatEntryIds;
    const clearedSeatIds = input.clearedSeatEntryIds ?? [];
    const removedSeatIds = input.removedSeatEntryIds ?? [];
    for (const [ids, label] of [
      [requestedSeatIds, 'Seat order'],
      [clearedSeatIds, 'Seat removal'],
      [removedSeatIds, 'Seat deletion'],
    ] as const) {
      if (
        !Array.isArray(ids) ||
        [...ids].some((id) => typeof id !== 'string')
      ) {
        throw new BadRequestException(
          `${label} must be an array of seat entry IDs.`,
        );
      }
    }
    if (
      input.activePlayerEntryId != null &&
      typeof input.activePlayerEntryId !== 'string'
    ) {
      throw new BadRequestException(
        'Active player selection must be a seat entry ID.',
      );
    }
    const requested = new Set(requestedSeatIds);
    const cleared = new Set(clearedSeatIds);
    const removed = new Set(removedSeatIds);
    if (!requestedSeatIds.length)
      throw new BadRequestException(
        'Seat order must retain at least one seat in the game.',
      );
    for (const [ids, unique, label] of [
      [requestedSeatIds, requested, 'Seat order'],
      [removedSeatIds, removed, 'Seat deletion'],
      [clearedSeatIds, cleared, 'Seat removal'],
    ] as const) {
      if (ids.length !== unique.size)
        throw new BadRequestException(
          `${label} contains duplicate seat entries.`,
        );
      if (ids.some((id) => !currentSeatIds.has(id)))
        throw new BadRequestException(
          `${label} contains a seat that does not belong to this game.`,
        );
    }
    if (removedSeatIds.some((id) => requested.has(id)))
      throw new BadRequestException(
        'Removed seats cannot remain in the requested seat order.',
      );
    if (requestedSeatIds.length + removedSeatIds.length !== currentSeatIds.size)
      throw new BadRequestException(
        'Seat order must include every existing seat exactly once unless it is explicitly removed.',
      );
    if (clearedSeatIds.some((id) => removed.has(id)))
      throw new BadRequestException(
        'Occupied seats must be cleared and saved before they can be removed.',
      );

    const turnState = game.turnState;
    const activeMatches = turnState
      ? game.players.filter(
          (seat) =>
            seat.userId != null &&
            (turnState.activePlayerEntryId != null
              ? seat.id === turnState.activePlayerEntryId
              : seat.userId === turnState.activePlayerId),
        )
      : [];
    const activeSeat = activeMatches.length === 1 ? activeMatches[0] : null;
    if (
      turnState &&
      (!activeSeat || activeSeat.userId !== turnState.activePlayerId)
    ) {
      throw new ConflictException('The active turn could not be resolved.');
    }
    await turnRecords.assertCurrentTurn(transaction, game.id);
    const reorderedSeats = requestedSeatIds.map((id, index) => {
      const seat = game.players.find((entry) => entry.id === id)!;
      return {
        ...seat,
        turnOrder: index + 1,
        userId: cleared.has(id) ? null : seat.userId,
        user: cleared.has(id) ? null : seat.user,
        role: cleared.has(id) ? GameRole.PLAYER : seat.role,
      };
    });
    const occupied = reorderedSeats.filter((seat) => seat.userId != null);
    if (!occupied.length)
      throw new BadRequestException(
        'At least one occupied seat must remain in the game.',
      );
    const explicitActiveEntry =
      input.activePlayerEntryId != null
        ? reorderedSeats.find((seat) => seat.id === input.activePlayerEntryId)
        : null;
    if (input.activePlayerEntryId != null && !explicitActiveEntry)
      throw new BadRequestException(
        'Active player selection does not belong to this game.',
      );
    if (explicitActiveEntry && !explicitActiveEntry.userId)
      throw new BadRequestException(
        'Active player selection cannot be an empty seat.',
      );
    const nextActiveSeat =
      explicitActiveEntry ??
      reorderedSeats.find(
        (seat) => seat.id === activeSeat?.id && seat.userId != null,
      ) ??
      (activeSeat
        ? occupied.find((seat) => seat.turnOrder >= activeSeat.turnOrder)
        : null) ??
      occupied[0];
    const previousOrder = game.players.map((seat) => ({
      seatEntryId: seat.id,
      turnOrder: seat.turnOrder,
      displayName: seat.user?.displayName ?? null,
    }));
    const requestedOrder = reorderedSeats.map((seat) => ({
      seatEntryId: seat.id,
      turnOrder: seat.turnOrder,
      displayName: seat.user?.displayName ?? null,
    }));
    const nextPlayerCount =
      game.playerCount == null
        ? reorderedSeats.length
        : Math.max(
            reorderedSeats.length,
            game.playerCount - removedSeatIds.length,
          );

    const response = {
      gameId: game.id,
      slug: game.slug,
      name: game.name,
      activePlayerEntryId: nextActiveSeat.id,
      players: requestedOrder,
    };
    const activeChanged =
      turnState != null &&
      activeSeat != null &&
      (activeSeat.id !== nextActiveSeat.id ||
        activeSeat.userId !== nextActiveSeat.userId);
    const rosterChanged =
      removedSeatIds.length > 0 ||
      reorderedSeats.some((seat) => {
        const current = game.players.find((entry) => entry.id === seat.id)!;
        return (
          seat.turnOrder !== current.turnOrder ||
          seat.userId !== current.userId ||
          seat.role !== current.role
        );
      });
    if (!rosterChanged && !activeChanged)
      return { ...response, seatOrder: snapshot(game) };
    await transaction.game.update({
      where: { id: game.id },
      data: { turnRevision: { increment: 1 } },
    });

    // Final orders are positive. Allocate unused nonpositive values rather than
    // assuming a range above/below existing orders is free or cannot overflow.
    const usedOrders = new Set(game.players.map((seat) => seat.turnOrder));
    let temporaryOrder = 0;
    for (const seat of reorderedSeats) {
      while (usedOrders.has(temporaryOrder)) temporaryOrder -= 1;
      await transaction.gamePlayer.update({
        where: { id: seat.id },
        data: { turnOrder: temporaryOrder },
      });
      usedOrders.add(temporaryOrder);
    }
    // Resolve and close the old participant before deleting its seat: history's
    // SET NULL foreign key must not erase the proof used by transitionTurn.
    if (turnState && activeSeat && activeChanged) {
      await transaction.turnState.update({
        where: { gameId: game.id },
        data: {
          activePlayerId: nextActiveSeat.userId!,
          activePlayerEntryId: nextActiveSeat.id,
        },
      });
      await turnRecords.transitionTurn(transaction, {
        gameId: game.id,
        expectedCurrent: {
          gamePlayerId: activeSeat.id,
          userId: activeSeat.userId!,
          roundNumber: turnState.roundNumber,
        },
        next: {
          gamePlayerId: nextActiveSeat.id,
          userId: nextActiveSeat.userId,
          seatNumber: nextActiveSeat.turnOrder,
          playerDisplayName: nextActiveSeat.user!.displayName,
          roundNumber: turnState.roundNumber,
        },
        completionReason: TurnCompletionReason.REASSIGNED,
        transitionedAt: new Date(),
      });
    }
    if (removedSeatIds.length) {
      await transaction.gamePlayer.deleteMany({
        where: { gameId: game.id, id: { in: removedSeatIds } },
      });
      await transaction.game.update({
        where: { id: game.id },
        data: { playerCount: nextPlayerCount },
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
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: userId,
        eventType: AuditEventType.TURN_REASSIGNED,
        payload: JSON.stringify({
          previousOrder,
          nextOrder: requestedOrder,
          removedSeatEntryIds: removedSeatIds,
          previousPlayerCount: game.playerCount,
          nextPlayerCount,
          previousActivePlayerEntryId: turnState?.activePlayerEntryId ?? null,
          previousActivePlayerId: turnState?.activePlayerId ?? null,
          activeSeatTurnOrder: activeSeat?.turnOrder ?? null,
          explicitActivePlayerEntryId: explicitActiveEntry?.id ?? null,
          nextActivePlayerEntryId: nextActiveSeat.id,
          nextActivePlayerId: nextActiveSeat.userId,
        }),
      },
    });
    const committed = await transaction.game.findUniqueOrThrow({
      where: { id: game.id },
      include,
    });
    return { ...response, seatOrder: snapshot(committed) };
  });
}
