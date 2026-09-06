import { ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

// GamesService still imports transport services that use the application DB.
// The mutation boundary below is injected with an independently migrated DB.
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  prisma: {},
}));
const { GamesService } = await import('../src/games/games.service');

const startedAt = new Date('2026-07-10T00:00:00.000Z');
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  await fixture.db.user.createMany({
    data: [
      { id: 'owner', email: 'owner@example.com', displayName: 'Overlord' },
      { id: 'shadow', email: 'shadow@example.com', displayName: 'Shadow' },
    ],
  });
  await fixture.db.game.create({
    data: {
      id: 'game',
      slug: 'ashes',
      gameNumber: 1,
      name: 'Ashes',
      organizerId: 'owner',
      discordThreadId: 'thread',
      playerCount: 1,
      players: {
        create: {
          id: 'seat',
          userId: 'owner',
          role: 'ORGANIZER',
          turnOrder: 1,
        },
      },
      turnState: {
        create: {
          activePlayerId: 'owner',
          activePlayerEntryId: 'seat',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn',
          gamePlayerId: 'seat',
          userId: 'owner',
          seatNumber: 1,
          roundNumber: 4,
          playerDisplayName: 'Overlord',
          startedAt,
          nextReminderAt: new Date('2026-07-11T12:00:00.000Z'),
        },
      },
    },
  });
});
afterEach(async () => {
  await fixture?.close();
});

function createMutations(shadowOverride = false) {
  const notifyThreadRenamed = vi.fn(async () => undefined);
  const mutations = new TurnMutationsService(
    fixture.db,
    new TurnRecordsService(),
    {
      authService: { isUserShadowOverride: async () => shadowOverride },
      botNotifications: {
        notifyThreadRenamed,
        notifySaveUploaded: vi.fn(),
        notifyGameInitialized: vi.fn(),
      },
    },
  );
  return { mutations, notifyThreadRenamed };
}

