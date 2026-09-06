import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { TurnMutationDependencies } from '../src/games/services/turn-mutations/dependencies';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

const file = {
  originalname: 'turn.se1',
  buffer: Buffer.from([1, 2, 3]),
  size: 3,
};
const metadata = { contentHash: 'sha256:abc', idempotencyKey: 'upload-1' };
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;
let stored: Map<string, Buffer>;
let duringStorage: () => Promise<void>;
let notify: () => Promise<void>;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  const { db } = fixture;
  for (const [id, displayName] of [
    ['user-1', 'Alpha'],
    ['user-2', 'Overlord'],
    ['user-3', 'Third'],
  ]) {
    await db.user.create({
      data: { id, displayName, email: `${id}@example.com` },
    });
  }
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'user-2',
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', turnOrder: 1 },
          { id: 'seat-open', turnOrder: 2 },
          { id: 'seat-2', userId: 'user-2', turnOrder: 3, role: 'ORGANIZER' },
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
          startedAt: new Date('2026-09-01T00:00:00Z'),
        },
      },
    },
  });
  stored = new Map();
  duringStorage = async () => {};
  notify = async () => {};
  let uploadAttempt = 0;
  const dependencies: TurnMutationDependencies = {
    fileStorage: {
      async stageUpload(input) {
        const fileName = `${input.gameNumber}-T${input.turn}-S${input.seat}-${input.playerName}.se1`;
        const storagePath = `/saves/${input.gameId}/upload-${++uploadAttempt}-${fileName}`;
        stored.set(storagePath, input.content);
        await duringStorage();
        return { fileName, storagePath };
      },
      async removeFile(path) {
        stored.delete(path);
      },
    },
    botNotifications: {
      notifySaveUploaded: () => notify(),
      notifyGameInitialized: async () => {},
      notifyThreadRenamed: async () => {},
    },
  };
  mutations = new TurnMutationsService(
    db,
    new TurnRecordsService(),
    dependencies,
  );
});

afterEach(async () => {
  await fixture?.close();
});

async function persistedState(db = fixture.db) {
  return {
    games: await db.game.findMany({ orderBy: { id: 'asc' } }),
    seats: await db.gamePlayer.findMany({ orderBy: { id: 'asc' } }),
    turns: await db.turnState.findMany({ orderBy: { id: 'asc' } }),
    history: await db.turnRecord.findMany({ orderBy: { id: 'asc' } }),
    files: await db.fileVersion.findMany({ orderBy: { id: 'asc' } }),
    reminders: await db.notificationDelivery.findMany({
      orderBy: { id: 'asc' },
    }),
    audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  };
}

