import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEventType,
  type Prisma,
  type PrismaClient,
  type User,
} from '@prisma/client';
import type { DesignateVictoryDto } from '../../dto/designate-victory.dto';
import type { UndoVictoryDto } from '../../dto/undo-victory.dto';
import {
  campaignConcludedMessage,
  victoryDeletionDueAt,
} from '../../support/campaign-conclusion';
import { getDiscordIdentity } from '../../support/discord-user.helpers';
import type { TurnRecordsService } from '../turn-records.service';
import type { TurnMutationDependencies } from './dependencies';

type VictoryCommandName = 'winner' | 'unwinner';

export type VictoryOptions = {
  /** Validate and describe the outcome without changing anything. */
  preview?: boolean;
  now?: Date;
};

const victoryGameInclude = {
  players: {
    include: { user: { include: { identities: true } } },
    orderBy: { turnOrder: 'asc' },
  },
  victoryRecord: { include: { victor: { include: { identities: true } } } },
} satisfies Prisma.GameInclude;

type VictoryGame = Prisma.GameGetPayload<{
  include: typeof victoryGameInclude;
}>;

type VictoryCaller = { user: User; isShadowLord: boolean } | null;

async function findVictoryGame(
  database: Prisma.TransactionClient,
  discordThreadId: string,
) {
  const game = await database.game.findUnique({
    where: { discordThreadId },
    include: victoryGameInclude,
  });
  if (!game) {
    throw new NotFoundException(
      `Thread ${discordThreadId} is not linked to a game.`,
    );
  }
  return game;
}

/** Shadow Lord status comes from Discord, so resolve it before any transaction. */
async function resolveCaller(
  database: PrismaClient,
  dependencies: TurnMutationDependencies,
  game: VictoryGame,
  callerDiscordId: string,
): Promise<VictoryCaller> {
  const identity = await database.authIdentity.findUnique({
    where: {
      provider_providerId: { provider: 'discord', providerId: callerDiscordId },
    },
    include: { user: true },
  });
  if (!identity) return null;
  return {
    user: identity.user,
    isShadowLord:
      identity.userId !== game.organizerId &&
      (await dependencies.authService?.isUserShadowOverride(
        identity.userId,
      )) === true,
  };
}

function authorize(
  game: VictoryGame,
  caller: VictoryCaller,
  commandName: VictoryCommandName,
) {
  if (
    !caller ||
    (caller.user.id !== game.organizerId && !caller.isShadowLord)
  ) {
    throw new ForbiddenException(
      `Only the Overlord or a Shadow Lord can use /${commandName}.`,
    );
  }
  return caller.user;
}

function findVictorSeat(game: VictoryGame, victorDiscordId: string) {
  const seat = game.players.find(
    (player) =>
      player.user != null &&
      getDiscordIdentity(player.user) === victorDiscordId,
  );
  if (!seat?.user) {
    throw new BadRequestException(
      'The Victor must occupy a seat in this campaign.',
    );
  }
  return { ...seat, user: seat.user };
}

function concludedVictory(game: VictoryGame, now: Date) {
  const victory = game.victoryRecord;
  if (!victory) {
    throw new ConflictException('This campaign has not concluded.');
  }
  if (victoryDeletionDueAt(victory.designatedAt) <= now) {
    throw new ConflictException(
      'The grace period has ended and this campaign is being deleted.',
    );
  }
  return victory;
}

function victoryPayload(
  game: VictoryGame,
  victor: { displayName: string; discordId: string | null },
  designatedAt: Date,
) {
  return {
    gameId: game.id,
    gameNumber: game.gameNumber,
    slug: game.slug,
    name: game.name,
    victor,
    designatedAt: designatedAt.toISOString(),
    deletionDueAt: victoryDeletionDueAt(designatedAt).toISOString(),
  };
}

