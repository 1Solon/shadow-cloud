import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  authIdentity: {
    findUnique: vi.fn(),
  },
  gamePlayer: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const discordUserHelpersMock = vi.hoisted(() => ({
  upsertDiscordUser: vi.fn(),
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    PLAYER_REPLACED: 'PLAYER_REPLACED',
    PLAYER_RESIGNED: 'PLAYER_RESIGNED',
    ROSTER_UPDATED: 'ROSTER_UPDATED',
    TURN_SKIPPED: 'TURN_SKIPPED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
    PLAYER: 'PLAYER',
  },
  TurnCompletionReason: {
    REPLACED: 'REPLACED',
    RESIGNED: 'RESIGNED',
    SKIPPED: 'SKIPPED',
  },
  prisma: prismaMock,
}));

vi.mock('../src/games/support/discord-user.helpers', () => ({
  getDiscordIdentity: vi.fn(),
  upsertDiscordUser: discordUserHelpersMock.upsertDiscordUser,
}));

const { GamesTurnService } = await import(
  '../src/games/services/games-turn.service'
);

type GamesTurnServiceConstructor = new (
  authService: never,
  fileStorage: never,
  botNotifications: never,
  turnRecords: never,
) => InstanceType<typeof GamesTurnService>;

function createGame(override = {}) {
  const players = [
    {
      id: 'entry-1',
      userId: 'user-1',
      user: { id: 'user-1', displayName: 'Alpha', identities: [] },
      role: 'PLAYER',
      turnOrder: 1,
    },
    {
      id: 'entry-2',
      userId: 'user-2',
      user: { id: 'user-2', displayName: 'Overlord', identities: [] },
      role: 'ORGANIZER',
      turnOrder: 2,
    },
  ];

  return {
    id: 'game-1',
    gameNumber: 1,
    slug: 'ashes',
    name: 'Ashes',
    organizerId: 'user-2',
    playerCount: 2,
    players,
    turnState: {
      activePlayerId: 'user-1',
      activePlayerEntryId: 'entry-1',
      roundNumber: 4,
    },
    turnTargetHours: 24,
    turnReminderGraceHours: 12,
    turnReminderRepeatHours: 24,
    turnRemindersEnabled: true,
    ...override,
  };
}

function createTransaction() {
  return {
    gamePlayer: {
      create: vi.fn(),
      update: vi.fn(async ({ where, data }) => ({
        id: where.id,
        user: data.userId
          ? { id: data.userId, displayName: 'Replacement' }
          : null,
      })),
    },
    game: {
      update: vi.fn(async () => ({})),
    },
    turnState: {
      update: vi.fn(async () => ({})),
    },
    auditEvent: {
      create: vi.fn(async () => ({})),
    },
  };
}

function createService() {
  const turnRecords = {
    transitionTurn: vi.fn(async () => ({})),
  };

  return {
    service: new (GamesTurnService as unknown as GamesTurnServiceConstructor)(
      { isUserShadowOverride: vi.fn(async () => false) } as never,
      {} as never,
      {} as never,
      turnRecords as never,
    ),
    turnRecords,
  };
}

describe('GamesTurnService administrative turn transitions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prismaMock.game.findUnique.mockResolvedValue(createGame());
    prismaMock.game.findFirst.mockResolvedValue(createGame());
    prismaMock.authIdentity.findUnique.mockResolvedValue({ userId: 'user-2' });
    prismaMock.gamePlayer.findFirst.mockResolvedValue(null);
    discordUserHelpersMock.upsertDiscordUser.mockResolvedValue({
      id: 'user-3',
      displayName: 'Replacement',
    });
  });

  it.each([
    ['active occupied-seat replacement', 'REPLACED'],
    ['active-player resignation', 'RESIGNED'],
    ['organizer skip', 'SKIPPED'],
  ])('%s transitions timing with %s', async (name, reason) => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    const { service, turnRecords } = createService();

    if (name === 'active occupied-seat replacement') {
      prismaMock.authIdentity.findUnique
        .mockResolvedValueOnce({ userId: 'user-2' })
        .mockResolvedValueOnce(null);
      await service.replacePlayerInSeat({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
        seatNumber: 1,
        newPlayerDiscordId: 'discord-3',
        newPlayerDisplayName: 'Replacement',
      });
    }

    if (name === 'active-player resignation') {
      prismaMock.authIdentity.findUnique.mockResolvedValue({ userId: 'user-1' });
      await service.resignPlayerFromDiscord({
        discordThreadId: 'thread-1',
        playerDiscordId: 'discord-1',
      });
    }

    if (name === 'organizer skip') {
      await service.skipPlayerTurn({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
      });
    }

    expect(turnRecords.transitionTurn).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ completionReason: reason }),
    );
  });

  it('does not reset timing when an inactive occupied seat is replaced', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    prismaMock.authIdentity.findUnique
      .mockResolvedValueOnce({ userId: 'user-2' })
      .mockResolvedValueOnce(null);
    const { service, turnRecords } = createService();

    await service.replacePlayerInSeat({
      discordThreadId: 'thread-1',
      callerDiscordId: 'discord-2',
      seatNumber: 2,
      newPlayerDiscordId: 'discord-3',
      newPlayerDisplayName: 'Replacement',
    });

    expect(turnRecords.transitionTurn).not.toHaveBeenCalled();
  });

  it('does not reset timing when an inactive player resigns', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    prismaMock.authIdentity.findUnique.mockResolvedValue({ userId: 'user-2' });
    const { service, turnRecords } = createService();

    await service.resignPlayerFromDiscord({
      discordThreadId: 'thread-1',
      playerDiscordId: 'discord-2',
    });

    expect(turnRecords.transitionTurn).not.toHaveBeenCalled();
  });

  it('does not reset timing when host control transfers', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    const { service, turnRecords } = createService();

    await service.transferHost('1', 'user-2', {
      targetPlayerEntryId: 'entry-1',
    });

    expect(turnRecords.transitionTurn).not.toHaveBeenCalled();
  });
});
