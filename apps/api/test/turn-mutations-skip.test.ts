import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

const intent = { discordThreadId: 'thread-1', callerDiscordId: 'discord-2' };
const startedAt = new Date('2026-09-01T00:00:00.000Z');
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  const { db } = fixture;
  await db.user.create({
    data: { id: 'user-1', email: 'alpha@example.com', displayName: 'Alpha' },
  });
  await db.user.create({
    data: {
      id: 'user-2',
      email: 'overlord@example.com',
      displayName: 'Overlord',
      identities: { create: { provider: 'discord', providerId: 'discord-2' } },
    },
  });
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 1,
      name: 'Ashes',
      slug: 'ashes',
      discordThreadId: 'thread-1',
      organizerId: 'user-2',
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', turnOrder: 1 },
          { id: 'seat-open', turnOrder: 2 },
          { id: 'seat-2', userId: 'user-2', turnOrder: 3, role: 'ORGANIZER' },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'user-1',
          activePlayerEntryId: 'seat-1',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn-1',
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          seatNumber: 1,
          playerDisplayName: 'Alpha',
          roundNumber: 4,
          startedAt,
          nextReminderAt: new Date('2026-09-02T12:00:00.000Z'),
        },
      },
    },
  });
  mutations = new TurnMutationsService(db, new TurnRecordsService());
});

afterEach(async () => {
  await fixture?.close();
});

async function persistedState(db = fixture.db) {
  return {
    games: await db.game.findMany({ orderBy: { id: 'asc' } }),
    seats: await db.gamePlayer.findMany({ orderBy: { id: 'asc' } }),
    turns: await db.turnState.findMany({ orderBy: { id: 'asc' } }),
    history: await db.turnRecord.findMany({ orderBy: { id: 'asc' } }),
    reminders: await db.notificationDelivery.findMany({
      orderBy: { id: 'asc' },
    }),
    audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  };
}

function beforeTransaction(action: (other: PrismaClient) => Promise<unknown>) {
  const other = fixture.connect();
  const transact = fixture.db.$transaction.bind(fixture.db);
  // Only control admission: every read, write, and rollback still uses Prisma.
  vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
    async (...args) => {
      await action(other);
      return transact(...args);
    },
  );
}

async function seedDeliveries() {
  for (const status of [
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED',
  ] as const) {
    await fixture.db.notificationDelivery.create({
      data: {
        id: status,
        event: 'TURN_NUDGE',
        status,
        gameId: 'game-1',
        gameSlug: 'ashes',
        turnRecordId: 'turn-1',
        payload: '{}',
        processingStartedAt: status === 'PROCESSING' ? startedAt : null,
        deliveredAt: status === 'DELIVERED' ? startedAt : null,
      },
    });
  }
  await fixture.db.notificationDelivery.create({
    data: {
      id: 'other-event',
      event: 'SAVE_UPLOADED',
      gameId: 'game-1',
      gameSlug: 'ashes',
      turnRecordId: 'turn-1',
      payload: '{}',
    },
  });
  await fixture.db.game.create({
    data: {
      id: 'game-2',
      gameNumber: 2,
      slug: 'other',
      name: 'Other',
      organizerId: 'user-2',
      turnRecords: {
        create: {
          id: 'other-turn',
          roundNumber: 1,
          playerDisplayName: 'Overlord',
          startedAt,
        },
      },
    },
  });
  await fixture.db.notificationDelivery.create({
    data: {
      id: 'other-turn-nudge',
      event: 'TURN_NUDGE',
      gameId: 'game-2',
      gameSlug: 'other',
      turnRecordId: 'other-turn',
      payload: '{}',
    },
  });
}

