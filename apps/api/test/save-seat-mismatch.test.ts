import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStorageService } from '../src/games/file-storage.service';
import type { TurnMutationDependencies } from '../src/games/services/turn-mutations/dependencies';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));
const { GamesQueryService } =
  await import('../src/games/services/games-query.service');
const { TurnRemindersService } =
  await import('../src/games/services/turn-reminders.service');

const hour = 60 * 60 * 1000;
const turnStart = new Date('2026-09-01T00:00:00Z');
const at = (hours: number) => new Date(turnStart.getTime() + hours * hour);
const save = (content: string) => ({
  originalname: 'turn.se1',
  buffer: Buffer.from(content),
  size: content.length,
});

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(turnStart);
  fixture = await createSqliteFixture();
  const { db } = fixture;
  for (const [id, displayName, discordId] of [
    ['user-1', 'Alpha', 'discord-1'],
    ['user-2', 'Overlord', 'discord-2'],
    ['user-3', 'Third', 'discord-3'],
  ]) {
    await db.user.create({
      data: {
        id,
        displayName,
        email: `${id}@example.com`,
        identities: { create: { provider: 'discord', providerId: discordId } },
      },
    });
  }
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'user-2',
      discordThreadId: 'thread-1',
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', turnOrder: 1 },
          { id: 'seat-2', userId: 'user-3', turnOrder: 2 },
          { id: 'seat-3', userId: 'user-2', turnOrder: 3, role: 'ORGANIZER' },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'user-1',
          activePlayerEntryId: 'seat-1',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn-1',
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          seatNumber: 1,
          playerDisplayName: 'Alpha',
          roundNumber: 4,
          startedAt: turnStart,
          nextReminderAt: at(36),
        },
      },
    },
  });
  let uploadAttempt = 0;
  const dependencies: TurnMutationDependencies = {
    fileStorage: {
      async stageUpload(input) {
        const fileName = `${input.gameNumber}-T${input.turn}-S${input.seat}-${input.playerName}.se1`;
        const storagePath = `/saves/${input.gameId}/upload-${++uploadAttempt}-${fileName}`;
        await input.prepare?.(storagePath);
        return { fileName, storagePath };
      },
      async removeFileOrThrow() {},
    },
  };
  mutations = new TurnMutationsService(
    db,
    new TurnRecordsService(),
    dependencies,
  );
});

afterEach(async () => {
  vi.useRealTimers();
  await fixture?.close();
});

async function uploadAt(hours: number, userId: string, content: string) {
  vi.setSystemTime(at(hours));
  return mutations.uploadSave('game-1', userId, save(content));
}

async function moveActiveSeatAt(hours: number, activePlayerEntryId: string) {
  vi.setSystemTime(at(hours));
  const { turnRevision } = await fixture.db.game.findUniqueOrThrow({
    where: { id: 'game-1' },
  });
  return mutations.reorderSeatOrder('game-1', 'user-2', {
    seatEntryIds: ['seat-1', 'seat-2', 'seat-3'],
    activePlayerEntryId,
    baseline: { campaignId: 'game-1', revision: turnRevision },
  });
}

async function saveSeatMismatch() {
  const detail = await new GamesQueryService(
    {} as FileStorageService,
  ).getGameDetail('ashes');
  return detail.saveSeatMismatch;
}

