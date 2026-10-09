import { ConflictException, GoneException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteFixture } from './support/sqlite-fixture';
import { FileStorageService } from '../src/games/file-storage.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import {
  pruneRetainedSaves,
  resolveSaveRetentionLimit,
} from '../src/games/support/save-retention';
import { cleanupSaveRecovery } from '../src/games/support/save-recovery';

const database = vi.hoisted(() => ({ current: null as PrismaClient | null }));
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  prisma: new Proxy(
    {},
    { get: (_, key) => Reflect.get(database.current!, key) },
  ),
}));
import { GamesQueryService } from '../src/games/services/games-query.service';

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let directory: string;
let storage: FileStorageService;
let uploads: TurnMutationsService;
const file = (text: string) => ({
  originalname: 'turn.se1',
  buffer: Buffer.from(text),
  size: text.length,
});

beforeEach(async () => {
  fixture = await createSqliteFixture();
  database.current = fixture.db;
  directory = await mkdtemp(join(tmpdir(), 'save-retention-'));
  vi.stubEnv('SHADOW_CLOUD_SAVE_DIR', directory);
  storage = new FileStorageService();
  await fixture.db.user.create({
    data: { id: 'player', email: 'player@example.com', displayName: 'Player' },
  });
  await fixture.db.game.create({
    data: {
      id: 'campaign',
      gameNumber: 1,
      slug: 'campaign',
      name: 'Campaign',
      organizerId: 'player',
      players: {
        create: {
          id: 'seat',
          userId: 'player',
          turnOrder: 1,
          role: 'ORGANIZER',
        },
      },
      turnState: {
        create: {
          activePlayerId: 'player',
          activePlayerEntryId: 'seat',
          roundNumber: 1,
        },
      },
      turnRecords: {
        create: {
          gamePlayerId: 'seat',
          userId: 'player',
          seatNumber: 1,
          playerDisplayName: 'Player',
          roundNumber: 1,
          startedAt: new Date(),
        },
      },
    },
  });
  uploads = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    fileStorage: storage,
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function uploadSaves(...contents: string[]) {
  const results = [];
  for (const content of contents) {
    results.push(await uploads.uploadSave('campaign', 'player', file(content)));
  }
  return results;
}

async function keptVersionNumbers() {
  const kept = await fixture.db.fileVersion.findMany({
    where: { gameId: 'campaign' },
    orderBy: { versionNumber: 'asc' },
  });
  return kept.map((save) => save.versionNumber);
}

describe('save retention limit setting', () => {
  it('keeps ten saves unless configured', () => {
    expect(resolveSaveRetentionLimit({})).toBe(10);
    expect(
      resolveSaveRetentionLimit({ SHADOW_CLOUD_SAVE_RETENTION_LIMIT: '' }),
    ).toBe(10);
    expect(
      resolveSaveRetentionLimit({ SHADOW_CLOUD_SAVE_RETENTION_LIMIT: '4' }),
    ).toBe(4);
  });

  it.each(['1', '0', '-3', '2.5', 'ten'])(
    'refuses %s because a rejection needs the previous save',
    (value) => {
      expect(() =>
        resolveSaveRetentionLimit({ SHADOW_CLOUD_SAVE_RETENTION_LIMIT: value }),
      ).toThrow(/SHADOW_CLOUD_SAVE_RETENTION_LIMIT/);
    },
  );
});

describe('pruning on upload', () => {
  it('prunes the oldest saves and deletes their files', async () => {
    vi.stubEnv('SHADOW_CLOUD_SAVE_RETENTION_LIMIT', '3');
    const [first] = await uploadSaves('one', 'two', 'three', 'four', 'five');

    expect(await keptVersionNumbers()).toEqual([3, 4, 5]);
    const pruned = await fixture.db.prunedSave.findMany({
      orderBy: { versionNumber: 'asc' },
    });
    expect(pruned.map((save) => save.versionNumber)).toEqual([1, 2]);
    expect(pruned[0]).toMatchObject({
      id: first.fileVersionId,
      gameId: 'campaign',
      uploadedById: 'player',
    });
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(3);
    expect(await fixture.db.saveCleanup.count()).toBe(0);
  });

  it('still recognises a pruned save uploaded again', async () => {
    vi.stubEnv('SHADOW_CLOUD_SAVE_RETENTION_LIMIT', '2');
    await uploadSaves('one', 'two', 'three');

    await expect(
      uploads.uploadSave('campaign', 'player', file('one')),
    ).rejects.toThrow(
      new ConflictException(
        'This is the same file as save #1, uploaded by Player. Upload the save from your own turn.',
      ),
    );
    expect(await keptVersionNumbers()).toEqual([2, 3]);
  });
});

describe('pruning the backlog', () => {
  it('prunes every campaign over the limit and reports what it pruned', async () => {
    await uploadSaves('one', 'two', 'three', 'four', 'five');
    expect(await keptVersionNumbers()).toEqual([1, 2, 3, 4, 5]);

    await expect(pruneRetainedSaves(fixture.db, 2)).resolves.toEqual({
      saves: 3,
      campaigns: 1,
      failed: [],
    });
    expect(await keptVersionNumbers()).toEqual([4, 5]);
    expect(await fixture.db.prunedSave.count()).toBe(3);

    await cleanupSaveRecovery(fixture.db, storage);
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(2);
    await expect(pruneRetainedSaves(fixture.db, 2)).resolves.toEqual({
      saves: 0,
      campaigns: 0,
      failed: [],
    });
  });

  it('keeps pruning other campaigns when one cannot be pruned', async () => {
    await uploadSaves('one', 'two', 'three');
    const stuck = await fixture.db.fileVersion.findFirstOrThrow({
      where: { gameId: 'campaign', versionNumber: 1 },
    });
    await fixture.db.prunedSave.create({
      data: {
        id: stuck.id,
        gameId: 'campaign',
        versionNumber: 1,
        originalName: stuck.originalName,
        uploadedById: 'player',
        uploadedAt: stuck.uploadedAt,
      },
    });
    await fixture.db.game.create({
      data: {
        id: 'other',
        gameNumber: 2,
        slug: 'other',
        name: 'Other',
        organizerId: 'player',
        fileVersions: {
          create: [1, 2, 3].map((versionNumber) => ({
            uploadedById: 'player',
            storagePath: `/saves/other/${versionNumber}.se1`,
            originalName: `${versionNumber}.se1`,
            versionNumber,
          })),
        },
      },
    });

    const result = await pruneRetainedSaves(fixture.db, 2);

    expect(result).toMatchObject({ saves: 1, campaigns: 1 });
    expect(result.failed.map((failure) => failure.gameId)).toEqual([
      'campaign',
    ]);
    expect(await keptVersionNumbers()).toEqual([1, 2, 3]);
    const other = await fixture.db.fileVersion.findMany({
      where: { gameId: 'other' },
      orderBy: { versionNumber: 'asc' },
    });
    expect(other.map((save) => save.versionNumber)).toEqual([2, 3]);
  });
});

describe('reading pruned saves', () => {
  it('explains that a pruned save was deleted under the limit', async () => {
    vi.stubEnv('SHADOW_CLOUD_SAVE_RETENTION_LIMIT', '2');
    const [first] = await uploadSaves('one', 'two', 'three');

    await expect(
      new GamesQueryService(storage).downloadSave(
        'campaign',
        first.fileVersionId,
      ),
    ).rejects.toThrow(
      new GoneException('Save #1 was deleted under the save retention limit.'),
    );
  });

  it('lists exactly the kept saves in the campaign detail', async () => {
    const uploaded = await uploadSaves(
      ...Array.from({ length: 12 }, (_, index) => `save-${index}`),
    );

    const detail = await new GamesQueryService(storage).getGameDetail(
      'campaign',
    );
    expect(detail.fileVersions.map((save) => save.id)).toEqual(
      uploaded
        .slice(2)
        .reverse()
        .map((save) => save.fileVersionId),
    );
  });
});