describe('atomic skip through real SQLite', () => {
  it('does not retry or report SQLite contention as a confirmed stale intent', async () => {
    const other = fixture.connect();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = other.$transaction(async (transaction) => {
      await transaction.game.update({
        where: { id: 'game-1' },
        data: { notes: 'Concurrent edit' },
      });
      locked.resolve();
      await release.promise;
    });
    // A failed writer must also release the wait instead of hanging the test.
    void writer.catch(locked.reject);
    await locked.promise;
    try {
      const result = await mutations.skipPlayerTurn(intent).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).not.toBeInstanceOf(ConflictException);
    } finally {
      release.resolve();
      await writer;
    }
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 0, notes: 'Concurrent edit' });
    expect(
      await fixture.db.turnState.findUniqueOrThrow({
        where: { gameId: 'game-1' },
      }),
    ).toMatchObject({ activePlayerEntryId: 'seat-1' });
    expect(await fixture.db.turnRecord.count()).toBe(1);
    expect(await fixture.db.auditEvent.count()).toBe(0);
  });

  it('starts a distinct turn and advances revision when skips return to the same seat, occupant, and round', async () => {
    await mutations.skipPlayerTurn(intent);
    await mutations.skipPlayerTurn(intent);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 2 });
    expect(
      await fixture.db.turnState.findUniqueOrThrow({
        where: { gameId: 'game-1' },
      }),
    ).toMatchObject({
      activePlayerEntryId: 'seat-1',
      activePlayerId: 'user-1',
      roundNumber: 4,
    });
    const records = await fixture.db.turnRecord.findMany({
      where: { gameId: 'game-1' },
    });
    expect(records).toHaveLength(3);
    const open = records.filter((record) => record.endedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      gamePlayerId: 'seat-1',
      userId: 'user-1',
      roundNumber: 4,
    });
    expect(open[0].id).not.toBe('turn-1');
    expect(
      records.find((record) => record.gamePlayerId === 'seat-2')!.endedAt,
    ).toEqual(open[0].startedAt);
  });

  it('cancels only pending nudges for the completed turn', async () => {
    await seedDeliveries();
    const before = await fixture.db.notificationDelivery.findMany({
      where: { id: { not: 'PENDING' } },
      orderBy: { id: 'asc' },
    });
    await mutations.skipPlayerTurn(intent);
    expect(
      await fixture.db.notificationDelivery.findUniqueOrThrow({
        where: { id: 'PENDING' },
      }),
    ).toMatchObject({ status: 'CANCELLED', processingStartedAt: null });
    expect(
      await fixture.db.notificationDelivery.findMany({
        where: { id: { not: 'PENDING' } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-2' } }),
    ).toMatchObject({ turnRevision: 0 });
  });

  it('rolls back every coupled effect when a trigger fails after the audit write', async () => {
    await seedDeliveries();
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_skip AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'TURN_SKIPPED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT activePlayerEntryId FROM TurnState WHERE gameId = NEW.gameId) = 'seat-2'
      AND (SELECT status FROM NotificationDelivery WHERE id = 'PENDING') = 'CANCELLED'
      AND (SELECT COUNT(*) FROM TurnRecord WHERE gameId = NEW.gameId) = 2
      BEGIN SELECT RAISE(ABORT, 'injected failure after coupled writes'); END`);
    const before = await persistedState();
    await expect(mutations.skipPlayerTurn(intent)).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_skip');
    await mutations.skipPlayerTurn(intent);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 1 });
  });

  it.each(['discord-1', 'unknown'])(
    'rejects unauthorized caller %s without writes',
    async (callerDiscordId) => {
      await fixture.db.authIdentity.create({
        data: {
          provider: 'discord',
          providerId: 'discord-1',
          userId: 'user-1',
        },
      });
      const before = await persistedState();
      await expect(
        mutations.skipPlayerTurn({ ...intent, callerDiscordId }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState()).toEqual(before);
    },
  );

  it('preserves missing campaign, uninitialized campaign, and single occupied seat errors', async () => {
    await expect(
      mutations.skipPlayerTurn({ ...intent, discordThreadId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-2' },
      data: { userId: null },
    });
    const single = await persistedState();
    await expect(mutations.skipPlayerTurn(intent)).rejects.toThrow(
      'Cannot skip when there is only one active player.',
    );
    expect(await persistedState()).toEqual(single);
    await fixture.db.turnRecord.deleteMany();
    await fixture.db.turnState.deleteMany();
    const uninitialized = await persistedState();
    await expect(mutations.skipPlayerTurn(intent)).rejects.toThrow(
      'This game has no active turn state. Upload a save file to start turns.',
    );
    expect(await persistedState()).toEqual(uninitialized);
  });

  it.each([
    'mismatched occupant',
    'empty active seat',
    'cross-campaign seat',
    'ambiguous legacy occupant',
  ])('rejects an invalid participant: %s', async (invalid) => {
    if (invalid === 'mismatched occupant') {
      await fixture.db.turnState.update({
        where: { gameId: 'game-1' },
        data: { activePlayerId: 'user-2' },
      });
    } else if (invalid === 'empty active seat') {
      await fixture.db.gamePlayer.update({
        where: { id: 'seat-1' },
        data: { userId: null },
      });
    } else if (invalid === 'cross-campaign seat') {
      await fixture.db.game.create({
        data: {
          gameNumber: 2,
          slug: 'other',
          name: 'Other',
          organizerId: 'user-2',
          players: {
            create: { id: 'foreign-seat', turnOrder: 1, userId: 'user-1' },
          },
        },
      });
      await fixture.db.turnState.update({
        where: { gameId: 'game-1' },
        data: { activePlayerEntryId: 'foreign-seat' },
      });
    } else {
      await fixture.db.turnState.update({
        where: { gameId: 'game-1' },
        data: { activePlayerEntryId: null },
      });
      await fixture.db.gamePlayer.update({
        where: { id: 'seat-open' },
        data: { userId: 'user-1' },
      });
    }
    const before = await persistedState();
    await expect(mutations.skipPlayerTurn(intent)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await persistedState()).toEqual(before);
  });

  it.each(['missing', 'mismatched'])(
    'rolls back when open history is %s',
    async (invalid) => {
      if (invalid === 'missing') await fixture.db.turnRecord.deleteMany();
      else
        await fixture.db.turnRecord.update({
          where: { id: 'turn-1' },
          data: { userId: 'user-2' },
        });
      const before = await persistedState();
      await expect(mutations.skipPlayerTurn(intent)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await persistedState()).toEqual(before);
    },
  );

  it.each(['Overlord', 'identity'])(
    'revalidates changed local %s authorization in the transaction',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'Overlord')
          await other.game.update({
            where: { id: 'game-1' },
            data: { organizerId: 'user-1' },
          });
        else
          await other.authIdentity.update({
            where: {
              provider_providerId: {
                provider: 'discord',
                providerId: 'discord-2',
              },
            },
            data: { userId: 'user-1' },
          });
        afterChange = await persistedState(other);
      });
      await expect(mutations.skipPlayerTurn(intent)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it.each([
    'emptied successor',
    'reordered successor',
    'replaced active occupant',
    'changed round',
  ])(
    'rejects %s committed before admission even by a writer without revision support',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'emptied successor')
          await other.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { userId: null },
          });
        if (change === 'reordered successor')
          await other.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { turnOrder: 4 },
          });
        if (change === 'replaced active occupant')
          await other.gamePlayer.update({
            where: { id: 'seat-1' },
            data: { userId: 'user-2' },
          });
        if (change === 'changed round')
          await other.turnState.update({
            where: { gameId: 'game-1' },
            data: { roundNumber: 5 },
          });
        afterChange = await persistedState(other);
      });
      await expect(mutations.skipPlayerTurn(intent)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it('fences a competing skip sequence even after it returns to the observed seat and round', async () => {
    let afterChange: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      const competitor = new TurnMutationsService(
        other,
        new TurnRecordsService(),
      );
      await competitor.skipPlayerTurn(intent);
      await competitor.skipPlayerTurn(intent);
      afterChange = await persistedState(other);
    });
    await expect(mutations.skipPlayerTurn(intent)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await persistedState()).toEqual(afterChange!);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 2 });
  });

  it('uses current reminder policy and display names without treating cosmetic changes as changed intent', async () => {
    beforeTransaction(async (other) => {
      await other.game.update({
        where: { id: 'game-1' },
        data: { turnRemindersEnabled: false },
      });
      await other.user.update({
        where: { id: 'user-2' },
        data: { displayName: 'Renamed Overlord' },
      });
    });
    expect(await mutations.skipPlayerTurn(intent)).toMatchObject({
      nextPlayer: { displayName: 'Renamed Overlord' },
    });
    expect(
      await fixture.db.turnRecord.findFirstOrThrow({
        where: { endedAt: null },
      }),
    ).toMatchObject({
      playerDisplayName: 'Renamed Overlord',
      nextReminderAt: null,
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 1 });
  });

  it('keeps migration-defined open-turn uniqueness, seat order uniqueness, and foreign keys enforced by the adapter', async () => {
    await expect(
      fixture.db.turnRecord.create({
        data: {
          gameId: 'game-1',
          roundNumber: 4,
          playerDisplayName: 'Duplicate',
          startedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      fixture.db.gamePlayer.create({
        data: { gameId: 'game-1', turnOrder: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      fixture.db.gamePlayer.create({
        data: { gameId: 'missing', turnOrder: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await mutations.skipPlayerTurn(intent);
    expect(
      await fixture.db.turnRecord.count({ where: { endedAt: null } }),
    ).toBe(1);
  });

  it('resolves a legacy null active-seat reference from an unambiguous occupant', async () => {
    await fixture.db.turnState.update({
      where: { gameId: 'game-1' },
      data: { activePlayerEntryId: null },
    });
    await mutations.skipPlayerTurn(intent);
    expect(
      await fixture.db.turnState.findUniqueOrThrow({
        where: { gameId: 'game-1' },
      }),
    ).toMatchObject({
      activePlayerEntryId: 'seat-2',
      activePlayerId: 'user-2',
      roundNumber: 4,
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 1 });
  });

  it('rejects a changed successor rather than silently skipping a different intent', async () => {
    const other = fixture.connect();
    await other.user.create({
      data: { id: 'user-3', email: 'third@example.com', displayName: 'Third' },
    });
    beforeTransaction((writer) =>
      writer.gamePlayer.update({
        where: { id: 'seat-open' },
        data: { userId: 'user-3' },
      }),
    );

    await expect(mutations.skipPlayerTurn(intent)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      await other.turnState.findUniqueOrThrow({ where: { gameId: 'game-1' } }),
    ).toMatchObject({ activePlayerEntryId: 'seat-1' });
    expect(
      await other.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 0 });
    expect(await other.turnRecord.count()).toBe(1);
    expect(await other.auditEvent.count()).toBe(0);
  });

  it('skips open seats and commits a coherent new turn, audit, and revision', async () => {
    expect(await mutations.skipPlayerTurn(intent)).toEqual({
      gameId: 'game-1',
      slug: 'ashes',
      name: 'Ashes',
      skippedPlayer: { displayName: 'Alpha', turnOrder: 1 },
      nextPlayer: {
        displayName: 'Overlord',
        discordId: 'discord-2',
        turnOrder: 3,
      },
    });
    const { db } = fixture;
    expect(
      await db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 1 });
    expect(
      await db.turnState.findUniqueOrThrow({ where: { gameId: 'game-1' } }),
    ).toMatchObject({
      activePlayerId: 'user-2',
      activePlayerEntryId: 'seat-2',
      roundNumber: 4,
    });
    const open = await db.turnRecord.findMany({
      where: { gameId: 'game-1', endedAt: null },
    });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      gamePlayerId: 'seat-2',
      userId: 'user-2',
      seatNumber: 3,
      roundNumber: 4,
    });
    const previous = await db.turnRecord.findUniqueOrThrow({
      where: { id: 'turn-1' },
    });
    expect(previous).toMatchObject({
      startedAt,
      endedAt: open[0].startedAt,
      completionReason: 'SKIPPED',
      nextReminderAt: null,
    });
    expect(
      open[0].nextReminderAt!.getTime() - open[0].startedAt.getTime(),
    ).toBe(36 * 60 * 60 * 1000);
    const audits = await db.auditEvent.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      gameId: 'game-1',
      actorId: 'user-2',
      eventType: 'TURN_SKIPPED',
    });
    expect(JSON.parse(audits[0].payload)).toEqual({
      skippedPlayerDisplayName: 'Alpha',
      skippedPlayerTurnOrder: 1,
      nextPlayerDisplayName: 'Overlord',
      nextPlayerTurnOrder: 3,
    });
  });
});
