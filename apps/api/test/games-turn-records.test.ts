import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  turnRecord: {
    findMany: vi.fn(),
  },
  game: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const discordUserHelpersMock = vi.hoisted(() => ({
  upsertDiscordUser: vi.fn(),
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    GAME_CREATED: 'GAME_CREATED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
  },
  ArmyCountPreset: {
    MILITIA_ONLY: 'MILITIA_ONLY',
    ONE_PER_ZONE: 'ONE_PER_ZONE',
    TWO_PER_ZONE: 'TWO_PER_ZONE',
  },
  GameDlcMode: {
    NONE: 'NONE',
    OCEANIA: 'OCEANIA',
    REPUBLICA: 'REPUBLICA',
    BOTH: 'BOTH',
  },
  GameMode: {
    TEAMS: 'TEAMS',
    TEAMS_AI: 'TEAMS_AI',
    FFA: 'FFA',
    FFA_AI: 'FFA_AI',
  },
  TurnCompletionReason: {
    SAVE_UPLOADED: 'SAVE_UPLOADED',
    SKIPPED: 'SKIPPED',
    RESIGNED: 'RESIGNED',
    REPLACED: 'REPLACED',
    REASSIGNED: 'REASSIGNED',
  },
  ZoneCountPreset: {
    CITY_STATE: 'CITY_STATE',
    TWO_ZONE_START: 'TWO_ZONE_START',
    THREE_ZONE_START: 'THREE_ZONE_START',
  },
  prisma: prismaMock,
}));

vi.mock('../src/games/bot-notifications.service', () => ({
  BotNotificationsService: class {},
}));

vi.mock('../src/games/support/discord-user.helpers', () => ({
  getDiscordIdentity: vi.fn(),
  upsertDiscordUser: discordUserHelpersMock.upsertDiscordUser,
}));

const { TurnCompletionReason } = await import('../src/database');
const { TurnRecordsService } = await import(
  '../src/games/services/turn-records.service'
);
const { GamesRegistrationService } = await import(
  '../src/games/services/games-registration.service'
);

const policy = {
  turnTargetHours: 24,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 24,
  turnRemindersEnabled: true,
};

const startedAt = new Date('2026-07-10T00:00:00.000Z');
const transitionedAt = new Date('2026-07-11T02:30:00.000Z');

function createOpenRecord(override = {}) {
  return {
    id: 'turn-1',
    gameId: 'game-1',
    gamePlayerId: 'seat-1',
    userId: 'user-1',
    roundNumber: 4,
    startedAt,
    endedAt: null,
    reminderCount: 0,
    lastReminderAt: null,
    ...override,
  };
}

