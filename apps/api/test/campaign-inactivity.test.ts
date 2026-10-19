import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sweepCampaignInactivity } from '../src/games/support/campaign-inactivity';
import { createSqliteFixture } from './support/sqlite-fixture';

const DAY = 24 * 60 * 60 * 1000;
const lastActivityAt = new Date('2026-06-01T00:00:00.000Z');
const daysAfterActivity = (days: number) =>
  new Date(lastActivityAt.getTime() + days * DAY);

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let storage: {
  removeFileOrThrow: ReturnType<typeof vi.fn>;
  removeGameDirectory: ReturnType<typeof vi.fn>;
};

const sweepWithoutPosting = (now: Date) =>
  sweepCampaignInactivity(fixture.db, storage, now);

const settleWarnings = (status: 'DELIVERED' | 'FAILED') =>
  fixture.db.notificationDelivery.updateMany({
    where: { event: 'INACTIVITY_WARNING', status: 'PENDING' },
    data: { status },
  });

const sweep = async (now: Date) => {
  await sweepWithoutPosting(now);
  await settleWarnings('DELIVERED');
};

const warnings = async () =>
  (
    await fixture.db.notificationDelivery.findMany({
      where: { event: 'INACTIVITY_WARNING' },
      orderBy: { createdAt: 'asc' },
    })
  ).map((delivery) => JSON.parse(delivery.payload));

beforeEach(async () => {
  fixture = await createSqliteFixture();
  storage = {
    removeFileOrThrow: vi.fn(async () => undefined),
    removeGameDirectory: vi.fn(async () => undefined),
  };
  const { db } = fixture;
  for (const [id, name, discordId] of [
    ['user-1', 'Alpha', 'discord-1'],
    ['user-2', 'Overlord', 'discord-2'],
    ['user-3', 'Gamma', null],
  ] as const) {
    await db.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        displayName: name,
        ...(discordId
          ? {
              identities: {
                create: { provider: 'discord', providerId: discordId },
              },
            }
          : {}),
      },
    });
  }
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 7,
      name: 'Ashes',
      slug: 'ashes',
      discordThreadId: 'thread-1',
      organizerId: 'user-2',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', turnOrder: 1 },
          { id: 'seat-2', userId: 'user-2', turnOrder: 2, role: 'ORGANIZER' },
          { id: 'seat-3', userId: null, turnOrder: 3 },
          { id: 'seat-4', userId: 'user-3', turnOrder: 4 },
        ],
      },
      auditEvents: {
        create: {
          actorId: 'user-1',
          eventType: 'FILE_UPLOADED',
          payload: '{}',
          createdAt: lastActivityAt,
        },
      },
    },
  });
});

afterEach(async () => {
  await fixture?.close();
});

describe('inactivity warnings', () => {
  it('warns every seated player once a campaign has had no activity for 30 days', async () => {
    await sweep(daysAfterActivity(30));

    expect(await warnings()).toEqual([
      {
        game: {
          id: 'game-1',
          gameNumber: 7,
          slug: 'ashes',
          name: 'Ashes',
          discordThreadId: 'thread-1',
        },
        warning: {
          final: false,
          deletionDueAt: daysAfterActivity(60).toISOString(),
        },
        players: [
          { displayName: 'Alpha', discordId: 'discord-1' },
          { displayName: 'Overlord', discordId: 'discord-2' },
          { displayName: 'Gamma', discordId: null },
        ],
      },
    ]);
  });

  it('warns a dormant campaign only once', async () => {
    await sweep(daysAfterActivity(30));
    await sweep(daysAfterActivity(31));

    expect(await warnings()).toHaveLength(1);
  });

  it('does not count downloads or settings edits as activity', async () => {
    await fixture.db.auditEvent.createMany({
      data: [
        'FILE_DOWNLOADED',
        'METADATA_UPDATED',
        'REGISTRATION_REQUESTED',
      ].map((eventType) => ({
        gameId: 'game-1',
        eventType: eventType as 'FILE_DOWNLOADED',
        payload: '{}',
        createdAt: daysAfterActivity(20),
      })),
    });

    await sweep(new Date(daysAfterActivity(30).getTime() - 1));
    expect(await warnings()).toHaveLength(0);

    await sweep(daysAfterActivity(30));
    expect(await warnings()).toHaveLength(1);
  });

  it('restarts the 30 days after activity', async () => {
    await fixture.db.auditEvent.create({
      data: {
        gameId: 'game-1',
        eventType: 'TURN_SKIPPED',
        payload: '{}',
        createdAt: daysAfterActivity(10),
      },
    });

    await sweep(daysAfterActivity(30));
    expect(await warnings()).toHaveLength(0);

    await sweep(daysAfterActivity(40));
    expect(await warnings()).toEqual([
      expect.objectContaining({
        warning: {
          final: false,
          deletionDueAt: daysAfterActivity(70).toISOString(),
        },
      }),
    ]);
  });
});