describe('save seat mismatch', () => {
  it('is absent after a normal upload hands the turn to the next seat', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('is absent after the Overlord skips the seat the save was handed to', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    vi.setSystemTime(at(20));
    await mutations.skipPlayerTurn({
      discordThreadId: 'thread-1',
      callerDiscordId: 'discord-2',
    });

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('is absent after the latest save is rejected', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    const second = await uploadAt(20, 'user-3', 'third turn');
    vi.setSystemTime(at(21));
    await mutations.rejectSave('user-2', {
      gameId: '1',
      fileVersionId: second.fileVersionId,
    });

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('is absent after /replace fills the seat the save was handed to', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    vi.setSystemTime(at(20));
    await mutations.replacePlayerInSeat({
      discordThreadId: 'thread-1',
      callerDiscordId: 'discord-2',
      seatNumber: 2,
      newPlayerDiscordId: 'discord-new',
      newPlayerDisplayName: 'Newcomer',
    });

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('is absent while a vacant turn waits on the seat the save was handed to', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    vi.setSystemTime(at(20));
    await mutations.resignPlayerFromDiscord({
      discordThreadId: 'thread-1',
      playerDiscordId: 'discord-3',
    });

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('is absent when Seat Order moves the active seat before any save exists', async () => {
    await moveActiveSeatAt(5, 'seat-2');

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('names both seats after Seat Order moves the active seat away from the seat the save was handed to', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await moveActiveSeatAt(20, 'seat-3');

    expect(await saveSeatMismatch()).toEqual({
      expectedSeatNumber: 2,
      activeSeatNumber: 3,
    });
  });

  it('names both seats when a resignation from before vacant turns moved the turn on', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await fixture.db.turnRecord.updateMany({
      where: { gameId: 'game-1', endedAt: null },
      data: { endedAt: at(20), completionReason: 'RESIGNED' },
    });
    await fixture.db.turnRecord.create({
      data: {
        gameId: 'game-1',
        gamePlayerId: 'seat-3',
        userId: 'user-2',
        seatNumber: 3,
        playerDisplayName: 'Overlord',
        roundNumber: 4,
        startedAt: at(20),
      },
    });

    expect(await saveSeatMismatch()).toEqual({
      expectedSeatNumber: 2,
      activeSeatNumber: 3,
    });
  });

  it('stays on the seat the save was handed to when the active seat is skipped during a mismatch', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await moveActiveSeatAt(20, 'seat-3');
    vi.setSystemTime(at(30));
    await mutations.skipPlayerTurn({
      discordThreadId: 'thread-1',
      callerDiscordId: 'discord-2',
    });

    expect(await saveSeatMismatch()).toEqual({
      expectedSeatNumber: 2,
      activeSeatNumber: 1,
    });
  });

  it('survives a victory being declared and undone', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await moveActiveSeatAt(20, 'seat-3');
    const thread = {
      discordThreadId: 'thread-1',
      callerDiscordId: 'discord-2',
    };
    await mutations.designateVictory(
      { ...thread, victorDiscordId: 'discord-2' },
      { now: at(30) },
    );
    await mutations.undoVictory(thread, { now: at(40) });

    expect(await saveSeatMismatch()).toEqual({
      expectedSeatNumber: 2,
      activeSeatNumber: 3,
    });
  });

  it('clears when Seat Order moves the active seat back', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await moveActiveSeatAt(20, 'seat-3');
    await moveActiveSeatAt(21, 'seat-2');

    expect(await saveSeatMismatch()).toBeNull();
  });

  it('clears when a new save is uploaded', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await moveActiveSeatAt(20, 'seat-3');
    await uploadAt(30, 'user-2', 'overlord turn');

    expect(await saveSeatMismatch()).toBeNull();
  });
});

describe('turn nudges during a save seat mismatch', () => {
  async function nudgeOpenTurnAt(hours: number) {
    const openTurn = await fixture.db.turnRecord.findFirstOrThrow({
      where: { gameId: 'game-1', endedAt: null },
    });
    await new TurnRemindersService().processTurnReminderCandidate(
      openTurn.id,
      at(hours),
    );
    const delivery = await fixture.db.notificationDelivery.findFirstOrThrow({
      where: { event: 'TURN_NUDGE', turnRecordId: openTurn.id },
    });
    return JSON.parse(delivery.payload) as Record<string, unknown>;
  }

  it('names the seat the latest save is waiting on and the active seat', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await moveActiveSeatAt(20, 'seat-3');

    expect((await nudgeOpenTurnAt(200)).saveSeatMismatch).toEqual({
      expectedSeatNumber: 2,
      activeSeatNumber: 3,
    });
  });

  it('leaves the mismatch out of a normal nudge', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');

    expect(await nudgeOpenTurnAt(200)).not.toHaveProperty('saveSeatMismatch');
  });
});
