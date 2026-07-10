import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/database', () => ({
  prisma: prismaMock,
  AuditEventType: { METADATA_UPDATED: 'METADATA_UPDATED' },
  ArmyCountPreset: {},
  GameDlcMode: {},
  GameMode: {},
  ZoneCountPreset: {},
}));

const { GamesService } = await import('../src/games/games.service');
const { TurnRecordsService } =
  await import('../src/games/services/turn-records.service');

const startedAt = new Date('2026-07-10T00:00:00.000Z');

function createGame(override = {}) {
  return {
    id: 'game-1',
    slug: 'ashes',
    gameNumber: 1,
    name: 'Ashes',
    organizerId: 'organizer-1',
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
    turnReminderRepeatHours: 24,
    turnRemindersEnabled: true,
    players: [
      { id: 'seat-1', userId: 'player-1', turnOrder: 1 },
      { id: 'seat-2', userId: 'organizer-1', turnOrder: 2 },
    ],
    turnState: {
      activePlayerId: 'player-1',
      activePlayerEntryId: 'seat-1',
      roundNumber: 4,
    },
    ...override,
  };
}

function createTransaction(openRecord = {}) {
  return {
    game: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    turnState: { update: vi.fn(async () => ({})) },
    turnRecord: {
      findMany: vi.fn(async () => [
        {
          id: 'turn-1',
          gameId: 'game-1',
          gamePlayerId: 'seat-1',
          userId: 'player-1',
          roundNumber: 4,
          startedAt,
          reminderCount: 0,
          lastReminderAt: null,
          ...openRecord,
        },
      ]),
      update: vi.fn(async () => ({})),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
  };
}

function createService(
  shadowOverride = false,
  turnRecords = new TurnRecordsService(),
) {
  return new GamesService(
    { isUserShadowOverride: vi.fn(async () => shadowOverride) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    turnRecords,
  );
}

describe('GamesService turn policy metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.game.findFirst.mockResolvedValue(createGame());
  });

  it.each([
    ['organizer-1', false],
    ['shadow-1', true],
  ])('allows %s to edit the turn policy', async (userId, shadowOverride) => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await createService(shadowOverride).updateGameMetadata('game-1', userId, {
      turnTargetHours: 48,
    });

    expect(transaction.game.update).toHaveBeenCalledWith({
      where: { id: 'game-1' },
      data: { turnTargetHours: 48 },
    });
    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: new Date('2026-07-12T12:00:00.000Z') },
    });
  });

  it('rejects a policy edit by a user without organizer or Shadow access', async () => {
    await expect(
      createService().updateGameMetadata('game-1', 'player-1', {
        turnTargetHours: 48,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('clears the open due time when reminders are disabled', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await createService().updateGameMetadata('game-1', 'organizer-1', {
      turnRemindersEnabled: false,
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: null },
    });
    const auditEvents = transaction.auditEvent.create.mock.calls as unknown as [
      { data: { payload: string } },
    ][];
    const auditPayload = JSON.parse(auditEvents[0]![0].data.payload) as {
      nextMetadata: { turnRemindersEnabled: boolean };
    };
    expect(auditPayload.nextMetadata.turnRemindersEnabled).toBe(false);
  });

  it('recalculates a reminded open turn from its latest reminder', async () => {
    const transaction = createTransaction({
      reminderCount: 1,
      lastReminderAt: new Date('2026-07-12T08:00:00.000Z'),
    });
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );

    await createService().updateGameMetadata('game-1', 'organizer-1', {
      turnReminderRepeatHours: 6,
    });

    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { nextReminderAt: new Date('2026-07-12T14:00:00.000Z') },
    });
  });

  it('synchronizes the open turn round without resetting its timing', async () => {
    const transaction = createTransaction();
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    await createService(false, new TurnRecordsService()).updateGameMetadata(
      'game-1',
      'organizer-1',
      {
        roundNumber: 5,
      },
    );

    expect(transaction.turnState.update).toHaveBeenCalledWith({
      where: { gameId: 'game-1' },
      data: { roundNumber: 5 },
    });
    expect(transaction.turnRecord.update).toHaveBeenCalledWith({
      where: { id: 'turn-1' },
      data: { roundNumber: 5 },
    });
  });
});