function createTransaction() {
  return {
    game: {
      findUnique: vi.fn(async () => policy),
    },
    turnRecord: {
      create: vi.fn(async () => ({ id: 'turn-2' })),
      findMany: vi.fn(async () => [createOpenRecord()]),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    notificationDelivery: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
}

describe('TurnRecordsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the initial open turn with its first reminder due time', async () => {
    const transaction = createTransaction();

    await new TurnRecordsService().createInitialTurn(transaction as never, {
      gameId: 'game-1',
      participant: {
        gamePlayerId: 'seat-1',
        userId: 'user-1',
        seatNumber: 1,
        playerDisplayName: 'Alpha',
      },
      roundNumber: 1,
      startedAt,
    });

    expect(transaction.turnRecord.create).toHaveBeenCalledWith({
      data: {
        gameId: 'game-1',
        gamePlayerId: 'seat-1',
        userId: 'user-1',
        seatNumber: 1,
        playerDisplayName: 'Alpha',
        roundNumber: 1,
        startedAt,
        nextReminderAt: new Date('2026-07-11T12:00:00.000Z'),
      },
    });
  });

  it.each([
    TurnCompletionReason.SAVE_UPLOADED,
    TurnCompletionReason.SKIPPED,
    TurnCompletionReason.RESIGNED,
    TurnCompletionReason.REPLACED,
    TurnCompletionReason.REASSIGNED,
  ])('closes and opens a turn for %s at the same timestamp', async (reason) => {
    const transaction = createTransaction();

    await new TurnRecordsService().transitionTurn(transaction as never, {
      gameId: 'game-1',
      expectedCurrent: {
        gamePlayerId: 'seat-1',
        userId: 'user-1',
        roundNumber: 4,
      },
      next: {
        gamePlayerId: 'seat-2',
        userId: 'user-2',
        seatNumber: 2,
        playerDisplayName: 'Beta',
        roundNumber: 4,
      },
      completionReason: reason,
      transitionedAt,
    });

    expect(transaction.turnRecord.findMany).toHaveBeenCalledWith({
      where: { gameId: 'game-1', endedAt: null },
    });
    expect(transaction.turnRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'turn-1', endedAt: null },
      data: {
        endedAt: transitionedAt,
        completionReason: reason,
        nextReminderAt: null,
      },
    });
    expect(transaction.notificationDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        turnRecordId: 'turn-1',
        event: 'TURN_NUDGE',
        status: 'PENDING',
      },
      data: { status: 'CANCELLED', processingStartedAt: null },
    });
    expect(transaction.turnRecord.create).toHaveBeenCalledWith({
      data: {
        gameId: 'game-1',
        gamePlayerId: 'seat-2',
        userId: 'user-2',
        seatNumber: 2,
        playerDisplayName: 'Beta',
        roundNumber: 4,
        startedAt: transitionedAt,
        nextReminderAt: new Date('2026-07-12T14:30:00.000Z'),
      },
    });
  });

  it('uses a policy committed before a transition to schedule the new open turn', async () => {
    const transaction = createTransaction();
    transaction.game.findUnique.mockResolvedValue({
      ...policy,
      turnTargetHours: 48,
      turnReminderGraceHours: 6,
    });

    await new TurnRecordsService().transitionTurn(transaction as never, {
      gameId: 'game-1',
      expectedCurrent: {
        gamePlayerId: 'seat-1',
        userId: 'user-1',
        roundNumber: 4,
      },
      next: {
        gamePlayerId: 'seat-2',
        userId: 'user-2',
        seatNumber: 2,
        playerDisplayName: 'Beta',
        roundNumber: 4,
      },
      completionReason: TurnCompletionReason.SAVE_UPLOADED,
      transitionedAt,
    });

    expect(transaction.turnRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nextReminderAt: new Date('2026-07-13T08:30:00.000Z'),
      }),
    });
  });

  it('rejects a transition when the open record does not match the active turn', async () => {
    const transaction = createTransaction();
    transaction.turnRecord.findMany.mockResolvedValue([
      createOpenRecord({ userId: 'user-other' }),
    ]);

    await expect(
      new TurnRecordsService().transitionTurn(transaction as never, {
        gameId: 'game-1',
        expectedCurrent: {
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          roundNumber: 4,
        },
        next: {
          gamePlayerId: 'seat-2',
          userId: 'user-2',
          seatNumber: 2,
          playerDisplayName: 'Beta',
          roundNumber: 4,
        },
        completionReason: TurnCompletionReason.SKIPPED,
        transitionedAt,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.turnRecord.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['seat ID', { gamePlayerId: 'seat-other' }],
    ['round number', { roundNumber: 5 }],
  ])(
    'rejects a transition when the open record %s does not match the active turn',
    async (_mismatch, recordOverride) => {
      const transaction = createTransaction();
      transaction.turnRecord.findMany.mockResolvedValue([
        createOpenRecord(recordOverride),
      ]);

      await expect(
        new TurnRecordsService().transitionTurn(transaction as never, {
          gameId: 'game-1',
          expectedCurrent: {
            gamePlayerId: 'seat-1',
            userId: 'user-1',
            roundNumber: 4,
          },
          next: {
            gamePlayerId: 'seat-2',
            userId: 'user-2',
            seatNumber: 2,
            playerDisplayName: 'Beta',
            roundNumber: 4,
          },
          completionReason: TurnCompletionReason.SKIPPED,
          transitionedAt,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(transaction.turnRecord.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects a transition when more than one open record matches the active turn', async () => {
    const transaction = createTransaction();
    transaction.turnRecord.findMany.mockResolvedValue([
      createOpenRecord(),
      createOpenRecord({ id: 'turn-duplicate' }),
    ]);

    await expect(
      new TurnRecordsService().transitionTurn(transaction as never, {
        gameId: 'game-1',
        expectedCurrent: {
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          roundNumber: 4,
        },
        next: {
          gamePlayerId: 'seat-2',
          userId: 'user-2',
          seatNumber: 2,
          playerDisplayName: 'Beta',
          roundNumber: 4,
        },
        completionReason: TurnCompletionReason.SKIPPED,
        transitionedAt,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.turnRecord.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a transition when closing the matching open record loses its race', async () => {
    const transaction = createTransaction();
    transaction.turnRecord.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new TurnRecordsService().transitionTurn(transaction as never, {
        gameId: 'game-1',
        expectedCurrent: {
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          roundNumber: 4,
        },
        next: {
          gamePlayerId: 'seat-2',
          userId: 'user-2',
          seatNumber: 2,
          playerDisplayName: 'Beta',
          roundNumber: 4,
        },
        completionReason: TurnCompletionReason.SKIPPED,
        transitionedAt,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.notificationDelivery.updateMany).not.toHaveBeenCalled();
    expect(transaction.turnRecord.create).not.toHaveBeenCalled();
  });

  it('recalculates an unreminded open turn from its original start time', async () => {
    const transaction = createTransaction();
    transaction.game.findUnique.mockResolvedValue({
      ...policy,
      turnTargetHours: 48,
    });

    await new TurnRecordsService().recalculateOpenReminder(transaction as never, {
      gameId: 'game-1',
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: new Date('2026-07-12T12:00:00.000Z') },
    });
  });

  it('recalculates a transitioned open turn when a policy commit follows it', async () => {
    const transaction = createTransaction();
    transaction.turnRecord.findMany.mockResolvedValue([
      createOpenRecord({ startedAt: transitionedAt }),
    ]);
    transaction.game.findUnique.mockResolvedValue({
      ...policy,
      turnTargetHours: 48,
      turnReminderGraceHours: 6,
    });

    await new TurnRecordsService().recalculateOpenReminder(transaction as never, {
      gameId: 'game-1',
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: new Date('2026-07-13T08:30:00.000Z') },
    });
  });

  it('recalculates a reminded open turn from its latest reminder', async () => {
    const transaction = createTransaction();
    transaction.game.findUnique.mockResolvedValue({
      ...policy,
      turnReminderRepeatHours: 6,
    });
    const lastReminderAt = new Date('2026-07-12T08:00:00.000Z');
    transaction.turnRecord.findMany.mockResolvedValue([
      createOpenRecord({ reminderCount: 1, lastReminderAt }),
    ]);

    await new TurnRecordsService().recalculateOpenReminder(transaction as never, {
      gameId: 'game-1',
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: new Date('2026-07-12T14:00:00.000Z') },
    });
  });

  it('clears an open turn reminder when reminders are disabled', async () => {
    const transaction = createTransaction();
    transaction.game.findUnique.mockResolvedValue({
      ...policy,
      turnRemindersEnabled: false,
    });

    await new TurnRecordsService().recalculateOpenReminder(transaction as never, {
      gameId: 'game-1',
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: null },
    });
  });

  it('synchronizes only the round number after validating the open participant', async () => {
    const transaction = createTransaction();

    await new TurnRecordsService().synchronizeOpenRound(transaction as never, {
      gameId: 'game-1',
      expectedCurrent: {
        gamePlayerId: 'seat-1',
        userId: 'user-1',
      },
      roundNumber: 5,
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { roundNumber: 5 },
    });
  });
});

describe('GamesRegistrationService turn record initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T09:00:00.000Z'));
    prismaMock.game.findUnique.mockResolvedValue(null);
    discordUserHelpersMock.upsertDiscordUser.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alpha',
    });
  });

  it('passes custom timing policy overrides into a new game and its initial turn', async () => {
    const transaction = {
      game: {
        create: vi.fn(async () => ({
          id: 'game-1',
          gameNumber: 42,
          slug: 'ashes',
          name: 'Ashes',
          playerCount: 2,
          hasAiPlayers: false,
          dlcMode: null,
          gameMode: null,
          techLevel: null,
          zoneCount: null,
          armyCount: null,
          discordThreadId: 'thread-1',
        })),
        findUnique: vi.fn(async () => null),
      },
      gamePlayer: {
        create: vi.fn(async () => ({
          id: 'seat-1',
          userId: 'user-1',
          turnOrder: 1,
        })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      turnState: {
        create: vi.fn(async () => ({})),
      },
      auditEvent: {
        create: vi.fn(async () => ({})),
      },
    };
    const turnRecords = {
      createInitialTurn: vi.fn(async () => ({})),
    };
    const botNotifications = {
      notifyGameInitialized: vi.fn(async () => ({})),
    };
    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => callback({}))
      .mockImplementationOnce(async (callback) => callback(transaction));

    await new GamesRegistrationService(
      botNotifications as never,
      turnRecords as never,
    ).createGameFromDiscordInit({
      gameNumber: 42,
      name: 'Ashes',
      playerCount: 2,
      hasAiPlayers: false,
      organizerDiscordId: 'discord-1',
      organizerDisplayName: 'Alpha',
      discordGuildId: 'guild-1',
      discordChannelId: 'channel-1',
      discordThreadId: 'thread-1',
      turnTargetHours: 48,
      turnReminderGraceHours: 6,
      turnReminderRepeatHours: 12,
    });

    expect(transaction.game.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnTargetHours: 48,
        turnReminderGraceHours: 6,
        turnReminderRepeatHours: 12,
        turnRemindersEnabled: true,
      }),
    });
    expect(turnRecords.createInitialTurn).toHaveBeenCalledWith(transaction, {
      gameId: 'game-1',
      participant: {
        gamePlayerId: 'seat-1',
        userId: 'user-1',
        seatNumber: 1,
        playerDisplayName: 'Alpha',
      },
      roundNumber: 1,
      startedAt: new Date('2026-07-10T09:00:00.000Z'),
    });
  });
});
