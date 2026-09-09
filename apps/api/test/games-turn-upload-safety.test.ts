import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { BotNotificationsService } from '../src/games/bot-notifications.service';
import { GamesService } from '../src/games/games.service';
import { GamesFileService } from '../src/games/services/games-file.service';
import { GamesQueryService } from '../src/games/services/games-query.service';
import { GamesRegistrationService } from '../src/games/services/games-registration.service';
import { GamesTurnService } from '../src/games/services/games-turn.service';
import { FileStorageService } from '../src/games/file-storage.service';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

// Route the legacy database singleton to a real migrated SQLite connection.
const database = vi.hoisted(() => ({ current: null as PrismaClient | null }));
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  prisma: new Proxy(
    {},
    { get: (_, key) => Reflect.get(database.current!, key) },
  ),
}));

const file = {
  originalname: 'turn.se1',
  buffer: Buffer.from([1, 2, 3]),
  size: 3,
};
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let storage: FileStorageService;
let directory: string;
let mutations: TurnMutationsService;
let duringStorage: () => Promise<void>;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  database.current = fixture.db;
  directory = await mkdtemp(join(tmpdir(), 'shadow-cloud-upload-'));
  const previous = process.env.SHADOW_CLOUD_SAVE_DIR;
  process.env.SHADOW_CLOUD_SAVE_DIR = directory;
  storage = new FileStorageService();
  if (previous === undefined) delete process.env.SHADOW_CLOUD_SAVE_DIR;
  else process.env.SHADOW_CLOUD_SAVE_DIR = previous;
  const { db } = fixture;
  await db.user.create({
    data: { id: 'user-1', email: 'alpha@example.com', displayName: 'Alpha' },
  });
  await db.user.create({
    data: {
      id: 'user-2',
      email: 'overlord@example.com',
      displayName: 'Overlord',
    },
  });
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
          activePlayerId: 'user-2',
          activePlayerEntryId: 'seat-2',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn-1',
          gamePlayerId: 'seat-2',
          userId: 'user-2',
          seatNumber: 3,
          playerDisplayName: 'Overlord',
          roundNumber: 4,
          startedAt: new Date('2026-09-01T00:00:00Z'),
        },
      },
    },
  });
  duringStorage = async () => {};
  mutations = new TurnMutationsService(db, new TurnRecordsService(), {
    fileStorage: {
      async stageUpload(input) {
        const result = await storage.stageUpload(input);
        await duringStorage();
        return result;
      },
      removeFileOrThrow: (path) => storage.removeFileOrThrow(path),
    },
  });
});