describe('turn policy through the mutation boundary', () => {
  it.each([
    ['owner', false],
    ['shadow', true],
  ] as const)(
    'allows %s to edit policy without advancing revision',
    async (userId, shadowOverride) => {
      await createMutations(shadowOverride).mutations.updateGameMetadata(
        'game',
        userId,
        { turnTargetHours: 48 },
      );
      expect(
        await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
      ).toMatchObject({ turnTargetHours: 48, turnRevision: 0 });
      expect(
        await fixture.db.turnRecord.findUniqueOrThrow({
          where: { id: 'turn' },
        }),
      ).toMatchObject({
        startedAt,
        nextReminderAt: new Date('2026-07-12T12:00:00.000Z'),
      });
      expect(await fixture.db.auditEvent.findFirstOrThrow()).toMatchObject({
        actorId: userId,
      });
    },
  );

  it('rejects an unauthorized policy edit without audit or notification', async () => {
    const { mutations, notifyThreadRenamed } = createMutations();
    await expect(
      mutations.updateGameMetadata('game', 'shadow', { turnTargetHours: 48 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await fixture.db.auditEvent.count()).toBe(0);
    expect(notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it('clears due time and cancels only pending nudges when reminders are disabled', async () => {
    for (const status of [
      'PENDING',
      'PROCESSING',
      'DELIVERED',
      'FAILED',
    ] as const) {
      await fixture.db.notificationDelivery.create({
        data: {
          id: status,
          status,
          event: 'TURN_NUDGE',
          gameId: 'game',
          gameSlug: 'ashes',
          turnRecordId: 'turn',
          payload: '{}',
        },
      });
    }
    await fixture.db.notificationDelivery.create({
      data: {
        id: 'save',
        event: 'SAVE_UPLOADED',
        gameId: 'game',
        gameSlug: 'ashes',
        turnRecordId: 'turn',
        payload: '{}',
      },
    });
    const others = await fixture.db.notificationDelivery.findMany({
      where: { id: { not: 'PENDING' } },
      orderBy: { id: 'asc' },
    });
    await createMutations().mutations.updateGameMetadata('game', 'owner', {
      turnRemindersEnabled: false,
    });
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({ where: { id: 'turn' } }),
    ).toMatchObject({ startedAt, nextReminderAt: null });
    expect(
      await fixture.db.notificationDelivery.findUniqueOrThrow({
        where: { id: 'PENDING' },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
    expect(
      await fixture.db.notificationDelivery.findMany({
        where: { id: { not: 'PENDING' } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(others);
    expect(
      JSON.parse((await fixture.db.auditEvent.findFirstOrThrow()).payload),
    ).toMatchObject({ nextMetadata: { turnRemindersEnabled: false } });
  });

  it('recalculates a reminded open turn from its latest reminder', async () => {
    const lastReminderAt = new Date('2026-07-12T08:00:00.000Z');
    await fixture.db.turnRecord.update({
      where: { id: 'turn' },
      data: { reminderCount: 1, lastReminderAt },
    });
    await createMutations().mutations.updateGameMetadata('game', 'owner', {
      turnReminderRepeatHours: 6,
    });
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({ where: { id: 'turn' } }),
    ).toMatchObject({
      startedAt,
      lastReminderAt,
      reminderCount: 1,
      nextReminderAt: new Date('2026-07-12T14:00:00.000Z'),
    });
  });

  it('keeps an undelivered turn on its first-reminder schedule after a repeat edit', async () => {
    await createMutations().mutations.updateGameMetadata('game', 'owner', {
      turnReminderRepeatHours: 6,
    });
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({ where: { id: 'turn' } }),
    ).toMatchObject({
      startedAt,
      lastReminderAt: null,
      reminderCount: 0,
      nextReminderAt: new Date('2026-07-11T12:00:00.000Z'),
    });
  });

  it('merges current policy and excluded metadata instead of writing the pre-read values', async () => {
    const other = fixture.connect();
    const transact = fixture.db.$transaction.bind(fixture.db);
    vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
      async (...args) => {
        await other.game.update({
          where: { id: 'game' },
          data: {
            turnReminderGraceHours: 6,
            name: 'Renamed',
            notes: 'Concurrent notes',
          },
        });
        return transact(...args);
      },
    );
    const response = await createMutations().mutations.updateGameMetadata(
      'game',
      'owner',
      { turnTargetHours: 48, roundNumber: 5 },
    );
    expect(response).toMatchObject({
      turnTargetHours: 48,
      turnReminderGraceHours: 6,
      name: 'Renamed',
      notes: 'Concurrent notes',
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({
      turnRevision: 1,
      turnReminderGraceHours: 6,
      name: 'Renamed',
      notes: 'Concurrent notes',
    });
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({ where: { id: 'turn' } }),
    ).toMatchObject({
      startedAt,
      nextReminderAt: new Date('2026-07-12T06:00:00.000Z'),
    });
    expect(
      JSON.parse((await fixture.db.auditEvent.findFirstOrThrow()).payload),
    ).toMatchObject({
      previousMetadata: {
        turnReminderGraceHours: 6,
        name: 'Renamed',
        notes: 'Concurrent notes',
      },
      nextMetadata: {
        turnTargetHours: 48,
        turnReminderGraceHours: 6,
        name: 'Renamed',
        notes: 'Concurrent notes',
      },
    });
  });

  it('does not recalculate or cancel pending consequences for an effective policy no-op', async () => {
    await fixture.db.notificationDelivery.create({
      data: {
        id: 'pending',
        event: 'TURN_NUDGE',
        gameId: 'game',
        gameSlug: 'ashes',
        turnRecordId: 'turn',
        payload: '{}',
      },
    });
    const before = await fixture.db.turnRecord.findMany();
    const nudges = await fixture.db.notificationDelivery.findMany();
    await createMutations().mutations.updateGameMetadata('game', 'owner', {
      turnTargetHours: 24,
      turnReminderGraceHours: 12,
      turnReminderRepeatHours: 24,
      turnRemindersEnabled: true,
    });
    expect(await fixture.db.turnRecord.findMany()).toEqual(before);
    expect(await fixture.db.notificationDelivery.findMany()).toEqual(nudges);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 0 });
  });

  it('synchronizes only the open round and preserves its timer', async () => {
    await createMutations().mutations.updateGameMetadata('game', 'owner', {
      roundNumber: 5,
    });
    expect(
      await fixture.db.turnState.findUniqueOrThrow({
        where: { gameId: 'game' },
      }),
    ).toMatchObject({ roundNumber: 5 });
    expect(await fixture.db.turnRecord.findMany()).toEqual([
      expect.objectContaining({
        id: 'turn',
        roundNumber: 5,
        startedAt,
        endedAt: null,
      }),
    ]);
  });

  it('notifies only after the mixed transaction is externally visible', async () => {
    const { mutations, notifyThreadRenamed } = createMutations();
    notifyThreadRenamed.mockImplementationOnce(async () => {
      const external = fixture.connect();
      expect(
        await external.game.findUniqueOrThrow({ where: { id: 'game' } }),
      ).toMatchObject({ name: 'New Ashes', turnRevision: 1 });
      expect(
        await external.turnState.findUniqueOrThrow({
          where: { gameId: 'game' },
        }),
      ).toMatchObject({ roundNumber: 5 });
      expect(await external.auditEvent.count()).toBe(1);
    });
    await mutations.updateGameMetadata('game', 'owner', {
      name: 'New Ashes',
      roundNumber: 5,
      playerCount: 2,
    });
    expect(notifyThreadRenamed).toHaveBeenCalledWith({
      game: {
        id: 'game',
        slug: 'ashes',
        name: 'New Ashes',
        discordThreadId: 'thread',
        threadName: '\u{1f538}1 : New Ashes (2S)',
      },
    });
  });

  it('does not notify after rollback', async () => {
    const { mutations, notifyThreadRenamed } = createMutations();
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER reject_metadata AFTER INSERT ON AuditEvent
      BEGIN SELECT RAISE(ABORT, 'rejected'); END`);
    await expect(
      mutations.updateGameMetadata('game', 'owner', {
        name: 'New Ashes',
        roundNumber: 5,
      }),
    ).rejects.toThrow();
    expect(notifyThreadRenamed).not.toHaveBeenCalled();
  });

  it('GamesService delegates the whole mixed submission to the injected mutation boundary', async () => {
    const { mutations } = createMutations();
    const service = new GamesService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      mutations,
    );
    expect(
      await service.updateGameMetadata('game', 'owner', {
        name: 'New Ashes',
        roundNumber: 5,
        playerCount: 2,
        turnTargetHours: 48,
      }),
    ).toMatchObject({
      name: 'New Ashes',
      roundNumber: 5,
      playerCount: 2,
      turnTargetHours: 48,
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 1 });
    expect(await fixture.db.auditEvent.count()).toBe(1);
  });
});
