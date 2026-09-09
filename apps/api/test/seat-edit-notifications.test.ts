import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));
const { BotNotificationsService } =
  await import('../src/games/bot-notifications.service');
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let notifications: InstanceType<typeof BotNotificationsService>;
let campaign: TurnMutationsService;
let transportStatus: number;
const requests: Array<{
  url: string;
  body: unknown;
  activeSeat: string | null;
}> = [];

beforeEach(async () => {
  fixture = await createSqliteFixture();
  requests.length = 0;
  transportStatus = 204;
  vi.stubEnv('SHADOW_CLOUD_BOT_NOTIFY_SECRET', 'test-secret');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const state = await campaign.getSeatOrder('42', 'overlord');
      requests.push({
        url: String(url),
        body: JSON.parse(init.body),
        activeSeat: state.activePlayerEntryId,
      });
      return new Response(null, {
        status: String(url).endsWith('/notify/active-player-changed')
          ? transportStatus
          : 204,
      });
    }),
  );
  for (const id of ['overlord', 'last-registered']) {
    await fixture.db.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        displayName: id,
        identities: {
          create: { provider: 'discord', providerId: `discord-${id}` },
        },
      },
    });
  }
  await fixture.db.game.create({
    data: {
      id: 'campaign',
      gameNumber: 42,
      slug: 'ongoing',
      name: 'Ongoing',
      organizerId: 'overlord',
      discordThreadId: 'thread-42',
      playerCount: 2,
      players: {
        create: [
          { id: 'seat-1', userId: 'overlord', role: 'ORGANIZER', turnOrder: 1 },
          { id: 'seat-2', userId: 'last-registered', turnOrder: 2 },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'last-registered',
          activePlayerEntryId: 'seat-2',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          gamePlayerId: 'seat-2',
          userId: 'last-registered',
          seatNumber: 2,
          playerDisplayName: 'last-registered',
          roundNumber: 4,
          startedAt: new Date('2026-09-01T00:00:00Z'),
        },
      },
    },
  });
  notifications = new BotNotificationsService();
  campaign = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    botNotifications: notifications,
  });
});

afterEach(async () => {
  notifications?.onModuleDestroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fixture?.close();
});

it('announces the corrected active seat after an ongoing campaign commits, preserving its round', async () => {
  const before = await campaign.getSeatOrder('42', 'overlord');
  await campaign.reorderSeatOrder('42', 'overlord', {
    baseline: before.seatOrderBaseline,
    seatEntryIds: ['seat-1', 'seat-2'],
    activePlayerEntryId: 'seat-1',
  });
  expect(await campaign.getSeatOrder('42', 'overlord')).toMatchObject({
    activePlayerEntryId: 'seat-1',
    roundNumber: 4,
  });
  expect(requests).toEqual([]);
  notifications.onModuleInit();
  await vi.waitFor(() =>
    expect(requests).toEqual([
      {
        url: expect.stringContaining('/notify/active-player-changed'),
        activeSeat: 'seat-1',
        body: {
          game: {
            id: 'campaign',
            gameNumber: 42,
            slug: 'ongoing',
            name: 'Ongoing',
            discordThreadId: 'thread-42',
          },
          turn: {
            roundNumber: 4,
            activePlayer: {
              id: 'overlord',
              displayName: 'overlord',
              discordId: 'discord-overlord',
              turnOrder: 1,
            },
          },
        },
      },
    ]),
  );
});

async function flushNotifications() {
  // A public queue operation supplies a delivery barrier after the seat edit.
  const previousBarriers = requests.filter((request) =>
    request.url.endsWith('/notify/thread-rename'),
  ).length;
  await notifications.notifyThreadRenamed({
    game: {
      id: 'campaign',
      slug: 'ongoing',
      name: 'Ongoing',
      threadName: '42 - Ongoing',
      discordThreadId: 'thread-42',
    },
  });
  await vi.waitFor(() =>
    expect(
      requests.filter((request) =>
        request.url.endsWith('/notify/thread-rename'),
      ),
    ).toHaveLength(previousBarriers + 1),
  );
  return requests.filter((request) =>
    request.url.endsWith('/notify/active-player-changed'),
  );
}

it('does not announce a no-op or a roster reorder that keeps the same active seat', async () => {
  const before = await campaign.getSeatOrder('42', 'overlord');
  await campaign.reorderSeatOrder('42', 'overlord', {
    baseline: before.seatOrderBaseline,
    seatEntryIds: ['seat-1', 'seat-2'],
    activePlayerEntryId: 'seat-2',
  });
  expect(await campaign.getSeatOrder('42', 'overlord')).toEqual(before);
  await campaign.reorderSeatOrder('42', 'overlord', {
    baseline: before.seatOrderBaseline,
    seatEntryIds: ['seat-2', 'seat-1'],
  });
  expect(await campaign.getSeatOrder('42', 'overlord')).toMatchObject({
    activePlayerEntryId: 'seat-2',
    roundNumber: 4,
  });
  expect(await flushNotifications()).toEqual([]);
});