afterEach(async () => {
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
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

async function seedDeliveries() {
  for (const status of [
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED',
  ] as const) {
    await fixture.db.notificationDelivery.create({
      data: {
        id: status,
        status,
        event: 'TURN_NUDGE',
        gameId: 'game-1',
        gameSlug: 'ashes',
        turnRecordId: 'turn-1',
        payload: '{}',
      },
    });
  }
  await fixture.db.notificationDelivery.create({
    data: {
      id: 'other-event',
      event: 'SAVE_UPLOADED',
      gameId: 'game-1',
      gameSlug: 'ashes',
      turnRecordId: 'turn-1',
      payload: '{}',
    },
  });
  await fixture.db.turnRecord.create({
    data: {
      id: 'older-turn',
      gameId: 'game-1',
      roundNumber: 3,
      playerDisplayName: 'Alpha',
      startedAt: new Date('2026-08-01T00:00:00Z'),
      endedAt: new Date('2026-08-02T00:00:00Z'),
    },
  });
  await fixture.db.notificationDelivery.create({
    data: {
      id: 'other-turn',
      event: 'TURN_NUDGE',
      gameId: 'game-1',
      gameSlug: 'ashes',
      turnRecordId: 'older-turn',
      payload: '{}',
    },
  });
}

describe('upload safety through the public mutation owner', () => {
  it('persists first-upload advancement and round wrap through fresh campaign queries without advancing retries', async () => {
    await fixture.db.turnState.update({
      where: { gameId: 'game-1' },
      data: {
        activePlayerId: 'user-1',
        activePlayerEntryId: 'seat-1',
        roundNumber: 1,
      },
    });
    await fixture.db.turnRecord.update({
      where: { id: 'turn-1' },
      data: {
        gamePlayerId: 'seat-1',
        userId: 'user-1',
        seatNumber: 1,
        playerDisplayName: 'Alpha',
        roundNumber: 1,
      },
    });

    const freshCampaignService = async () => {
      await database.current!.$disconnect();
      database.current = fixture.connect();
      const owner = new TurnMutationsService(
        database.current,
        new TurnRecordsService(),
        { fileStorage: storage },
      );
      const auth = new AuthService();
      const notifications = new BotNotificationsService();
      return new GamesService(
        auth,
        new GamesQueryService(storage),
        new GamesRegistrationService(notifications, owner),
        new GamesTurnService(owner),
        storage,
        new GamesFileService(auth, storage, notifications),
        owner,
      );
    };

    let campaigns = await freshCampaignService();
    expect((await campaigns.getGameDetail('1')).fileVersions).toEqual([]);
    for (const step of [
      {
        uploader: 'user-1',
        nextUser: 'user-2',
        nextSeat: 'seat-2',
        nextName: 'Overlord',
        round: 1,
        version: 1,
        name: '1-T1-S3-Overlord.se1',
      },
      {
        uploader: 'user-2',
        nextUser: 'user-1',
        nextSeat: 'seat-1',
        nextName: 'Alpha',
        round: 2,
        version: 2,
        name: '1-T2-S1-Alpha.se1',
      },
    ]) {
      const before = await campaigns.getGameDetail('1');
      const metadata = {
        idempotencyKey: `completed-turn-${step.version}`,
        expectedSaveBaseline: before.saveBaseline,
        expectedActivePlayerEntryId: before.activePlayerEntryId!,
        expectedActivePlayerUserId: step.uploader,
        expectedRoundNumber: before.roundNumber,
        expectedLatestFileVersionId: before.fileVersions[0]?.id ?? null,
      };
      const uploaded = await campaigns.uploadSave(
        '1',
        step.uploader,
        file,
        metadata,
      );
      expect(uploaded).toMatchObject({
        versionNumber: step.version,
        originalName: step.name,
        roundNumber: step.round,
        roundAdvanced: step.version === 2,
        activePlayer: { id: step.nextSeat, userId: step.nextUser },
      });

      campaigns = await freshCampaignService();
      const detail = await campaigns.getGameDetail('ashes');
      expect(detail).toMatchObject({
        activePlayerEntryId: step.nextSeat,
        activePlayerUserId: step.nextUser,
        activePlayerDisplayName: step.nextName,
        roundNumber: step.round,
        seatOrderBaseline: { revision: step.version },
        openTurn: {
          gamePlayerId: step.nextSeat,
          userId: step.nextUser,
          roundNumber: step.round,
        },
      });
      expect(detail.fileVersions).toHaveLength(step.version);
      expect(detail.fileVersions[0]).toMatchObject({
        id: uploaded.fileVersionId,
        originalName: step.name,
        uploadedById: step.uploader,
      });
      expect(detail.recentCompletedTurns).toHaveLength(step.version);
      expect(detail.recentCompletedTurns).toContainEqual(
        expect.objectContaining({
          userId: step.uploader,
          completionReason: 'SAVE_UPLOADED',
          endedAt: detail.openTurn!.startedAt,
        }),
      );
      expect(await campaigns.listGames()).toEqual([
        expect.objectContaining({
          activePlayerUserId: step.nextUser,
          activePlayerDisplayName: step.nextName,
          roundNumber: step.round,
          latestSave: { id: uploaded.fileVersionId, originalName: step.name },
        }),
      ]);
      expect(await campaigns.getGameStatus('1', step.uploader)).toMatchObject({
        activePlayer: { id: step.nextSeat, userId: step.nextUser },
        canCurrentPlayerUpload: false,
      });
      expect(await campaigns.getGameStatus('1', step.nextUser)).toMatchObject({
        canCurrentPlayerUpload: true,
      });

      expect(
        await campaigns.uploadSave('game-1', step.uploader, file, metadata),
      ).toMatchObject({
        fileVersionId: uploaded.fileVersionId,
        idempotentReplay: true,
      });
      campaigns = await freshCampaignService();
      expect(await campaigns.getGameDetail('1')).toEqual(detail);
    }
  });

  it.each(['wraparound', 'single-player'])(
    'completes a %s turn with incremented round, canonical naming, and exactly one revision',
    async (scenario) => {
      if (scenario === 'single-player')
        await fixture.db.gamePlayer.update({
          where: { id: 'seat-1' },
          data: { userId: null },
        });
      const result = await mutations.uploadSave('ashes', 'user-2', file);
      const seat = scenario === 'single-player' ? 'seat-2' : 'seat-1';
      const user = scenario === 'single-player' ? 'user-2' : 'user-1';
      const name =
        scenario === 'single-player'
          ? '1-T5-S3-Overlord.se1'
          : '1-T5-S1-Alpha.se1';
      expect(result).toMatchObject({
        originalName: name,
        roundNumber: 5,
        roundAdvanced: true,
        activePlayer: { id: seat, userId: user },
      });
      const state = await persistedState();
      expect(state.games[0].turnRevision).toBe(1);
      expect(state.turns[0]).toMatchObject({
        activePlayerEntryId: seat,
        activePlayerId: user,
        roundNumber: 5,
      });
      expect(state.history).toHaveLength(2);
      const open = state.history.filter((record) => record.endedAt === null);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        gamePlayerId: seat,
        userId: user,
        roundNumber: 5,
      });
      expect(open[0].id).not.toBe('turn-1');
      expect(
        state.history.find((record) => record.id === 'turn-1'),
      ).toMatchObject({
        endedAt: open[0].startedAt,
        completionReason: 'SAVE_UPLOADED',
      });
      expect(state.files[0]).toMatchObject({
        originalName: name,
        uploadedAt: open[0].startedAt,
      });
      expect(dirname(state.files[0].storagePath)).toBe(
        join(directory, 'saves', 'game-1'),
      );
      expect(await readFile(state.files[0].storagePath)).toEqual(file.buffer);
      expect(state.audits).toHaveLength(2);
    },
  );

  it('cancels only pending nudges for the completed turn and uses the current reminder policy', async () => {
    await seedDeliveries();
    const before = await fixture.db.notificationDelivery.findMany({
      where: { id: { not: 'PENDING' } },
      orderBy: { id: 'asc' },
    });
    duringStorage = async () => {
      await fixture.connect().game.update({
        where: { id: 'game-1' },
        data: { turnRemindersEnabled: false },
      });
    };
    await mutations.uploadSave('1', 'user-2', file);
    expect(
      await fixture.db.notificationDelivery.findUniqueOrThrow({
        where: { id: 'PENDING' },
      }),
    ).toMatchObject({ status: 'CANCELLED', processingStartedAt: null });
    expect(
      await fixture.db.notificationDelivery.findMany({
        where: { id: { not: 'PENDING' } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    expect(
      await fixture.db.turnRecord.findFirstOrThrow({
        where: { endedAt: null },
      }),
    ).toMatchObject({ nextReminderAt: null });
  });

  it('rolls back file metadata, active state, history, nudges, both audits, and revision after a real late trigger failure', async () => {
    await seedDeliveries();
    const previous = await storage.storeFile({
      gameId: 'game-1',
      gameNumber: 1,
      turn: 5,
      seat: 1,
      playerName: 'Alpha',
      originalName: 'turn.se1',
      content: Buffer.from('committed save'),
    });
    await fixture.db.fileVersion.create({
      data: {
        gameId: 'game-1',
        uploadedById: 'user-2',
        storagePath: previous.storagePath,
        originalName: previous.fileName,
        versionNumber: 1,
      },
    });
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_upload AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'TURN_ADVANCED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT activePlayerEntryId FROM TurnState WHERE gameId = NEW.gameId) = 'seat-1'
      AND (SELECT status FROM NotificationDelivery WHERE id = 'PENDING') = 'CANCELLED'
      AND (SELECT COUNT(*) FROM TurnRecord WHERE gameId = NEW.gameId) = 3
      AND (SELECT COUNT(*) FROM AuditEvent WHERE gameId = NEW.gameId) = 2
      AND (SELECT COUNT(*) FROM FileVersion WHERE gameId = NEW.gameId) = 2
      AND EXISTS (SELECT 1 FROM FileVersion WHERE idempotencyKey = 'upload-1' AND contentHash IS NOT NULL AND clientFileSize = 3 AND clientOriginalName = 'turn.se1')
      BEGIN SELECT RAISE(ABORT, 'injected failure after upload effects'); END`);
    const before = await persistedState();
    await expect(
      mutations.uploadSave('1', 'user-2', file, {
        contentHash: 'sha256:abc',
        idempotencyKey: 'upload-1',
      }),
    ).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    expect(await readFile(previous.storagePath)).toEqual(
      Buffer.from('committed save'),
    );
    const files = (
      await readdir(join(directory, 'saves'), { recursive: true })
    ).filter((path) => path.endsWith('.se1'));
    expect(files).toEqual([join('game-1', '1-T5-S1-Alpha.se1')]);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_upload');
    expect(await mutations.uploadSave('1', 'user-2', file)).toMatchObject({
      versionNumber: 2,
    });
    expect((await persistedState()).games[0].turnRevision).toBe(1);
  });

  it.each([undefined, 'outsider', 'user-1'])(
    'rejects unauthorized caller %s before storage',
    async (userId) => {
      const before = await persistedState();
      await expect(
        mutations.uploadSave('1', userId, file),
      ).rejects.toBeInstanceOf(
        userId === undefined ? UnauthorizedException : ForbiddenException,
      );
      expect(await persistedState()).toEqual(before);
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it.each(['membership', 'active player'])(
    'revalidates local %s authorization after storage',
    async (change) => {
      let changed: Awaited<ReturnType<typeof persistedState>>;
      duringStorage = async () => {
        const db = fixture.connect();
        if (change === 'membership') {
          await db.game.update({
            where: { id: 'game-1' },
            data: { organizerId: 'user-1' },
          });
          await db.gamePlayer.update({
            where: { id: 'seat-2' },
            data: { userId: null },
          });
        } else {
          await db.turnState.update({
            where: { gameId: 'game-1' },
            data: { activePlayerEntryId: 'seat-1', activePlayerId: 'user-1' },
          });
        }
        changed = await persistedState(db);
      };
      await expect(
        mutations.uploadSave('1', 'user-2', file),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState()).toEqual(changed!);
      expect(
        (await readdir(join(directory, 'saves'), { recursive: true })).filter(
          (path) => path.endsWith('.se1'),
        ),
      ).toEqual([]);
    },
  );

  it('preserves missing game, uninitialized game, and unresolvable participant errors', async () => {
    await expect(
      mutations.uploadSave('missing', 'user-2', file),
    ).rejects.toBeInstanceOf(NotFoundException);
    await fixture.db.turnState.update({
      where: { gameId: 'game-1' },
      data: { activePlayerEntryId: 'seat-open' },
    });
    await expect(
      mutations.uploadSave('1', 'user-2', file),
    ).rejects.toBeInstanceOf(NotFoundException);
    await fixture.db.turnState.deleteMany();
    await expect(
      mutations.uploadSave('1', 'user-2', file),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await readdir(directory)).toEqual([]);
  });

  it('rolls back and removes staging when real open history does not match the participant', async () => {
    await fixture.db.turnRecord.update({
      where: { id: 'turn-1' },
      data: { userId: 'user-1' },
    });
    const before = await persistedState();
    await expect(
      mutations.uploadSave('1', 'user-2', file),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(before);
    expect(
      (await readdir(join(directory, 'saves'), { recursive: true })).filter(
        (path) => path.endsWith('.se1'),
      ),
    ).toEqual([]);
  });
});
