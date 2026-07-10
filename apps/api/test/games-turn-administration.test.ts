import { ConflictException } from '@nestjs/common';
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
  const game = createGame();

  return {
    gamePlayer: {
      create: vi.fn(),
      findMany: vi.fn(async () => game.players),
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
      findUnique: vi.fn(async () => game.turnState),
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

    const expectedNext =
      reason === 'REPLACED'
        ? {
            gamePlayerId: 'entry-1',
            userId: 'user-3',
            seatNumber: 1,
            playerDisplayName: 'Replacement',
            roundNumber: 4,
          }
        : {
            gamePlayerId: 'entry-2',
            userId: 'user-2',
            seatNumber: 2,
            playerDisplayName: 'Overlord',
            roundNumber: 4,
          };

    expect(turnRecords.transitionTurn).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        gameId: 'game-1',
        completionReason: reason,
        expectedCurrent: {
          gamePlayerId: 'entry-1',
          userId: 'user-1',
          roundNumber: 4,
        },
        next: expectedNext,
        transitionedAt: expect.any(Date),
      }),
    );

    if (reason === 'REPLACED') {
      expect(transaction.turnState.update).toHaveBeenCalledWith({
        where: { gameId: 'game-1' },
        data: {
          activePlayerId: 'user-3',
          activePlayerEntryId: 'entry-1',
        },
      });
    }
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

  it('rejects replacing a seat when the active turn changed', async () => {
    const transaction = createTransaction();
    transaction.turnState.findUnique.mockResolvedValue({
      activePlayerId: 'user-2',
      activePlayerEntryId: 'entry-2',
      roundNumber: 4,
    });
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    prismaMock.authIdentity.findUnique
      .mockResolvedValueOnce({ userId: 'user-2' })
      .mockResolvedValueOnce(null);

    await expect(
      createService().service.replacePlayerInSeat({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
        seatNumber: 2,
        newPlayerDiscordId: 'discord-3',
        newPlayerDisplayName: 'Replacement',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.gamePlayer.update).not.toHaveBeenCalled();
    expect(transaction.turnState.update).not.toHaveBeenCalled();
  });

  it('rejects resigning when the active turn changed', async () => {
    const transaction = createTransaction();
    transaction.turnState.findUnique.mockResolvedValue({
      activePlayerId: 'user-2',
      activePlayerEntryId: 'entry-2',
      roundNumber: 4,
    });
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    prismaMock.authIdentity.findUnique.mockResolvedValue({ userId: 'user-1' });

    await expect(
      createService().service.resignPlayerFromDiscord({
        discordThreadId: 'thread-1',
        playerDiscordId: 'discord-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.gamePlayer.update).not.toHaveBeenCalled();
    expect(transaction.turnState.update).not.toHaveBeenCalled();
  });

  it('retains the duplicate-user rejection before opening a transaction', async () => {
    prismaMock.authIdentity.findUnique
      .mockResolvedValueOnce({ userId: 'user-2' })
      .mockResolvedValueOnce({ userId: 'user-1' });
    prismaMock.gamePlayer.findFirst.mockResolvedValue({ id: 'entry-1' });

    await expect(
      createService().service.replacePlayerInSeat({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
        seatNumber: 2,
        newPlayerDiscordId: 'discord-1',
        newPlayerDisplayName: 'Alpha',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an emptied next skip seat before advancing the turn', async () => {
    const game = createGame();
    const transaction = createTransaction();
    transaction.gamePlayer.findMany.mockResolvedValue([
      game.players[0],
      { ...game.players[1], userId: null, user: null } as never,
    ]);
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    const { service, turnRecords } = createService();

    await expect(
      service.skipPlayerTurn({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.turnState.update).not.toHaveBeenCalled();
    expect(turnRecords.transitionTurn).not.toHaveBeenCalled();
  });
});
