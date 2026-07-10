import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  turnRecord: {
    findMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../src/database', () => ({
  prisma: prismaMock,
  NotificationDeliveryEvent: {
    TURN_NUDGE: 'TURN_NUDGE',
  },
}));

const { TurnRemindersService } = await import(
  '../src/games/services/turn-reminders.service'
);

const dueAt = new Date('2026-07-10T12:00:00.000Z');
const now = new Date('2026-07-10T12:05:00.000Z');

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'turn-1',
    gameId: 'game-1',
    gamePlayerId: 'seat-1',
    userId: 'user-1',
    roundNumber: 4,
    startedAt: new Date('2026-07-09T00:00:00.000Z'),
    endedAt: null,
    reminderCount: 0,
    lastReminderAt: null,
    nextReminderAt: dueAt,
    game: {
      id: 'game-1',
      gameNumber: 42,
      slug: 'the-game',
      name: 'The Game',
      discordThreadId: 'thread-1',
      turnTargetHours: 24,
      turnReminderGraceHours: 12,
      turnReminderRepeatHours: 24,
      turnRemindersEnabled: true,
      turnState: {
        activePlayerId: 'user-1',
        activePlayerEntryId: 'seat-1',
        roundNumber: 4,
      },
    },
    gamePlayer: {
      id: 'seat-1',
      userId: 'user-1',
      turnOrder: 2,
      user: {
        id: 'user-1',
        displayName: 'Alpha',
        identities: [{ provider: 'discord', providerId: 'discord-1' }],
      },
    },
    ...overrides,
  };
}

