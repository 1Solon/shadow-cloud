import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));
const { GamesTurnService } =
  await import('../src/games/services/games-turn.service');

const startedAt = new Date('2026-09-01T00:00:00.000Z');
const baseline = { campaignId: 'game-1', revision: 0 };
const intent = { seatEntryIds: ['seat-1', 'seat-2', 'seat-open'], baseline };
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  for (const [id, displayName] of [
    ['user-1', 'Overlord'],
    ['user-2', 'Other'],
    ['user-3', 'Replacement'],
  ]) {
    await fixture.db.user.create({
      data: { id, displayName, email: `${id}@example.com` },
    });
  }
  await fixture.db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'user-1',
      playerCount: 3,
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', role: 'ORGANIZER', turnOrder: 1 },
          { id: 'seat-2', userId: 'user-2', turnOrder: 2 },
          { id: 'seat-open', turnOrder: 3 },
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
          playerDisplayName: 'Overlord',
          roundNumber: 4,
          startedAt,
          nextReminderAt: new Date('2026-09-02T12:00:00.000Z'),
        },
      },
    },
  });
  mutations = new TurnMutationsService(fixture.db, new TurnRecordsService());
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
  // Control admission only; all persistence and rollback use the real adapter.
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
}

describe('Seat Order through real migrated SQLite', () => {
  it('holds SQLite write admission before reading the transaction-local roster proof', async () => {
    const other = fixture.connect();
    const transact = fixture.db.$transaction.bind(fixture.db);
    let attempted = false;
    vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
      async (callback, options) =>
        transact(async (transaction) => {
          const find = transaction.game.findUnique.bind(transaction.game);
          vi.spyOn(transaction.game, 'findUnique').mockImplementationOnce(
            async (args) => {
              const game = await find(args);
              attempted = true;
              await expect(
                other.gamePlayer.update({
                  where: { id: 'seat-2' },
                  data: { userId: 'user-3' },
                }),
              ).rejects.toThrow();
              return game;
            },
          );
          return callback(transaction);
        }, options),
    );
    await mutations.reorderSeatOrder('1', 'user-1', {
      baseline,
      seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
    });
    expect(attempted).toBe(true);
    expect(
      (await persistedState(other)).seats.find((seat) => seat.id === 'seat-2'),
    ).toMatchObject({ userId: 'user-2' });
    expect((await persistedState(other)).games[0].turnRevision).toBe(1);
  });

  it('does not retry SQLite contention or misreport it as a confirmed stale edit', async () => {
    const other = fixture.connect();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = other.$transaction(async (transaction) => {
      await transaction.game.update({
        where: { id: 'game-1' },
        data: { notes: 'Concurrent writer' },
      });
      locked.resolve();
      await release.promise;
    });
    void writer.catch(locked.reject);
    await locked.promise;
    try {
      const outcome = await mutations
        .reorderSeatOrder('1', 'user-1', intent)
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).not.toBeInstanceOf(ConflictException);
    } finally {
      release.resolve();
      await writer;
    }
    const after = await persistedState();
    expect(after.games[0]).toMatchObject({
      turnRevision: 0,
      notes: 'Concurrent writer',
    });
    expect(after.history).toHaveLength(1);
    expect(after.audits).toEqual([]);
  });

  it('keeps actual seat-order uniqueness, open-record uniqueness and foreign keys enabled', async () => {
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
    await expect(
      fixture.db.turnRecord.create({
        data: {
          gameId: 'game-1',
          playerDisplayName: 'Duplicate',
          roundNumber: 4,
          startedAt,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await mutations.reorderSeatOrder('1', 'user-1', {
      baseline,
      seatEntryIds: ['seat-2', 'seat-open'],
      removedSeatEntryIds: ['seat-1'],
    });
    expect(
      await fixture.db.turnRecord.count({ where: { endedAt: null } }),
    ).toBe(1);
    expect(
      await fixture.db.$queryRawUnsafe('PRAGMA foreign_key_check'),
    ).toEqual([]);
  });

  it.each([
    'inactive occupant',
    'active occupant',
    'membership added',
    'membership removed',
    'inactive order',
    'inactive role',
    'round',
    'active seat',
    'seat capacity',
  ])(
    'rejects changed %s before admission even from a writer without revision support',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'inactive occupant')
          await other.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { userId: 'user-3' },
          });
        if (change === 'active occupant')
          await other.gamePlayer.update({
            where: { id: 'seat-1' },
            data: { userId: 'user-3' },
          });
        if (change === 'membership added')
          await other.gamePlayer.create({
            data: { gameId: 'game-1', turnOrder: 4 },
          });
        if (change === 'membership removed')
          await other.gamePlayer.delete({ where: { id: 'seat-open' } });
        if (change === 'inactive order')
          await other.gamePlayer.update({
            where: { id: 'seat-open' },
            data: { turnOrder: 0 },
          });
        if (change === 'inactive role')
          await other.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { role: 'ORGANIZER' },
          });
        if (change === 'round')
          await other.turnState.update({
            where: { gameId: 'game-1' },
            data: { roundNumber: 5 },
          });
        if (change === 'active seat')
          await other.turnState.update({
            where: { gameId: 'game-1' },
            data: { activePlayerEntryId: 'seat-2', activePlayerId: 'user-2' },
          });
        if (change === 'seat capacity')
          await other.game.update({
            where: { id: 'game-1' },
            data: { playerCount: 4 },
          });
        afterChange = await persistedState(other);
      });
      await expect(
        mutations.reorderSeatOrder('1', 'user-1', intent),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it('rejects a competing edit followed by its reversal, including an otherwise no-op submission', async () => {
    let afterChange: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      const competitor = new TurnMutationsService(
        other,
        new TurnRecordsService(),
      );
      await competitor.reorderSeatOrder('1', 'user-1', {
        baseline,
        seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
      });
      await competitor.reorderSeatOrder('1', 'user-1', {
        ...intent,
        baseline: { campaignId: 'game-1', revision: 1 },
      });
      afterChange = await persistedState(other);
    });
    await expect(
      mutations.reorderSeatOrder('1', 'user-1', intent),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(afterChange!);
    expect(afterChange!.games[0].turnRevision).toBe(2);
  });

  it('revalidates local Overlord authority before commitment', async () => {
    let afterChange: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      await other.game.update({
        where: { id: 'game-1' },
        data: { organizerId: 'user-2' },
      });
      afterChange = await persistedState(other);
    });
    await expect(
      mutations.reorderSeatOrder('1', 'user-1', intent),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await persistedState()).toEqual(afterChange!);
  });

  it('looks up remote shadow permission only outside the transaction and still fences local ownership changes', async () => {
    let admitted = false;
    const authService = {
      isUserShadowOverride: vi.fn(async () => {
        expect(admitted).toBe(false);
        return true;
      }),
    };
    mutations = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
      authService,
    });
    beforeTransaction(async () => {
      admitted = true;
    });
    await mutations.reorderSeatOrder('1', 'user-3', {
      baseline,
      seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
    });
    expect(authService.isUserShadowOverride).toHaveBeenCalledExactlyOnceWith(
      'user-3',
    );
    admitted = false;
    let afterChange: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      admitted = true;
      await other.game.update({
        where: { id: 'game-1' },
        data: { organizerId: 'user-2' },
      });
      afterChange = await persistedState(other);
    });
    await expect(
      mutations.reorderSeatOrder('1', 'user-3', {
        ...intent,
        baseline: { campaignId: 'game-1', revision: 1 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(afterChange!);
  });

  it('keeps authentication, missing campaign and permission errors distinct, without local writes', async () => {
    const before = await persistedState();
    await expect(
      mutations.reorderSeatOrder('1', undefined, intent),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      mutations.reorderSeatOrder('missing', 'user-1', intent),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      mutations.reorderSeatOrder('1', 'user-2', intent),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const authService = { isUserShadowOverride: vi.fn(async () => false) };
    mutations = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
      authService,
    });
    await expect(
      mutations.reorderSeatOrder('1', 'user-3', intent),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await mutations.reorderSeatOrder('1', 'user-1', intent);
    expect(authService.isUserShadowOverride).toHaveBeenCalledExactlyOnceWith(
      'user-3',
    );
    expect(await persistedState()).toEqual(before);
  });

  it('uses current cosmetic values and reminder policy without treating them as stale intent', async () => {
    beforeTransaction(async (other) => {
      await other.game.update({
        where: { id: 'game-1' },
        data: { turnRemindersEnabled: false, notes: 'New notes' },
      });
      await other.user.update({
        where: { id: 'user-2' },
        data: { displayName: 'New name' },
      });
    });
    const result = await mutations.reorderSeatOrder('1', 'user-1', {
      ...intent,
      activePlayerEntryId: 'seat-2',
    });
    expect(result.players[1].displayName).toBe('New name');
    const after = await persistedState();
    expect(
      after.history.find((record) => record.endedAt == null),
    ).toMatchObject({ playerDisplayName: 'New name', nextReminderAt: null });
    expect(after.games[0]).toMatchObject({
      turnRevision: 1,
      notes: 'New notes',
    });
  });

  it('leaves an uninitialized campaign without active state or history', async () => {
    await fixture.db.turnRecord.deleteMany();
    await fixture.db.turnState.deleteMany();
    await mutations.reorderSeatOrder('1', 'user-1', {
      baseline,
      seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
      activePlayerEntryId: 'seat-2',
    });
    const after = await persistedState();
    expect(after.turns).toEqual([]);
    expect(after.history).toEqual([]);
    expect(after.games[0].turnRevision).toBe(1);
    await mutations.reorderSeatOrder('1', 'user-1', {
      baseline: { campaignId: 'game-1', revision: 1 },
      seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
      activePlayerEntryId: 'seat-1',
    });
    expect((await persistedState()).games[0].turnRevision).toBe(1);
  });

  it.each([
    'mismatched occupant',
    'empty active seat',
    'foreign active seat',
    'ambiguous legacy occupant',
  ])('rejects an invalid active participant: %s', async (invalid) => {
    if (invalid === 'mismatched occupant')
      await fixture.db.turnState.update({
        where: { gameId: 'game-1' },
        data: { activePlayerId: 'user-2' },
      });
    if (invalid === 'empty active seat')
      await fixture.db.gamePlayer.update({
        where: { id: 'seat-1' },
        data: { userId: null },
      });
    if (invalid === 'foreign active seat') {
      await fixture.db.game.create({
        data: {
          gameNumber: 2,
          slug: 'other',
          name: 'Other',
          organizerId: 'user-1',
          players: {
            create: { id: 'foreign', turnOrder: 1, userId: 'user-1' },
          },
        },
      });
      await fixture.db.turnState.update({
        where: { gameId: 'game-1' },
        data: { activePlayerEntryId: 'foreign' },
      });
    }
    if (invalid === 'ambiguous legacy occupant') {
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
    await expect(
      mutations.reorderSeatOrder('1', 'user-1', intent),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(before);
  });

  it('resolves an unambiguous legacy active seat without resetting the timer', async () => {
    await fixture.db.turnState.update({
      where: { gameId: 'game-1' },
      data: { activePlayerEntryId: null },
    });
    const before = await persistedState();
    await mutations.reorderSeatOrder('1', 'user-1', {
      baseline,
      seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
    });
    const after = await persistedState();
    expect(after.history).toEqual(before.history);
    expect(after.turns).toEqual(before.turns);
    expect(after.games[0].turnRevision).toBe(1);
  });

  it.each(['clear', 'remove', 'select'])(
    'commits active %s with continuous timing, retained round and pending-only nudge cancellation',
    async (action) => {
      await seedDeliveries();
      const before = await persistedState();
      const result = await mutations.reorderSeatOrder('1', 'user-1', {
        baseline,
        seatEntryIds:
          action === 'remove' ? ['seat-2', 'seat-open'] : intent.seatEntryIds,
        ...(action === 'clear' ? { clearedSeatEntryIds: ['seat-1'] } : {}),
        ...(action === 'remove' ? { removedSeatEntryIds: ['seat-1'] } : {}),
        ...(action === 'select' ? { activePlayerEntryId: 'seat-2' } : {}),
      });
      expect(result.activePlayerEntryId).toBe('seat-2');
      const after = await persistedState();
      expect(after.games[0]).toMatchObject({
        organizerId: 'user-1',
        turnRevision: 1,
        playerCount: action === 'remove' ? 2 : 3,
      });
      expect(after.turns[0]).toMatchObject({
        activePlayerId: 'user-2',
        activePlayerEntryId: 'seat-2',
        roundNumber: 4,
      });
      expect(after.history).toHaveLength(2);
      const open = after.history.filter((record) => record.endedAt == null);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        gamePlayerId: 'seat-2',
        userId: 'user-2',
        roundNumber: 4,
        seatNumber: action === 'remove' ? 1 : 2,
      });
      expect(
        after.history.find((record) => record.id === 'turn-1'),
      ).toMatchObject({
        gamePlayerId: action === 'remove' ? null : 'seat-1',
        userId: 'user-1',
        seatNumber: 1,
        playerDisplayName: 'Overlord',
        startedAt,
        endedAt: open[0].startedAt,
        nextReminderAt: null,
        completionReason: 'REASSIGNED',
        roundNumber: 4,
      });
      expect(
        open[0].nextReminderAt!.getTime() - open[0].startedAt.getTime(),
      ).toBe(36 * 60 * 60 * 1000);
      expect(
        after.reminders.find((delivery) => delivery.id === 'PENDING'),
      ).toMatchObject({ status: 'CANCELLED' });
      expect(
        after.reminders.filter((delivery) => delivery.id !== 'PENDING'),
      ).toEqual(
        before.reminders.filter((delivery) => delivery.id !== 'PENDING'),
      );
      if (action === 'clear')
        expect(after.seats.find((seat) => seat.id === 'seat-1')).toMatchObject({
          userId: null,
          role: 'PLAYER',
        });
      if (action === 'remove')
        expect(after.seats.map((seat) => seat.id)).toEqual([
          'seat-2',
          'seat-open',
        ]);
      expect(after.audits).toHaveLength(1);
      expect(after.audits[0]).toMatchObject({
        eventType: 'TURN_REASSIGNED',
        actorId: 'user-1',
      });
      expect(JSON.parse(after.audits[0].payload)).toMatchObject({
        previousActivePlayerEntryId: 'seat-1',
        previousActivePlayerId: 'user-1',
        nextActivePlayerEntryId: 'seat-2',
        nextActivePlayerId: 'user-2',
      });
      // Campaign ownership is independent of having an occupied seat.
      await mutations.reorderSeatOrder('1', 'user-1', {
        baseline: { campaignId: 'game-1', revision: 1 },
        seatEntryIds: result.players.map((seat) => seat.seatEntryId),
      });
      expect((await persistedState()).games[0].turnRevision).toBe(1);
    },
  );

  it('commits one revision for combined reorder, inactive clear, removal, and reassignment', async () => {
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-open' },
      data: { userId: 'user-3' },
    });
    const result = await mutations.reorderSeatOrder('1', 'user-1', {
      baseline,
      seatEntryIds: ['seat-open', 'seat-2'],
      clearedSeatEntryIds: ['seat-2'],
      removedSeatEntryIds: ['seat-1'],
      activePlayerEntryId: 'seat-open',
    });
    expect(result.players).toEqual([
      { seatEntryId: 'seat-open', turnOrder: 1, displayName: 'Replacement' },
      { seatEntryId: 'seat-2', turnOrder: 2, displayName: null },
    ]);
    const after = await persistedState();
    expect(after.games[0]).toMatchObject({
      turnRevision: 1,
      playerCount: 2,
      organizerId: 'user-1',
    });
    expect(after.history).toHaveLength(2);
    expect(after.turns[0]).toMatchObject({
      activePlayerEntryId: 'seat-open',
      activePlayerId: 'user-3',
      roundNumber: 4,
    });
  });

  it('clears then removes an inactive seat without resetting timing or reminders', async () => {
    await seedDeliveries();
    const before = await persistedState();
    await mutations.reorderSeatOrder('1', 'user-1', {
      ...intent,
      clearedSeatEntryIds: ['seat-2'],
    });
    expect(
      (await persistedState()).seats.find((seat) => seat.id === 'seat-2'),
    ).toMatchObject({ userId: null, turnOrder: 2 });
    await mutations.reorderSeatOrder('1', 'user-1', {
      baseline: { campaignId: 'game-1', revision: 1 },
      seatEntryIds: ['seat-1', 'seat-open'],
      removedSeatEntryIds: ['seat-2'],
    });
    const after = await persistedState();
    expect(after.games[0]).toMatchObject({ turnRevision: 2, playerCount: 2 });
    expect(after.seats.map((seat) => seat.id)).toEqual(['seat-1', 'seat-open']);
    expect(after.history).toEqual(before.history);
    expect(after.reminders).toEqual(before.reminders);
    expect(after.turns).toEqual(before.turns);
  });

  it('rolls back every effect when a real late trigger fails after roster, history, reminders, and audit writes', async () => {
    await seedDeliveries();
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-open' },
      data: { userId: 'user-3' },
    });
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_seat_edit AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'TURN_REASSIGNED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT playerCount FROM Game WHERE id = NEW.gameId) = 2
      AND (SELECT COUNT(*) FROM GamePlayer WHERE gameId = NEW.gameId) = 2
      AND (SELECT turnOrder FROM GamePlayer WHERE id = 'seat-2') = 1
      AND (SELECT userId FROM GamePlayer WHERE id = 'seat-2') IS NULL
      AND (SELECT activePlayerEntryId FROM TurnState WHERE gameId = NEW.gameId) = 'seat-open'
      AND (SELECT COUNT(*) FROM TurnRecord WHERE gameId = NEW.gameId) = 2
      AND (SELECT status FROM NotificationDelivery WHERE id = 'PENDING') = 'CANCELLED'
      BEGIN SELECT RAISE(ABORT, 'injected late Seat Order failure'); END`);
    const before = await persistedState();
    const edit = {
      baseline,
      seatEntryIds: ['seat-2', 'seat-open'],
      removedSeatEntryIds: ['seat-1'],
      clearedSeatEntryIds: ['seat-2'],
      activePlayerEntryId: 'seat-open',
    };
    await expect(
      mutations.reorderSeatOrder('1', 'user-1', edit),
    ).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_seat_edit');
    await mutations.reorderSeatOrder('1', 'user-1', edit);
    expect((await persistedState()).games[0].turnRevision).toBe(1);
  });

  it.each([
    { seatEntryIds: [] },
    { seatEntryIds: ['seat-1', 'seat-1', 'seat-open'] },
    { seatEntryIds: ['seat-1', 'foreign', 'seat-open'] },
    { seatEntryIds: ['seat-1', 'seat-2'] },
    { ...intent, clearedSeatEntryIds: ['seat-2', 'seat-2'] },
    { ...intent, clearedSeatEntryIds: ['foreign'] },
    { ...intent, removedSeatEntryIds: ['seat-open', 'seat-open'] },
    { ...intent, removedSeatEntryIds: ['foreign'] },
    { ...intent, removedSeatEntryIds: ['seat-open'] },
    {
      seatEntryIds: ['seat-1', 'seat-open'],
      clearedSeatEntryIds: ['seat-2'],
      removedSeatEntryIds: ['seat-2'],
    },
    { ...intent, clearedSeatEntryIds: ['seat-1', 'seat-2'] },
    { seatEntryIds: ['seat-open'], removedSeatEntryIds: ['seat-1', 'seat-2'] },
    { ...intent, activePlayerEntryId: 'foreign' },
    { ...intent, activePlayerEntryId: 'seat-open' },
    {
      ...intent,
      activePlayerEntryId: 'seat-2',
      clearedSeatEntryIds: ['seat-2'],
    },
    {
      seatEntryIds: ['seat-1', 'seat-open'],
      removedSeatEntryIds: ['seat-2'],
      activePlayerEntryId: 'seat-2',
    },
  ])(
    'rejects invalid intent without consuming a revision: %j',
    async (edit) => {
      const before = await persistedState();
      await expect(
        mutations.reorderSeatOrder('1', 'user-1', { ...edit, baseline }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await persistedState()).toEqual(before);
    },
  );

  it.each([
    'missing',
    'mismatched user',
    'mismatched seat',
    'mismatched round',
  ])(
    'rejects %s open history even when retaining the active participant',
    async (change) => {
      if (change === 'missing') await fixture.db.turnRecord.deleteMany();
      else
        await fixture.db.turnRecord.update({
          where: { id: 'turn-1' },
          data: {
            ...(change === 'mismatched user' ? { userId: 'user-2' } : {}),
            ...(change === 'mismatched seat' ? { gamePlayerId: 'seat-2' } : {}),
            ...(change === 'mismatched round' ? { roundNumber: 5 } : {}),
          },
        });
      const before = await persistedState();
      await expect(
        mutations.reorderSeatOrder('1', 'user-1', intent),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(before);
    },
  );

  it.each([
    [1, 2, 3],
    [7, -2147483648, 2147483647],
  ])(
    'normalizes actual unique orders %j while preserving stable seats and the active timer',
    async (first, second, third) => {
      for (const [id, turnOrder] of [
        ['seat-1', first],
        ['seat-2', second],
        ['seat-open', third],
      ] as const) {
        await fixture.db.gamePlayer.update({
          where: { id },
          data: { turnOrder },
        });
      }
      const before = await persistedState();
      const result = await mutations.reorderSeatOrder('game-1', 'user-1', {
        baseline,
        seatEntryIds: ['seat-2', 'seat-1', 'seat-open'],
        activePlayerEntryId: 'seat-1',
      });
      expect(result.players).toEqual([
        { seatEntryId: 'seat-2', turnOrder: 1, displayName: 'Other' },
        { seatEntryId: 'seat-1', turnOrder: 2, displayName: 'Overlord' },
        { seatEntryId: 'seat-open', turnOrder: 3, displayName: null },
      ]);
      const after = await persistedState();
      expect(after.seats).toEqual(
        before.seats.map((seat) => ({
          ...seat,
          turnOrder: seat.id === 'seat-1' ? 2 : seat.id === 'seat-2' ? 1 : 3,
        })),
      );
      expect(after.history).toEqual(before.history);
      expect(after.turns).toEqual(before.turns);
      expect(after.games[0].turnRevision).toBe(1);
      expect(after.audits).toHaveLength(1);
    },
  );

  it('leaves revision, timer, roster and audits unchanged for effective no-ops', async () => {
    const before = await persistedState();
    expect(
      await mutations.reorderSeatOrder('ashes', 'user-1', {
        ...intent,
        clearedSeatEntryIds: ['seat-open'],
        activePlayerEntryId: 'seat-1',
      }),
    ).toEqual({
      gameId: 'game-1',
      slug: 'ashes',
      name: 'Ashes',
      activePlayerEntryId: 'seat-1',
      seatOrder: {
        gameId: 'game-1',
        slug: 'ashes',
        name: 'Ashes',
        organizerId: 'user-1',
        players: [
          {
            id: 'seat-1',
            userId: 'user-1',
            displayName: 'Overlord',
            turnOrder: 1,
            isOrganizer: true,
          },
          {
            id: 'seat-2',
            userId: 'user-2',
            displayName: 'Other',
            turnOrder: 2,
            isOrganizer: false,
          },
          {
            id: 'seat-open',
            userId: null,
            displayName: null,
            turnOrder: 3,
            isOrganizer: false,
          },
        ],
        activePlayerEntryId: 'seat-1',
        activePlayerUserId: 'user-1',
        roundNumber: 4,
        seatOrderBaseline: baseline,
      },
      players: [
        { seatEntryId: 'seat-1', turnOrder: 1, displayName: 'Overlord' },
        { seatEntryId: 'seat-2', turnOrder: 2, displayName: 'Other' },
        { seatEntryId: 'seat-open', turnOrder: 3, displayName: null },
      ],
    });
    expect(await persistedState()).toEqual(before);
  });

  it('existing entrypoint never overwrites a replacement in an inactive seat', async () => {
    const service = new GamesTurnService(mutations);
    let afterChange: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      await other.gamePlayer.update({
        where: { id: 'seat-2' },
        data: { userId: 'user-3' },
      });
      afterChange = await persistedState(other);
    });
    const outcome = await service.reorderSeatOrder('1', 'user-1', intent).then(
      () => null,
      (error: unknown) => error,
    );
    expect(
      await fixture.db.gamePlayer.findUniqueOrThrow({
        where: { id: 'seat-2' },
      }),
    ).toMatchObject({ userId: 'user-3' });
    expect(outcome).toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(afterChange!);
  });
});
