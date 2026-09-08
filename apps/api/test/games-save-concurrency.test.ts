import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSqliteFixture } from './support/sqlite-fixture';
import { FileStorageService } from '../src/games/file-storage.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';

const database = vi.hoisted(() => ({ current: null as PrismaClient | null }));
const disk = vi.hoisted(() => ({ failWrite: false, failDelete: false }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    unlink: async (...args: Parameters<typeof fs.unlink>) => {
      if (disk.failDelete) throw new Error('injected deletion failure');
      return fs.unlink(...args);
    },
    writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.writeFile(...args);
      if (disk.failWrite) throw new Error('injected partial write failure');
    },
  };
});
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  prisma: new Proxy(
    {},
    { get: (_, key) => Reflect.get(database.current!, key) },
  ),
}));
import { GamesFileService } from '../src/games/services/games-file.service';
import { GamesQueryService } from '../src/games/services/games-query.service';

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let directory: string;
let storage: FileStorageService;
let uploads: TurnMutationsService;
let replacements: GamesFileService;
let duringStage: () => Promise<void>;
let override: boolean;
const file = (text: string) => ({
  originalname: 'turn.se1',
  buffer: Buffer.from(text),
  size: text.length,
});

beforeEach(async () => {
  fixture = await createSqliteFixture();
  database.current = fixture.db;
  directory = await mkdtemp(join(tmpdir(), 'save-concurrency-'));
  const previous = process.env.SHADOW_CLOUD_SAVE_DIR;
  process.env.SHADOW_CLOUD_SAVE_DIR = directory;
  storage = new FileStorageService();
  if (previous === undefined) delete process.env.SHADOW_CLOUD_SAVE_DIR;
  else process.env.SHADOW_CLOUD_SAVE_DIR = previous;
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
  duringStage = async () => {};
  override = false;
  disk.failWrite = false;
  disk.failDelete = false;
  const stagedStorage = Object.create(storage) as FileStorageService;
  stagedStorage.stageUpload = async (input) => {
    const result = await storage.stageUpload(input);
    await duringStage();
    return result;
  };
  stagedStorage.stageReplacement = async (input) => {
    const result = await storage.stageReplacement(input);
    await duringStage();
    return result;
  };
  uploads = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    fileStorage: stagedStorage,
  });
  replacements = new GamesFileService(
    { isUserShadowOverride: async () => override } as never,
    stagedStorage,
    { enqueueSaveReplaced: async () => {} } as never,
  );
});

