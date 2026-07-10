import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  notificationDelivery: {
    create: vi.fn(),
  },
}));

vi.mock('../src/database', () => ({
  NotificationDeliveryEvent: {
    SAVE_REPLACED: 'SAVE_REPLACED',
    TURN_NUDGE: 'TURN_NUDGE',
  },
  NotificationDeliveryStatus: {},
  prisma: prismaMock,
}));

const { BotNotificationsService } =
  await import('../src/games/bot-notifications.service');

const payload = {
  game: {
    id: 'game-1',
    gameNumber: 42,
    slug: 'the-game',
    name: 'The Game',
    discordThreadId: 'thread-1',
  },
  replacement: {
    versionId: 'version-1',
    versionNumber: 7,
    originalName: '42-T4-S2-Other.se1',
    replacedAt: '2026-07-10T14:30:00.000Z',
    replacedBy: {
      id: 'user-1',
      displayName: 'Solon',
      discordId: 'discord-1',
    },
  },
};

describe('BotNotificationsService enqueueSaveReplaced', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a save-replaced delivery in the supplied transaction', async () => {
    const transaction = {
      notificationDelivery: {
        create: vi.fn(async () => ({ id: 'delivery-1' })),
      },
    };
    const service = new BotNotificationsService();

    await service.enqueueSaveReplaced(transaction as never, payload);

    expect(transaction.notificationDelivery.create).toHaveBeenCalledWith({
      data: {
        event: 'SAVE_REPLACED',
        gameId: 'game-1',
        gameSlug: 'the-game',
        payload: JSON.stringify(payload),
      },
    });
    expect(prismaMock.notificationDelivery.create).not.toHaveBeenCalled();
  });

  it('does not create a delivery when the game has no Discord thread', async () => {
    const transaction = {
      notificationDelivery: {
        create: vi.fn(async () => ({ id: 'delivery-1' })),
      },
    };
    const service = new BotNotificationsService();

    await service.enqueueSaveReplaced(transaction as never, {
      ...payload,
      game: {
        ...payload.game,
        discordThreadId: null,
      },
    });

    expect(transaction.notificationDelivery.create).not.toHaveBeenCalled();
  });
});

describe('BotNotificationsService turn nudge routing', () => {
  it('routes TURN_NUDGE deliveries to the turn nudge endpoint', () => {
    const service = new BotNotificationsService();

    expect((service as any).getEventName('TURN_NUDGE')).toBe('turn-nudge');
    expect((service as any).getEndpointForEvent('TURN_NUDGE')).toBe(
      'http://127.0.0.1:3011/notify/turn-nudge',
    );
  });
});