describe('final inactivity warnings', () => {
  it('finally warns every seated player 2 days before deletion', async () => {
    await sweep(daysAfterActivity(30));
    await sweep(daysAfterActivity(57));
    expect(await warnings()).toHaveLength(1);

    await sweep(daysAfterActivity(58));
    await sweep(daysAfterActivity(59));

    const [, final, ...rest] = await warnings();
    expect(rest).toEqual([]);
    expect(final).toMatchObject({
      warning: {
        final: true,
        deletionDueAt: daysAfterActivity(60).toISOString(),
      },
      players: [
        { displayName: 'Alpha', discordId: 'discord-1' },
        { displayName: 'Overlord', discordId: 'discord-2' },
        { displayName: 'Gamma', discordId: null },
      ],
    });
  });
});

describe('inactivity deletion', () => {
  const deletions = async () =>
    (
      await fixture.db.notificationDelivery.findMany({
        where: { event: 'CAMPAIGN_DELETED' },
      })
    ).map((delivery) => JSON.parse(delivery.payload));

  it('deletes a dormant campaign and its saves 30 days after its warning', async () => {
    await fixture.db.fileVersion.create({
      data: {
        gameId: 'game-1',
        uploadedById: 'user-1',
        storagePath: 'game-1/save-1.se1',
        originalName: 'save-1.se1',
        versionNumber: 1,
      },
    });
    await sweep(daysAfterActivity(30));
    await sweep(daysAfterActivity(58));
    await sweep(new Date(daysAfterActivity(60).getTime() - 1));
    expect(await fixture.db.game.count()).toBe(1);

    await sweep(daysAfterActivity(60));

    expect(await fixture.db.game.count()).toBe(0);
    expect(await fixture.db.victoryRecord.count()).toBe(0);
    expect(await deletions()).toEqual([
      {
        game: {
          id: 'game-1',
          gameNumber: 7,
          slug: 'ashes',
          name: 'Ashes',
          discordThreadId: 'thread-1',
        },
        victory: null,
      },
    ]);
    expect(storage.removeGameDirectory).toHaveBeenCalledWith('game-1');
  });

  it('waits 2 days after a late final warning', async () => {
    await sweep(daysAfterActivity(30));
    await sweep(daysAfterActivity(65));
    expect(await fixture.db.game.count()).toBe(1);
    expect((await warnings())[1]).toMatchObject({
      warning: {
        final: true,
        deletionDueAt: daysAfterActivity(67).toISOString(),
      },
    });

    await sweep(daysAfterActivity(66));
    expect(await fixture.db.game.count()).toBe(1);

    await sweep(daysAfterActivity(67));
    expect(await fixture.db.game.count()).toBe(0);
  });

  it('warns long-idle campaigns instead of deleting them', async () => {
    await sweep(daysAfterActivity(400));

    expect(await fixture.db.game.count()).toBe(1);
    expect(await warnings()).toEqual([
      expect.objectContaining({
        warning: {
          final: false,
          deletionDueAt: daysAfterActivity(430).toISOString(),
        },
      }),
    ]);
  });

  it('spares a dormant campaign once activity happens', async () => {
    await sweep(daysAfterActivity(30));
    await fixture.db.auditEvent.create({
      data: {
        gameId: 'game-1',
        eventType: 'SAVE_REJECTED',
        payload: '{}',
        createdAt: daysAfterActivity(45),
      },
    });

    await sweep(daysAfterActivity(58));
    await sweep(daysAfterActivity(60));

    expect(await fixture.db.game.count()).toBe(1);
    expect(await warnings()).toHaveLength(1);
  });

  it('still deletes a campaign without a Discord thread', async () => {
    await fixture.db.game.update({
      where: { id: 'game-1' },
      data: { discordThreadId: null },
    });

    await sweep(daysAfterActivity(30));
    await sweep(daysAfterActivity(58));
    await sweep(daysAfterActivity(60));

    expect(await fixture.db.game.count()).toBe(0);
    expect(await fixture.db.notificationDelivery.count()).toBe(0);
  });

  it('leaves concluded campaigns to victory deletion', async () => {
    await fixture.db.victoryRecord.create({
      data: {
        gameId: 'game-1',
        gameNumber: 7,
        gameName: 'Ashes',
        victorDisplayName: 'Alpha',
        designatedByDisplayName: 'Overlord',
        designatedAt: daysAfterActivity(1),
      },
    });

    await sweep(daysAfterActivity(30));
    await sweep(daysAfterActivity(58));
    await sweep(daysAfterActivity(60));

    expect(await warnings()).toEqual([]);
    expect(await fixture.db.game.count()).toBe(1);
  });
});

