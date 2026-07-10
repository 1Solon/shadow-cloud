import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    TURN_REASSIGNED: 'TURN_REASSIGNED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
    PLAYER: 'PLAYER',
  },
  prisma: prismaMock,
}));

const { GamesTurnService } = await import(
  '../src/games/services/games-turn.service'
);

function createGame(override = {}) {
  const game = {
    id: 'game-1',
    gameNumber: 1,
    slug: 'ashes',
    name: 'Ashes',
    playerCount: 2,
    organizerId: 'user-1',
    players: [
      {
        id: 'entry-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          displayName: 'Overlord',
        },
        role: 'ORGANIZER',
        turnOrder: 1,
      },
      {
        id: 'entry-2',
        userId: 'user-2',
        user: {
          id: 'user-2',
          displayName: 'Other',
        },
        role: 'PLAYER',
        turnOrder: 2,
      },
    ],
    turnState: {
      activePlayerId: 'user-1',
      activePlayerEntryId: 'entry-1',
      roundNumber: 4,
    },
  };

  return {
    ...game,
    ...override,
  };
}

function createService() {
  return new GamesTurnService(
    {
      isUserShadowOverride: vi.fn(async () => false),
    } as never,
    {} as never,
    {} as never,
  );
}

function createTransaction() {
  return {
    gamePlayer: {
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
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

describe('GamesTurnService seat order organizer clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.game.findFirst.mockResolvedValue(createGame());
  });

  it('clears an organizer seat while preserving game ownership', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await createService().reorderSeatOrder('1', 'user-1', {
      seatEntryIds: ['entry-1', 'entry-2'],
      clearedSeatEntryIds: ['entry-1'],
      activePlayerEntryId: 'entry-2',
    });

    expect(transaction.game.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizerId: expect.any(String),
        }),
      }),
    );
    expect(transaction.gamePlayer.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: {
        turnOrder: 1,
        userId: null,
        role: 'PLAYER',
      },
    });
    expect(transaction.turnState.update).toHaveBeenCalledWith({
      where: { gameId: 'game-1' },
      data: {
        activePlayerId: 'user-2',
        activePlayerEntryId: 'entry-2',
      },
    });
  });

  it('removes an organizer seat while preserving game ownership', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await createService().reorderSeatOrder('1', 'user-1', {
      seatEntryIds: ['entry-2'],
      removedSeatEntryIds: ['entry-1'],
      activePlayerEntryId: 'entry-2',
    });

    expect(transaction.game.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: {
        playerCount: 1,
      },
    });
    expect(transaction.game.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizerId: expect.any(String),
        }),
      }),
    );
    expect(transaction.gamePlayer.deleteMany).toHaveBeenCalledWith({
      where: {
        gameId: 'game-1',
        id: {
          in: ['entry-1'],
        },
      },
    });
  });

  it('explains that occupied seats must be cleared before removal', async () => {
    await expect(
      createService().reorderSeatOrder('1', 'user-1', {
        seatEntryIds: ['entry-2'],
        clearedSeatEntryIds: ['entry-1'],
        removedSeatEntryIds: ['entry-1'],
        activePlayerEntryId: 'entry-2',
      }),
    ).rejects.toThrow(
      'Occupied seats must be cleared and saved before they can be removed.',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('still rejects clearing the only occupied seat', async () => {
    prismaMock.game.findFirst.mockResolvedValue(
      createGame({
        playerCount: 1,
        players: [
          {
            id: 'entry-1',
            userId: 'user-1',
            user: {
              id: 'user-1',
              displayName: 'Overlord',
            },
            role: 'ORGANIZER',
            turnOrder: 1,
          },
        ],
        turnState: {
          activePlayerId: 'user-1',
          activePlayerEntryId: 'entry-1',
          roundNumber: 4,
        },
      }),
    );

    await expect(
      createService().reorderSeatOrder('1', 'user-1', {
        seatEntryIds: ['entry-1'],
        clearedSeatEntryIds: ['entry-1'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('still rejects removing the only occupied seat', async () => {
    prismaMock.game.findFirst.mockResolvedValue(
      createGame({
        playerCount: 1,
        players: [
          {
            id: 'entry-1',
            userId: 'user-1',
            user: {
              id: 'user-1',
              displayName: 'Overlord',
            },
            role: 'ORGANIZER',
            turnOrder: 1,
          },
        ],
        turnState: {
          activePlayerId: 'user-1',
          activePlayerEntryId: 'entry-1',
          roundNumber: 4,
        },
      }),
    );

    await expect(
      createService().reorderSeatOrder('1', 'user-1', {
        seatEntryIds: [],
        removedSeatEntryIds: ['entry-1'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