describe('atomic upload through real SQLite', () => {
  it('reports lost active-player authorization before a stale revision after a competing skip', async () => {
    await fixture.db.game.update({
      where: { id: 'game-1' },
      data: { discordThreadId: 'thread-1' },
    });
    await fixture.db.authIdentity.create({
      data: { provider: 'discord', providerId: 'discord-2', userId: 'user-2' },
    });
    let committed: Awaited<ReturnType<typeof persistedState>>;
    duringStorage = async () => {
      const competitor = new TurnMutationsService(
        fixture.connect(),
        new TurnRecordsService(),
      );
      await competitor.skipPlayerTurn({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
      });
      committed = await persistedState();
    };
    await expect(
      mutations.uploadSave('1', 'user-1', file, metadata),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await persistedState()).toEqual(committed!);
    expect(committed!.games[0].turnRevision).toBe(1);
    expect(committed!.turns[0]).toMatchObject({
      activePlayerEntryId: 'seat-2',
      activePlayerId: 'user-2',
    });
    expect(committed!.files).toHaveLength(0);
    expect(stored.size).toBe(0);
  });

  it('rejects an intervening turn sequence even when seat, occupant, round, and latest save return to their observed values', async () => {
    await fixture.db.game.update({
      where: { id: 'game-1' },
      data: { discordThreadId: 'thread-1' },
    });
    await fixture.db.authIdentity.create({
      data: { provider: 'discord', providerId: 'discord-2', userId: 'user-2' },
    });
    let committed: Awaited<ReturnType<typeof persistedState>>;
    duringStorage = async () => {
      const competitor = new TurnMutationsService(
        fixture.connect(),
        new TurnRecordsService(),
      );
      await competitor.skipPlayerTurn({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
      });
      await competitor.skipPlayerTurn({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
      });
      committed = await persistedState();
    };
    await expect(
      mutations.uploadSave('1', 'user-1', file),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(committed!);
    expect(committed!.games[0].turnRevision).toBe(2);
    expect(committed!.turns[0]).toMatchObject({
      activePlayerEntryId: 'seat-1',
      activePlayerId: 'user-1',
      roundNumber: 4,
    });
    expect(stored.size).toBe(0);
  });

  it('does not retry or mislabel database lock contention as a proven stale upload', async () => {
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let writer: Promise<void> | undefined;
    duringStorage = async () => {
      writer = fixture.connect().$transaction(async (transaction) => {
        await transaction.game.update({
          where: { id: 'game-1' },
          data: { notes: 'Concurrent writer' },
        });
        locked.resolve();
        await release.promise;
      });
      void writer.catch(locked.reject);
      await locked.promise;
    };
    try {
      const result = await mutations.uploadSave('1', 'user-1', file).then(
        () => ({ error: null }),
        (error: unknown) => ({ error }),
      );
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error).not.toBeInstanceOf(ConflictException);
    } finally {
      release.resolve();
      await writer;
    }
    const state = await persistedState();
    expect(state.games[0]).toMatchObject({
      turnRevision: 0,
      notes: 'Concurrent writer',
    });
    expect(state.turns[0].activePlayerEntryId).toBe('seat-1');
    expect(state.history).toHaveLength(1);
    expect(state.audits).toHaveLength(0);
    expect(state.files).toHaveLength(0);
    expect(stored.size).toBe(0);
  });

  it('accepts matching optional expectations, including an explicit empty latest-save baseline', async () => {
    expect(
      await mutations.uploadSave('game-1', 'user-1', file, {
        expectedActivePlayerEntryId: 'seat-1',
        expectedActivePlayerUserId: 'user-1',
        expectedRoundNumber: 4,
        expectedLatestFileVersionId: null,
      }),
    ).toMatchObject({ versionNumber: 1, activePlayer: { id: 'seat-2' } });
    const latest = (await persistedState()).files[0];
    expect(
      await mutations.uploadSave('game-1', 'user-2', file, {
        expectedLatestFileVersionId: latest.id,
      }),
    ).toMatchObject({ versionNumber: 2, roundNumber: 5 });
    expect((await persistedState()).games[0].turnRevision).toBe(2);
  });

  it('uses a previously renamed successor in the filename without requiring a client revision', async () => {
    await fixture.db.user.update({
      where: { id: 'user-2' },
      data: { displayName: 'Renamed' },
    });
    expect((await persistedState()).games[0].turnRevision).toBe(0);
    expect(await mutations.uploadSave('1', 'user-1', file)).toMatchObject({
      originalName: '1-T4-S3-Renamed.se1',
      activePlayer: { displayName: 'Renamed' },
    });
    expect((await persistedState()).games[0].turnRevision).toBe(1);
  });

  it('resolves a legacy null active-seat reference only for an unambiguous occupied seat', async () => {
    await fixture.db.turnState.update({
      where: { gameId: 'game-1' },
      data: { activePlayerEntryId: null },
    });
    expect(await mutations.uploadSave('1', 'user-1', file)).toMatchObject({
      activePlayer: { id: 'seat-2' },
    });
    expect((await persistedState()).games[0].turnRevision).toBe(1);
  });

  it('returns committed success and keeps the save when post-commit notification transport fails', async () => {
    let committed: Awaited<ReturnType<typeof persistedState>>;
    notify = async () => {
      committed = await persistedState(fixture.connect());
      expect(committed.games[0].turnRevision).toBe(1);
      expect(committed.files).toHaveLength(1);
      throw new Error('Transport unavailable');
    };
    const result = await mutations.uploadSave('1', 'user-1', file, metadata);
    expect(result).toMatchObject({
      versionNumber: 1,
      activePlayer: { id: 'seat-2' },
    });
    expect(await persistedState()).toEqual(committed!);
    expect(stored.get(committed!.files[0].storagePath)).toEqual(file.buffer);
    expect(stored.size).toBe(1);
  });

  it('recognizes a replay before active-player, membership, and stale expectation checks', async () => {
    const first = await mutations.uploadSave('1', 'user-1', file, metadata);
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-1' },
      data: { userId: null },
    });
    const before = await persistedState();
    const beforeFiles = new Map(stored);
    const replay = await mutations.uploadSave('ashes', 'user-1', file, {
      ...metadata,
      expectedActivePlayerEntryId: 'seat-1',
      expectedActivePlayerUserId: 'user-1',
      expectedRoundNumber: 3,
      expectedLatestFileVersionId: null,
    });
    expect(replay).toEqual({
      fileVersionId: first.fileVersionId,
      versionNumber: 1,
      originalName: first.originalName,
      roundNumber: 4,
      roundAdvanced: false,
      activePlayer: null,
      idempotentReplay: true,
    });
    expect(await persistedState()).toEqual(before);
    expect(stored).toEqual(beforeFiles);
  });

  it.each(['competing upload', 'legacy file metadata'])(
    'rechecks replay under the write lock after %s and removes only its own staging',
    async (competitor) => {
      let committed: Awaited<ReturnType<typeof persistedState>>;
      let winningFile: { id: string; originalName: string };
      let notifications = 0;
      notify = async () => {
        notifications += 1;
      };
      duringStorage = async () => {
        duringStorage = async () => {};
        if (competitor === 'competing upload') {
          const result = await mutations.uploadSave(
            '1',
            'user-1',
            { ...file, buffer: Buffer.from('winner') },
            metadata,
          );
          winningFile = {
            id: result.fileVersionId,
            originalName: result.originalName,
          };
        } else {
          winningFile = await fixture.connect().fileVersion.create({
            data: {
              gameId: 'game-1',
              uploadedById: 'user-1',
              storagePath: '/winner.se1',
              originalName: 'winner.se1',
              versionNumber: 1,
              ...metadata,
            },
          });
        }
        committed = await persistedState();
      };
      const result = await mutations.uploadSave('1', 'user-1', file, {
        ...metadata,
        expectedLatestFileVersionId: null,
      });
      expect(result).toEqual({
        fileVersionId: winningFile!.id,
        versionNumber: 1,
        originalName: winningFile!.originalName,
        roundNumber: 4,
        roundAdvanced: false,
        activePlayer: null,
        idempotentReplay: true,
      });
      expect(await persistedState()).toEqual(committed!);
      expect(stored.size).toBe(competitor === 'competing upload' ? 1 : 0);
      if (competitor === 'competing upload') {
        expect(stored.get(committed!.files[0].storagePath)).toEqual(
          Buffer.from('winner'),
        );
      }
      expect(notifications).toBe(competitor === 'competing upload' ? 1 : 0);
    },
  );

  it.each([
    'renamed successor',
    'replaced successor',
    'reordered successor',
    'emptied successor',
    'recreated successor',
    'new successor',
    'changed active seat',
    'changed round',
    'changed campaign number',
    'new latest save',
  ])(
    'rejects a %s during storage without committing the staged upload',
    async (change) => {
      let changed: Awaited<ReturnType<typeof persistedState>>;
      duringStorage = async () => {
        const db = fixture.connect();
        if (change === 'renamed successor')
          await db.user.update({
            where: { id: 'user-2' },
            data: { displayName: 'Renamed' },
          });
        if (change === 'replaced successor')
          await db.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { userId: 'user-3' },
          });
        if (change === 'reordered successor')
          await db.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { turnOrder: 4 },
          });
        if (change === 'emptied successor')
          await db.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { userId: null },
          });
        if (change === 'recreated successor') {
          await db.gamePlayer.delete({ where: { id: 'seat-2' } });
          await db.gamePlayer.create({
            data: {
              id: 'recreated-seat',
              gameId: 'game-1',
              userId: 'user-2',
              turnOrder: 3,
            },
          });
        }
        if (change === 'new successor')
          await db.gamePlayer.update({
            where: { id: 'seat-open' },
            data: { userId: 'user-3' },
          });
        if (change === 'changed active seat') {
          await db.gamePlayer.update({
            where: { id: 'seat-open' },
            data: { userId: 'user-1' },
          });
          await db.turnState.update({
            where: { gameId: 'game-1' },
            data: { activePlayerEntryId: 'seat-open' },
          });
        }
        if (change === 'changed round')
          await db.turnState.update({
            where: { gameId: 'game-1' },
            data: { roundNumber: 5 },
          });
        if (change === 'changed campaign number')
          await db.game.update({
            where: { id: 'game-1' },
            data: { gameNumber: 2 },
          });
        if (change === 'new latest save')
          await db.fileVersion.create({
            data: {
              gameId: 'game-1',
              uploadedById: 'user-2',
              storagePath: '/existing.se1',
              originalName: 'existing.se1',
              versionNumber: 1,
            },
          });
        changed = await persistedState(db);
      };
      await expect(
        mutations.uploadSave('1', 'user-1', file, metadata),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(changed!);
      expect(stored.size).toBe(0);
    },
  );

  it.each([
    { expectedActivePlayerEntryId: 'seat-2' },
    { expectedActivePlayerUserId: 'user-2' },
    { expectedRoundNumber: 3 },
    { expectedLatestFileVersionId: 'missing-file' },
  ])(
    'rejects stale optional expectations before storing bytes: %j',
    async (expectation) => {
      const before = await persistedState();
      await expect(
        mutations.uploadSave('1', 'user-1', file, expectation),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(before);
      expect(stored.size).toBe(0);
    },
  );

  it('commits the save, successor, timed history, both audits, and one revision together', async () => {
    const result = await mutations.uploadSave('1', 'user-1', file, metadata);
    expect(result).toEqual({
      fileVersionId: expect.any(String),
      versionNumber: 1,
      originalName: '1-T4-S3-Overlord.se1',
      roundNumber: 4,
      roundAdvanced: false,
      activePlayer: {
        id: 'seat-2',
        userId: 'user-2',
        displayName: 'Overlord',
        turnOrder: 3,
        isOrganizer: true,
      },
    });
    const state = await persistedState();
    expect(state.games[0].turnRevision).toBe(1);
    expect(state.turns[0]).toMatchObject({
      activePlayerId: 'user-2',
      activePlayerEntryId: 'seat-2',
      roundNumber: 4,
    });
    expect(state.files).toHaveLength(1);
    expect(state.files[0]).toMatchObject({
      id: result.fileVersionId,
      uploadedById: 'user-1',
      originalName: result.originalName,
      versionNumber: 1,
      ...metadata,
      clientOriginalName: 'turn.se1',
      clientFileSize: 3,
    });
    expect(stored.get(state.files[0].storagePath)).toEqual(file.buffer);
    expect(state.history).toHaveLength(2);
    const open = state.history.find((record) => record.endedAt === null)!;
    expect(open).toMatchObject({
      gamePlayerId: 'seat-2',
      userId: 'user-2',
      seatNumber: 3,
      roundNumber: 4,
      playerDisplayName: 'Overlord',
    });
    expect(
      state.history.find((record) => record.id === 'turn-1'),
    ).toMatchObject({
      endedAt: open.startedAt,
      completionReason: 'SAVE_UPLOADED',
      nextReminderAt: null,
    });
    expect(state.audits.map((audit) => audit.eventType).sort()).toEqual([
      'FILE_UPLOADED',
      'TURN_ADVANCED',
    ]);
    expect(state.audits.every((audit) => audit.actorId === 'user-1')).toBe(
      true,
    );
    expect(
      JSON.parse(
        state.audits.find((audit) => audit.eventType === 'TURN_ADVANCED')!
          .payload,
      ),
    ).toEqual({
      previousActivePlayerEntryId: 'seat-1',
      previousActivePlayerUserId: 'user-1',
      nextActivePlayerEntryId: 'seat-2',
      nextActivePlayerUserId: 'user-2',
      roundNumber: 4,
      roundAdvanced: false,
      fileVersionId: result.fileVersionId,
    });
  });
});
