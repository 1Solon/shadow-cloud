import { describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findFirst: vi.fn(),
  },
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    PLAYER_RESIGNED: 'PLAYER_RESIGNED',
    TURN_REASSIGNED: 'TURN_REASSIGNED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
    PLAYER: 'PLAYER',
  },
  prisma: prismaMock,
}));

const { GamesQueryService } = await import(
  '../src/games/services/games-query.service'
);

function createService() {
  return new GamesQueryService({} as never);
}

function createGameWithClearedSeat() {
  return {
    id: 'game-1',
    gameNumber: 7,
    slug: 'ashes',
    name: 'Ashes',
    organizerId: 'user-1',
    organizer: {
      displayName: 'Host',
    },
    playerCount: 2,
    hasAiPlayers: false,
    dlcMode: 'NONE',
    gameMode: 'FFA',
    techLevel: 3,
    zoneCount: 'TWO_ZONE_START',
    armyCount: 'ONE_PER_ZONE',
    turnState: null,
    players: [
      {
        id: 'seat-1',
        userId: 'user-1',
        user: {
          displayName: 'Host',
        },
        turnOrder: 1,
        role: 'ORGANIZER',
      },
      {
        id: 'seat-2',
        userId: null,
        user: null,
        turnOrder: 2,
        role: 'PLAYER',
      },
    ],
    fileVersions: [],
    auditEvents: [
      {
        payload: JSON.stringify({
          previousOrder: [
            {
              seatEntryId: 'seat-1',
              turnOrder: 1,
              displayName: 'Host',
            },
            {
              seatEntryId: 'seat-2',
              turnOrder: 2,
              displayName: 'Marina',
            },
          ],
          nextOrder: [
            {
              seatEntryId: 'seat-1',
              turnOrder: 1,
              displayName: 'Host',
            },
            {
              seatEntryId: 'seat-2',
              turnOrder: 2,
              displayName: null,
            },
          ],
        }),
      },
    ],
  };
}

describe('GamesQueryService seat history', () => {
  it('keeps the previous player name when a seat was manually cleared', async () => {
    prismaMock.game.findFirst.mockResolvedValue(createGameWithClearedSeat());

    const result = await createService().getGameDetail('ashes');

    expect(result.players[1]).toMatchObject({
      id: 'seat-2',
      userId: null,
      displayName: 'Marina',
      turnOrder: 2,
    });
    expect(prismaMock.game.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          auditEvents: expect.objectContaining({
            where: {
              eventType: {
                in: ['PLAYER_RESIGNED', 'TURN_REASSIGNED'],
              },
            },
          }),
        }),
      }),
    );
  });
});