function createTransaction(candidate = createCandidate()) {
  return {
    turnRecord: {
      findUnique: vi.fn(async () => candidate),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    notificationDelivery: {
      create: vi.fn(async () => ({ id: 'delivery-1' })),
    },
  };
}

describe('TurnRemindersService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('claims one exact due interval and enqueues a complete nudge payload', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await new TurnRemindersService().processTurnReminderCandidate('turn-1', now);

    expect(transaction.turnRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'turn-1',
        endedAt: null,
        nextReminderAt: dueAt,
      },
      data: {
        reminderCount: { increment: 1 },
        lastReminderAt: now,
        nextReminderAt: new Date('2026-07-11T12:05:00.000Z'),
      },
    });
    expect(transaction.notificationDelivery.create).toHaveBeenCalledWith({
      data: {
        event: 'TURN_NUDGE',
        gameId: 'game-1',
        gameSlug: 'the-game',
        turnRecordId: 'turn-1',
        payload: JSON.stringify({
          game: {
            id: 'game-1',
            gameNumber: 42,
            slug: 'the-game',
            name: 'The Game',
            discordThreadId: 'thread-1',
          },
          turnRecord: {
            id: 'turn-1',
            roundNumber: 4,
            startedAt: '2026-07-09T00:00:00.000Z',
            elapsedHours: 36,
            targetHours: 24,
            activePlayer: {
              id: 'user-1',
              displayName: 'Alpha',
              discordId: 'discord-1',
              turnOrder: 2,
            },
          },
        }),
      },
    });
  });

  it('does not enqueue when another scheduler has already claimed the due interval', async () => {
    const transaction = createTransaction();
    transaction.turnRecord.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await Promise.all([
      new TurnRemindersService().processTurnReminderCandidate('turn-1', now),
      new TurnRemindersService().processTurnReminderCandidate('turn-1', now),
    ]);

    expect(transaction.notificationDelivery.create).toHaveBeenCalledTimes(1);
  });

  it('advances only once from the current poll time when a reminder is overdue', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await new TurnRemindersService().processTurnReminderCandidate('turn-1', now);

    expect(transaction.turnRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nextReminderAt: new Date('2026-07-11T12:05:00.000Z'),
        }),
      }),
    );
  });

  it('does not claim disabled or stale turns', async () => {
    const disabledTransaction = createTransaction(
      createCandidate({
        game: { ...createCandidate().game, turnRemindersEnabled: false },
      }),
    );
    const staleTransaction = createTransaction(
      createCandidate({
        game: {
          ...createCandidate().game,
          turnState: {
            activePlayerId: 'user-2',
            activePlayerEntryId: 'seat-2',
            roundNumber: 4,
          },
        },
      }),
    );
    prismaMock.$transaction
      .mockImplementationOnce(async (callback) => callback(disabledTransaction))
      .mockImplementationOnce(async (callback) => callback(staleTransaction));
    const service = new TurnRemindersService();

    await service.processTurnReminderCandidate('turn-1', now);
    await service.processTurnReminderCandidate('turn-1', now);

    expect(disabledTransaction.turnRecord.updateMany).not.toHaveBeenCalled();
    expect(staleTransaction.turnRecord.updateMany).not.toHaveBeenCalled();
    expect(disabledTransaction.notificationDelivery.create).not.toHaveBeenCalled();
    expect(staleTransaction.notificationDelivery.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the game has no Discord thread',
      { game: { ...createCandidate().game, discordThreadId: null } },
    ],
    [
      'the active player has no Discord identity',
      {
        gamePlayer: {
          ...createCandidate().gamePlayer,
          user: { ...createCandidate().gamePlayer.user, identities: [] },
        },
      },
    ],
  ])('advances without delivery when %s', async (_reason, override) => {
    const transaction = createTransaction(createCandidate(override));
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await new TurnRemindersService().processTurnReminderCandidate('turn-1', now);

    expect(transaction.turnRecord.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.notificationDelivery.create).not.toHaveBeenCalled();
  });

  it('selects an ordered batch of due open turns for a poll', async () => {
    prismaMock.turnRecord.findMany.mockResolvedValue([
      { id: 'turn-1' },
      { id: 'turn-2' },
    ]);
    const service = new TurnRemindersService();
    const processCandidate = vi
      .spyOn(service, 'processTurnReminderCandidate')
      .mockResolvedValue(undefined);

    await service.processDueTurnReminders(now);

    expect(prismaMock.turnRecord.findMany).toHaveBeenCalledWith({
      where: {
        endedAt: null,
        nextReminderAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ nextReminderAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    expect(processCandidate).toHaveBeenCalledWith('turn-1', now);
    expect(processCandidate).toHaveBeenCalledWith('turn-2', now);
  });

  it('logs lifecycle poll failures without leaving an unhandled rejection', async () => {
    vi.useFakeTimers();
    const failure = new Error('database unavailable');
    const service = new TurnRemindersService();
    vi.spyOn(service, 'processDueTurnReminders').mockRejectedValue(failure);
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);

    expect(logError).toHaveBeenCalledWith(
      'Turn reminder scheduler poll failed.',
      failure.stack,
    );
    await (service.onModuleDestroy() as unknown as Promise<void>);
  });

  it('logs a candidate failure and continues the same due batch', async () => {
    prismaMock.turnRecord.findMany.mockResolvedValue([
      { id: 'turn-1' },
      { id: 'turn-2' },
    ]);
    const failure = new Error('candidate transaction failed');
    const service = new TurnRemindersService();
    const processCandidate = vi
      .spyOn(service, 'processTurnReminderCandidate')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await service.processDueTurnReminders(now);

    expect(processCandidate).toHaveBeenNthCalledWith(1, 'turn-1', now);
    expect(processCandidate).toHaveBeenNthCalledWith(2, 'turn-2', now);
    expect(logError).toHaveBeenCalledWith(
      'Turn reminder candidate turn-1 failed.',
      failure.stack,
    );
  });

  it('does not overlap lifecycle polls and resets after the active poll settles', async () => {
    vi.useFakeTimers();
    let resolveFirstPoll!: () => void;
    const firstPoll = new Promise<void>((resolve) => {
      resolveFirstPoll = resolve;
    });
    const service = new TurnRemindersService();
    const processDue = vi
      .spyOn(service, 'processDueTurnReminders')
      .mockImplementationOnce(() => firstPoll)
      .mockResolvedValue(undefined);

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(processDue).toHaveBeenCalledTimes(1);

    resolveFirstPoll();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(processDue).toHaveBeenCalledTimes(2);
    await (service.onModuleDestroy() as unknown as Promise<void>);
  });

  it('clears its interval and waits for the active lifecycle poll on shutdown', async () => {
    vi.useFakeTimers();
    let resolvePoll!: () => void;
    const activePoll = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });
    const service = new TurnRemindersService();
    vi.spyOn(service, 'processDueTurnReminders').mockImplementation(
      () => activePoll,
    );

    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    const shutdown = service.onModuleDestroy() as unknown as Promise<void>;
    let shutdownComplete = false;
    void shutdown.then(() => {
      shutdownComplete = true;
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(shutdownComplete).toBe(false);

    resolvePoll();
    await shutdown;

    expect(shutdownComplete).toBe(true);
  });
});
