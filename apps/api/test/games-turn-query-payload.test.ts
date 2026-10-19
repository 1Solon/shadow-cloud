import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback) => callback(prismaMock)),
  game: { findMany: vi.fn(), findFirst: vi.fn() },
  turnRecord: { findMany: vi.fn() },
  auditEvent: { findFirst: vi.fn() },
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

function createGame(override = {}) {
  return {
    id: 'game-1',
    turnRevision: 0,
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
    tagline: null,
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
    ...override,
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

  it.each(['2026-06-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'])(
    'uses the latest turn upload for the update age despite a campaign update at %s',
    async (updatedAt) => {
      prismaMock.game.findMany.mockResolvedValue([
        createGame({
          updatedAt: new Date(updatedAt),
          fileVersions: [
            {
              contentRevision: 4,
              id: 'file-latest',
              originalName: '1-T3-S1-Ashes.se1',
              uploadedAt: new Date('2026-07-15T06:00:00.000Z'),
            },
          ],
        }),
      ]);

      const [game] = await new GamesQueryService({} as never).listGames();

      expect(game.updatedAt).toBe('2026-07-15T06:00:00.000Z');
      expect(game.latestSave).toEqual({
        contentRevision: 4,
        id: 'file-latest',
        originalName: '1-T3-S1-Ashes.se1',
      });
    },
  );

  it('retains the campaign update age when no turn has been uploaded', async () => {
    prismaMock.game.findMany.mockResolvedValue([createGame()]);

    const [game] = await new GamesQueryService({} as never).listGames();

    expect(game.updatedAt).toBe('2026-07-11T00:00:00.000Z');
    expect(game.latestSave).toBeNull();
  });

  it('returns list policy fields and the open turn start time without detail history', async () => {
    prismaMock.game.findMany.mockResolvedValue([
      createGame({
        fileVersions: [
          {
            contentRevision: 2,
            id: 'file-latest',
            originalName: '1-T3-S1-Ashes.se1',
            uploadedAt: endedAt,
          },
        ],
      }),
    ]);

    const [game] = await new GamesQueryService({} as never).listGames();

    expect(game).toMatchObject({
      turnTargetHours: 24,
      turnReminderGraceHours: 12,
      turnReminderRepeatHours: 6,
      turnRemindersEnabled: true,
      currentTurnStartedAt: '2026-07-10T00:00:00.000Z',
      latestSave: {
        contentRevision: 2,
        id: 'file-latest',
        originalName: '1-T3-S1-Ashes.se1',
      },
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
          fileVersions: {
            select: {
              contentRevision: true,
              id: true,
              originalName: true,
              uploadedAt: true,
            },
            orderBy: { versionNumber: 'desc' },
            take: 1,
          },
        }),
      }),
    );
  });

  it('exposes the tagline on the list and detail payloads, null when unset', async () => {
    prismaMock.game.findMany.mockResolvedValue([
      createGame({ tagline: '4S FFA+AI T3 1Z 1A' }),
      createGame({ id: 'game-2', slug: 'embers', gameNumber: 2 }),
    ]);
    prismaMock.game.findFirst.mockResolvedValue(
      createGame({ tagline: 'Co-op vs hard AI' }),
    );
    prismaMock.turnRecord.findMany.mockResolvedValue([]);

    const games = await new GamesQueryService({} as never).listGames();
    const detail = await new GamesQueryService({} as never).getGameDetail(
      'game-1',
    );

    expect(games.map((game) => game.tagline)).toEqual([
      '4S FFA+AI T3 1Z 1A',
      null,
    ]);
    expect(detail.tagline).toBe('Co-op vs hard AI');
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

  describe('inactivity deletion date', () => {
    const warnedAt = new Date('2026-08-01T00:00:00.000Z');

    const detail = async (override = {}) => {
      prismaMock.game.findFirst.mockResolvedValue(
        createGame({
          inactivityWarnedAt: warnedAt,
          finalInactivityWarnedAt: null,
          victoryRecord: null,
          ...override,
        }),
      );
      prismaMock.turnRecord.findMany.mockResolvedValue([]);
      return new GamesQueryService({} as never).getGameDetail('game-1');
    };

    it('is 30 days after the inactivity warning while the campaign is dormant', async () => {
      prismaMock.auditEvent.findFirst.mockResolvedValue(null);

      await expect(detail()).resolves.toMatchObject({
        inactivityDeletionDueAt: '2026-08-31T00:00:00.000Z',
      });
    });

    it('is null once activity follows the warning, after a victory, or before any warning', async () => {
      prismaMock.auditEvent.findFirst.mockResolvedValue({ id: 'activity' });
      await expect(detail()).resolves.toMatchObject({
        inactivityDeletionDueAt: null,
      });

      prismaMock.auditEvent.findFirst.mockResolvedValue(null);
      await expect(
        detail({ victoryRecord: { id: 'victory' } }),
      ).resolves.toMatchObject({ inactivityDeletionDueAt: null });
      await expect(detail({ inactivityWarnedAt: null })).resolves.toMatchObject(
        { inactivityDeletionDueAt: null },
      );
    });
  });
});