it('does not announce an active-seat change when a later write rolls back', async () => {
  const before = await campaign.getSeatOrder('42', 'overlord');
  await fixture.db.$executeRawUnsafe(`CREATE TRIGGER reject_seat_edit_audit
    BEFORE INSERT ON "AuditEvent" BEGIN SELECT RAISE(ABORT, 'seat edit audit rejected'); END`);
  await expect(
    campaign.reorderSeatOrder('42', 'overlord', {
      baseline: before.seatOrderBaseline,
      seatEntryIds: ['seat-1', 'seat-2'],
      activePlayerEntryId: 'seat-1',
    }),
  ).rejects.toThrow();
  expect(await campaign.getSeatOrder('42', 'overlord')).toEqual(before);
  expect(await flushNotifications()).toEqual([]);
});

it('announces the selected successor when the active seat is cleared', async () => {
  const before = await campaign.getSeatOrder('42', 'overlord');
  await campaign.reorderSeatOrder('42', 'overlord', {
    baseline: before.seatOrderBaseline,
    seatEntryIds: ['seat-1', 'seat-2'],
    clearedSeatEntryIds: ['seat-2'],
  });
  expect(await campaign.getSeatOrder('42', 'overlord')).toMatchObject({
    activePlayerEntryId: 'seat-1',
    roundNumber: 4,
    players: [
      expect.objectContaining({ id: 'seat-1', userId: 'overlord' }),
      expect.objectContaining({ id: 'seat-2', userId: null }),
    ],
  });
  notifications.onModuleInit();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    activeSeat: 'seat-1',
    body: {
      turn: {
        activePlayer: { id: 'overlord', turnOrder: 1 },
        roundNumber: 4,
      },
    },
  });
});

it('rolls back the seat edit when its notification cannot be queued', async () => {
  const before = await campaign.getSeatOrder('42', 'overlord');
  await fixture.db.$executeRawUnsafe(`CREATE TRIGGER reject_notification
    BEFORE INSERT ON "NotificationDelivery" BEGIN SELECT RAISE(ABORT, 'notification unavailable'); END`);
  await expect(
    campaign.reorderSeatOrder('42', 'overlord', {
      baseline: before.seatOrderBaseline,
      seatEntryIds: ['seat-1', 'seat-2'],
      activePlayerEntryId: 'seat-1',
    }),
  ).rejects.toThrow();
  expect(await campaign.getSeatOrder('42', 'overlord')).toEqual(before);
  await fixture.db.$executeRawUnsafe('DROP TRIGGER reject_notification');
  expect(await flushNotifications()).toEqual([]);
});

it('retries a transport failure after worker restart without losing the committed seat edit', async () => {
  const now = new Date(Date.now() + 60_000);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  transportStatus = 503;
  const before = await campaign.getSeatOrder('42', 'overlord');
  await campaign.reorderSeatOrder('42', 'overlord', {
    baseline: before.seatOrderBaseline,
    seatEntryIds: ['seat-1', 'seat-2'],
    activePlayerEntryId: 'seat-1',
  });
  const committed = await campaign.getSeatOrder('42', 'overlord');
  expect(committed).toMatchObject({
    activePlayerEntryId: 'seat-1',
    roundNumber: 4,
  });
  expect(requests).toEqual([]);

  // A fresh worker must discover the delivery using only the committed outbox.
  notifications.onModuleDestroy();
  notifications = new BotNotificationsService();
  notifications.onModuleInit();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const failed = await flushNotifications();
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatchObject({ activeSeat: 'seat-1' });
  expect(await campaign.getSeatOrder('42', 'overlord')).toEqual(committed);

  notifications.onModuleDestroy();
  transportStatus = 204;
  vi.setSystemTime(new Date(now.getTime() + 60_000));
  notifications = new BotNotificationsService();
  notifications.onModuleInit();
  await vi.waitFor(() =>
    expect(
      requests.filter((request) =>
        request.url.endsWith('/notify/active-player-changed'),
      ),
    ).toHaveLength(2),
  );
  expect(await flushNotifications()).toEqual([failed[0], failed[0]]);
  expect(await campaign.getSeatOrder('42', 'overlord')).toEqual(committed);

  vi.setSystemTime(new Date(now.getTime() + 120_000));
  expect(await flushNotifications()).toHaveLength(2);
});