describe('posting warnings', () => {
  it('waits for a warning to be posted before the next step', async () => {
    await sweepWithoutPosting(daysAfterActivity(30));
    await sweepWithoutPosting(daysAfterActivity(58));
    expect(await warnings()).toHaveLength(1);

    await settleWarnings('DELIVERED');
    await sweep(daysAfterActivity(58));
    expect(await warnings()).toHaveLength(2);
  });

  it('gives a warning that could not be posted again, restarting its clock', async () => {
    await sweepWithoutPosting(daysAfterActivity(30));
    await settleWarnings('FAILED');

    await sweep(daysAfterActivity(40));
    await sweep(daysAfterActivity(60));

    expect(await fixture.db.game.count()).toBe(1);
    expect((await warnings()).map((warning) => warning.warning)).toEqual([
      { final: false, deletionDueAt: daysAfterActivity(60).toISOString() },
      { final: false, deletionDueAt: daysAfterActivity(70).toISOString() },
    ]);
  });

  it('never deletes until 2 days after the final warning is given again', async () => {
    await sweep(daysAfterActivity(30));
    await sweepWithoutPosting(daysAfterActivity(58));
    await settleWarnings('FAILED');

    await sweep(daysAfterActivity(60));
    expect(await fixture.db.game.count()).toBe(1);
    expect((await warnings())[2]).toMatchObject({
      warning: {
        final: true,
        deletionDueAt: daysAfterActivity(62).toISOString(),
      },
    });

    await sweep(daysAfterActivity(62));
    expect(await fixture.db.game.count()).toBe(0);
  });

  it('drops a warning not yet posted once activity spares the campaign', async () => {
    await sweepWithoutPosting(daysAfterActivity(30));
    await fixture.db.auditEvent.create({
      data: {
        gameId: 'game-1',
        eventType: 'FILE_UPLOADED',
        payload: '{}',
        createdAt: daysAfterActivity(31),
      },
    });

    await sweepWithoutPosting(daysAfterActivity(32));

    expect(
      await fixture.db.notificationDelivery.findMany({
        select: { status: true },
      }),
    ).toEqual([{ status: 'CANCELLED' }]);
  });
});
