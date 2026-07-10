import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: { findMany: vi.fn(), findFirst: vi.fn() },
  turnRecord: { findMany: vi.fn() },
}));

vi.mock('../src/database', () => ({
  prisma: prismaMock,
  AuditEventType: {
    PLAYER_RESIGNED: 'PLAYER_RESIGNED',
    TURN_REASSIGNED: 'TURN_REASSIGNED',
  },
  GameRole: { ORGANIZER: 'ORGANIZER' },
  ArmyCountPreset: {},
  GameDlcMode: {},
  GameMode: {},
  ZoneCountPreset: {},
}));

const { GamesQueryService } =
  await import('../src/games/services/games-query.service');

const startedAt = new Date('2026-07-10T00:00:00.000Z');
const endedAt = new Date('2026-07-11T00:00:00.000Z');

function createGame() {
  return {
    id: 'game-1',
    slug: 'ashes',
    gameNumber: 1,
    name: 'Ashes',
    organizerId: 'user-1',
    organizer: { displayName: 'Organizer' },
    playerCount: 2,
    hasAiPlayers: false,
    dlcMode: null,
    gameMode: null,
    techLevel: null,
    zoneCount: null,
    armyCount: null,
    notes: null,
    turnTargetHours: 24,
    turnReminderGraceHours: 12,
    turnReminderRepeatHours: 6,
    turnRemindersEnabled: true,
    createdAt: startedAt,
    updatedAt: endedAt,
    players: [
      {
        id: 'seat-1',
        userId: 'user-1',
        user: { displayName: 'Organizer' },
        role: 'ORGANIZER',
        turnOrder: 1,
      },
    ],
    turnState: {
      activePlayerId: 'user-1',
      activePlayerEntryId: 'seat-1',
      roundNumber: 4,
    },
    fileVersions: [],
    auditEvents: [],
    turnRecords: [createTurnRecord()],
  };
}

function createTurnRecord(override = {}) {
  return {
    id: 'turn-1',
    roundNumber: 4,
    gamePlayerId: 'seat-1',
    userId: 'user-1',
    seatNumber: 1,
    playerDisplayName: 'Organizer',
    startedAt,
    endedAt: null,
    completionReason: null,
    reminderCount: 0,
    lastReminderAt: null,
    nextReminderAt: new Date('2026-07-11T12:00:00.000Z'),
    ...override,
  };
}

describe('GamesQueryService turn timing payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns list policy fields and the open turn start time without detail history', async () => {
    prismaMock.game.findMany.mockResolvedValue([createGame()]);

    const [game] = await new GamesQueryService({} as never).listGames();

    expect(game).toMatchObject({
      turnTargetHours: 24,
      turnReminderGraceHours: 12,
      turnReminderRepeatHours: 6,
      turnRemindersEnabled: true,
      currentTurnStartedAt: '2026-07-10T00:00:00.000Z',
    });
    expect(game).not.toHaveProperty('openTurn');
    expect(game).not.toHaveProperty('recentCompletedTurns');
    expect(prismaMock.turnRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.game.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          turnRecords: {
            where: { endedAt: null },
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        }),
      }),
    );
  });

  it('returns detail timing fields and 25 newest completed turn snapshots', async () => {
    prismaMock.game.findFirst.mockResolvedValue(createGame());
    prismaMock.turnRecord.findMany
      .mockResolvedValueOnce([createTurnRecord()])
      .mockResolvedValueOnce([
        createTurnRecord({
          id: 'turn-previous',
          gamePlayerId: null,
          userId: null,
          seatNumber: null,
          endedAt,
          completionReason: 'SAVE_UPLOADED',
          lastReminderAt: null,
          nextReminderAt: null,
        }),
      ]);

    const game = await new GamesQueryService({} as never).getGameDetail(
      'game-1',
    );

    expect(game).toMatchObject({
      currentTurnStartedAt: '2026-07-10T00:00:00.000Z',
      openTurn: expect.objectContaining({
        id: 'turn-1',
        endedAt: null,
        seatNumber: 1,
        lastReminderAt: null,
        nextReminderAt: '2026-07-11T12:00:00.000Z',
      }),
      recentCompletedTurns: [
        expect.objectContaining({
          id: 'turn-previous',
          gamePlayerId: null,
          userId: null,
          seatNumber: null,
          endedAt: '2026-07-11T00:00:00.000Z',
          lastReminderAt: null,
          nextReminderAt: null,
        }),
      ],
    });
    expect(prismaMock.turnRecord.findMany).toHaveBeenNthCalledWith(2, {
      where: { gameId: 'game-1', endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      take: 25,
    });
    expect(game.recentCompletedTurns[0].seatNumber).toBeNull();
    expect(game.recentCompletedTurns[0].lastReminderAt).toBeNull();
    expect(game.recentCompletedTurns[0].nextReminderAt).toBeNull();
  });
});