export async function designateVictory(
  database: PrismaClient,
  dependencies: TurnMutationDependencies,
  input: DesignateVictoryDto,
  { preview = false, now = new Date() }: VictoryOptions = {},
) {
  const observed = await findVictoryGame(database, input.discordThreadId);
  const caller = await resolveCaller(
    database,
    dependencies,
    observed,
    input.callerDiscordId,
  );
  authorize(observed, caller, 'winner');
  if (observed.victoryRecord) {
    throw new ConflictException(campaignConcludedMessage);
  }
  const expectedSeat = findVictorSeat(observed, input.victorDiscordId);
  if (preview) {
    return victoryPayload(
      observed,
      {
        displayName: expectedSeat.user.displayName,
        discordId: input.victorDiscordId,
      },
      now,
    );
  }

  return database.$transaction(async (transaction) => {
    // The first write takes SQLite's writer lock and stales concurrent turn
    // intents. A failed proof rolls it back; never retry a changed intent.
    const fenced = await transaction.game.updateMany({
      where: { id: observed.id, turnRevision: observed.turnRevision },
      data: { turnRevision: { increment: 1 } },
    });
    const game = await findVictoryGame(transaction, input.discordThreadId);
    const designatedBy = authorize(game, caller, 'winner');
    if (game.victoryRecord) {
      throw new ConflictException(campaignConcludedMessage);
    }
    const seat = findVictorSeat(game, input.victorDiscordId);
    if (
      fenced.count !== 1 ||
      game.id !== observed.id ||
      seat.id !== expectedSeat.id ||
      seat.userId !== expectedSeat.userId
    ) {
      throw new ConflictException(
        'The campaign changed before the victory was designated. Run /winner again.',
      );
    }
    await transaction.victoryRecord.create({
      data: {
        gameId: game.id,
        gameNumber: game.gameNumber,
        gameName: game.name,
        victorId: seat.user.id,
        victorDisplayName: seat.user.displayName,
        designatedById: designatedBy.id,
        designatedByDisplayName: designatedBy.displayName,
        designatedAt: now,
      },
    });
    // The open turn stays open so an undo can resume it; only its nudges stop.
    await transaction.notificationDelivery.updateMany({
      where: { gameId: game.id, event: 'TURN_NUDGE', status: 'PENDING' },
      data: { status: 'CANCELLED', processingStartedAt: null },
    });
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: designatedBy.id,
        eventType: AuditEventType.VICTORY_DESIGNATED,
        payload: JSON.stringify({
          victorDisplayName: seat.user.displayName,
          victorTurnOrder: seat.turnOrder,
        }),
      },
    });
    return victoryPayload(
      game,
      {
        displayName: seat.user.displayName,
        discordId: input.victorDiscordId,
      },
      now,
    );
  });
}

export async function undoVictory(
  database: PrismaClient,
  turnRecords: TurnRecordsService,
  dependencies: TurnMutationDependencies,
  input: UndoVictoryDto,
  { preview = false, now = new Date() }: VictoryOptions = {},
) {
  const observed = await findVictoryGame(database, input.discordThreadId);
  const caller = await resolveCaller(
    database,
    dependencies,
    observed,
    input.callerDiscordId,
  );
  authorize(observed, caller, 'unwinner');
  const expected = concludedVictory(observed, now);
  const payload = (game: VictoryGame) =>
    victoryPayload(
      game,
      {
        displayName: expected.victorDisplayName,
        discordId: expected.victor ? getDiscordIdentity(expected.victor) : null,
      },
      expected.designatedAt,
    );
  if (preview) return payload(observed);

  return database.$transaction(async (transaction) => {
    const fenced = await transaction.game.updateMany({
      where: { id: observed.id, turnRevision: observed.turnRevision },
      data: { turnRevision: { increment: 1 } },
    });
    const game = await findVictoryGame(transaction, input.discordThreadId);
    const undoneBy = authorize(game, caller, 'unwinner');
    const victory = concludedVictory(game, now);
    if (
      fenced.count !== 1 ||
      game.id !== observed.id ||
      victory.id !== expected.id
    ) {
      throw new ConflictException(
        'The campaign changed before the victory was undone. Run /unwinner again.',
      );
    }
    await transaction.victoryRecord.delete({ where: { id: victory.id } });
    await turnRecords.resumeOpenTurn(transaction, {
      gameId: game.id,
      pausedAt: victory.designatedAt,
      resumedAt: now,
    });
    await transaction.auditEvent.create({
      data: {
        gameId: game.id,
        actorId: undoneBy.id,
        eventType: AuditEventType.VICTORY_UNDONE,
        payload: JSON.stringify({
          victorDisplayName: victory.victorDisplayName,
          designatedAt: victory.designatedAt.toISOString(),
        }),
      },
    });
    return payload(game);
  });
}