afterEach(async () => {
  vi.useRealTimers();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('stores a server hash rather than trusting an upload hash', async () => {
  await uploads.uploadSave('campaign', 'player', file('abc'), {
    contentHash: 'forged',
  });
  const detail = await new GamesQueryService(storage).getGameDetail('campaign');
  expect(detail.fileVersions[0].contentHash).toBe(
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

it.each(['upload', 'replacement'])(
  'rejects a competing %s after a replacement commits, keeping its bytes and turn state',
  async (operation) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    const query = new GamesQueryService(storage);
    const before = await query.getGameDetail('campaign');
    duringStage = async () => {
      duringStage = async () => {};
      await replacements.replaceSave(
        'campaign',
        initial.fileVersionId,
        'player',
        file('abc'),
      );
    };
    await expect(
      operation === 'upload'
        ? uploads.uploadSave('campaign', 'player', file('loser'))
        : replacements.replaceSave(
            'campaign',
            initial.fileVersionId,
            'player',
            file('loser'),
          ),
    ).rejects.toBeInstanceOf(ConflictException);
    const after = await query.getGameDetail('campaign');
    expect(after.openTurn).toEqual(before.openTurn);
    expect(after.roundNumber).toBe(before.roundNumber);
    expect(after.fileVersions).toHaveLength(1);
    expect(after.fileVersions[0]).toMatchObject({
      id: initial.fileVersionId,
      originalName: initial.originalName,
      contentHash:
        'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    const download = await query.downloadSave(
      'campaign',
      initial.fileVersionId,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('abc');
    expect((await readdir(join(directory, 'saves', 'campaign'))).length).toBe(
      1,
    );
  },
);

it('rejects a stale client baseline even when file identity and bytes are unchanged', async () => {
  const initial = await uploads.uploadSave('campaign', 'player', file('abc'));
  const query = new GamesQueryService(storage);
  const before = await query.getGameDetail('campaign');
  await replacements.replaceSave(
    'campaign',
    initial.fileVersionId,
    'player',
    file('abc'),
  );
  for (const operation of [
    () =>
      uploads.uploadSave('campaign', 'player', file('loser'), {
        expectedSaveBaseline: before.saveBaseline,
      }),
    () =>
      replacements.replaceSave(
        'campaign',
        initial.fileVersionId,
        'player',
        file('loser'),
        { expectedSaveBaseline: before.saveBaseline },
      ),
  ])
    await expect(operation()).rejects.toBeInstanceOf(ConflictException);
  const after = await query.getGameDetail('campaign');
  expect(after.saveBaseline).not.toBe(before.saveBaseline);
  expect(after.fileVersions[0].contentRevision).toBe(1);
  expect(before.fileVersions[0].contentRevision).toBe(0);
  expect(after.seatOrderBaseline).toEqual(before.seatOrderBaseline);
});

it('revalidates explicit override authorization after staging', async () => {
  const initial = await uploads.uploadSave(
    'campaign',
    'player',
    file('original'),
  );
  await fixture.db.user.create({
    data: {
      id: 'override',
      email: 'override@example.com',
      displayName: 'Override',
    },
  });
  override = true;
  duringStage = async () => {
    override = false;
  };
  await expect(
    replacements.replaceSave(
      'campaign',
      initial.fileVersionId,
      'override',
      file('loser'),
      { shadowOverrideEnabled: true },
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  const download = await new GamesQueryService(storage).downloadSave(
    'campaign',
    initial.fileVersionId,
  );
  const chunks = [];
  for await (const chunk of download.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('original');
  expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
});

it.each(['upload', 'transfer'])(
  'rejects a replacement if %s commits while it stages',
  async (winner) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    duringStage = async () => {
      duringStage = async () => {};
      if (winner === 'upload')
        await uploads.uploadSave('campaign', 'player', file('winner'));
      else {
        await fixture.db.user.create({
          data: {
            id: 'successor',
            email: 'successor@example.com',
            displayName: 'Successor',
          },
        });
        await fixture.db.gamePlayer.create({
          data: {
            id: 'seat-2',
            gameId: 'campaign',
            userId: 'successor',
            turnOrder: 2,
          },
        });
        await uploads.transferHost('campaign', 'player', {
          targetPlayerEntryId: 'seat-2',
        });
      }
    };
    await expect(
      replacements.replaceSave(
        'campaign',
        initial.fileVersionId,
        'player',
        file('loser'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  },
);

it('rolls back a failed replacement commit without changing downloaded bytes or its baseline', async () => {
  const initial = await uploads.uploadSave(
    'campaign',
    'player',
    file('original'),
  );
  const query = new GamesQueryService(storage);
  const before = await query.getGameDetail('campaign');
  await fixture.db.$executeRawUnsafe(
    "CREATE TRIGGER fail_replace AFTER INSERT ON AuditEvent WHEN NEW.eventType = 'FILE_REPLACED' BEGIN SELECT RAISE(ABORT, 'injected commit failure'); END",
  );
  await expect(
    replacements.replaceSave(
      'campaign',
      initial.fileVersionId,
      'player',
      file('loser'),
    ),
  ).rejects.toThrow();
  expect(await query.getGameDetail('campaign')).toEqual(before);
  const download = await query.downloadSave('campaign', initial.fileVersionId);
  const chunks = [];
  for await (const chunk of download.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('original');
  expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
});

it.each(['upload', 'replacement'])(
  'retries failed staging deletion after a failed %s commit without deleting canonical bytes',
  async (operation) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    const query = new GamesQueryService(storage);
    const before = await query.getGameDetail('campaign');
    await fixture.db.$executeRawUnsafe(
      "CREATE TRIGGER fail_publication AFTER INSERT ON AuditEvent WHEN NEW.eventType IN ('FILE_UPLOADED', 'FILE_REPLACED') BEGIN SELECT RAISE(ABORT, 'injected commit failure'); END",
    );
    disk.failDelete = true;
    await expect(
      operation === 'upload'
        ? uploads.uploadSave('campaign', 'player', file('loser'))
        : replacements.replaceSave(
            'campaign',
            initial.fileVersionId,
            'player',
            file('loser'),
          ),
    ).rejects.toThrow();
    expect(await query.getGameDetail('campaign')).toEqual(before);
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(2);
    disk.failDelete = false;
    await replacements.cleanupRecovery();
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
    const download = await query.downloadSave(
      'campaign',
      initial.fileVersionId,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('original');
  },
);

it.each(['upload', 'replacement'])(
  'cleans a partial staging write for %s without changing canonical state',
  async (operation) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    const query = new GamesQueryService(storage);
    const before = await query.getGameDetail('campaign');
    disk.failWrite = true;
    await expect(
      operation === 'upload'
        ? uploads.uploadSave('campaign', 'player', file('loser'))
        : replacements.replaceSave(
            'campaign',
            initial.fileVersionId,
            'player',
            file('loser'),
          ),
    ).rejects.toThrow('injected partial write failure');
    expect(await query.getGameDetail('campaign')).toEqual(before);
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
  },
);

it.each(['upload', 'replacement'])(
  'retains a partial %s write for retry when deletion fails',
  async (operation) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    const query = new GamesQueryService(storage);
    const before = await query.getGameDetail('campaign');
    disk.failWrite = true;
    disk.failDelete = true;
    await expect(
      operation === 'upload'
        ? uploads.uploadSave('campaign', 'player', file('partial'))
        : replacements.replaceSave(
            'campaign',
            initial.fileVersionId,
            'player',
            file('partial'),
          ),
    ).rejects.toThrow('injected partial write failure');
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(2);
    disk.failDelete = false;
    await replacements.cleanupRecovery();
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
    expect(await query.getGameDetail('campaign')).toEqual(before);
  },
);

it.each(['upload', 'replacement'])(
  'does not write %s bytes when durable staging registration fails',
  async (operation) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    await fixture.db.$executeRawUnsafe(
      "CREATE TRIGGER fail_lease BEFORE INSERT ON SaveCleanup BEGIN SELECT RAISE(ABORT, 'lease unavailable'); END",
    );
    await expect(
      operation === 'upload'
        ? uploads.uploadSave('campaign', 'player', file('untracked'))
        : replacements.replaceSave(
            'campaign',
            initial.fileVersionId,
            'player',
            file('untracked'),
          ),
    ).rejects.toThrow();
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
  },
);

it.each(['upload', 'replacement'])(
  'reclaims an abandoned %s lease on another connection and prevents late publication',
  async (operation) => {
    const initial = await uploads.uploadSave(
      'campaign',
      'player',
      file('original'),
    );
    const query = new GamesQueryService(storage);
    const before = await query.getGameDetail('campaign');
    const staged = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    duringStage = async () => {
      staged.resolve();
      await resume.promise;
    };
    const pending = (
      operation === 'upload'
        ? uploads.uploadSave('campaign', 'player', file('abandoned'))
        : replacements.replaceSave(
            'campaign',
            initial.fileVersionId,
            'player',
            file('abandoned'),
          )
    ).then(
      () => 'published',
      () => 'rejected',
    );
    await staged.promise;
    try {
      // No operation catch/finally has run: only the durable lease can find it.
      database.current = fixture.connect();
      await replacements.cleanupRecovery();
      expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(
        2,
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 3_600_001);
      await replacements.cleanupRecovery();
      expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(
        1,
      );
    } finally {
      resume.resolve();
    }
    expect(await pending).toBe('rejected');
    expect(await query.getGameDetail('campaign')).toEqual(before);
    const download = await query.downloadSave(
      'campaign',
      initial.fileVersionId,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('original');
  },
);

it('retries old-file deletion after successful replacement and preserves the published file beyond lease expiry', async () => {
  const initial = await uploads.uploadSave(
    'campaign',
    'player',
    file('original'),
  );
  disk.failDelete = true;
  await replacements.replaceSave(
    'campaign',
    initial.fileVersionId,
    'player',
    file('published'),
  );
  expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(2);
  disk.failDelete = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 3_600_001);
  await replacements.cleanupRecovery();
  expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
  const download = await new GamesQueryService(storage).downloadSave(
    'campaign',
    initial.fileVersionId,
  );
  const chunks = [];
  for await (const chunk of download.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('published');
});

it('publishes ordinary replacement without requiring storage reads', async () => {
  const initial = await uploads.uploadSave(
    'campaign',
    'player',
    file('original'),
  );
  const open = vi
    .spyOn(storage, 'openDownload')
    .mockRejectedValue(new Error('reads unavailable'));
  try {
    await expect(
      replacements.replaceSave(
        'campaign',
        initial.fileVersionId,
        'player',
        file('published'),
      ),
    ).resolves.toMatchObject({ contentRevision: 1 });
  } finally {
    open.mockRestore();
  }
  const download = await new GamesQueryService(storage).downloadSave(
    'campaign',
    initial.fileVersionId,
  );
  const chunks = [];
  for await (const chunk of download.stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('published');
});

it('allows only one simultaneous save mutation from the same client baseline across SQLite connections', async () => {
  const initial = await uploads.uploadSave(
    'campaign',
    'player',
    file('original'),
  );
  const before = await new GamesQueryService(storage).getGameDetail('campaign');
  const otherUploads = new TurnMutationsService(
    fixture.connect(),
    new TurnRecordsService(),
    { fileStorage: storage },
  );
  const results = await Promise.allSettled([
    otherUploads.uploadSave('campaign', 'player', file('next turn'), {
      expectedSaveBaseline: before.saveBaseline,
    }),
    replacements.replaceSave(
      'campaign',
      initial.fileVersionId,
      'player',
      file('corrected'),
      { expectedSaveBaseline: before.saveBaseline },
    ),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected');
  expect(rejected?.status).toBe('rejected');
  if (rejected?.status === 'rejected') {
    // A SQLite lock timeout is not proof of a stale baseline. Either failure
    // must leave the competing publication as the only successful mutation.
    if (!(rejected.reason instanceof ConflictException))
      expect(rejected.reason).toMatchObject({ code: 'P1008' });
  }
});

it('preserves historical original-uploader permission without granting the new Overlord general replacement rights', async () => {
  const initial = await uploads.uploadSave(
    'campaign',
    'player',
    file('original'),
  );
  await uploads.uploadSave('campaign', 'player', file('next turn'));
  await fixture.db.user.create({
    data: {
      id: 'successor',
      email: 'successor@example.com',
      displayName: 'Successor',
    },
  });
  await fixture.db.gamePlayer.create({
    data: {
      id: 'seat-2',
      gameId: 'campaign',
      userId: 'successor',
      turnOrder: 2,
    },
  });
  await uploads.transferHost('campaign', 'player', {
    targetPlayerEntryId: 'seat-2',
  });
  await expect(
    replacements.replaceSave(
      'campaign',
      initial.fileVersionId,
      'successor',
      file('forbidden'),
    ),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await fixture.db.gamePlayer.update({
    where: { id: 'seat' },
    data: { userId: null },
  });
  await expect(
    replacements.replaceSave(
      'campaign',
      initial.fileVersionId,
      'player',
      file('corrected'),
    ),
  ).resolves.toMatchObject({
    fileVersionId: initial.fileVersionId,
    versionNumber: 1,
  });
});
