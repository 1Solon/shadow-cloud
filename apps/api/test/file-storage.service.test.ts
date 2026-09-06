import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorageService } from '../src/games/file-storage.service';

const initialSaveDirectory = process.env.SHADOW_CLOUD_SAVE_DIR;
let temporaryRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'shadow-cloud-storage-'));
  process.env.SHADOW_CLOUD_SAVE_DIR = temporaryRoot;
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });

  if (initialSaveDirectory === undefined) {
    delete process.env.SHADOW_CLOUD_SAVE_DIR;
    return;
  }

  process.env.SHADOW_CLOUD_SAVE_DIR = initialSaveDirectory;
});

describe('FileStorageService', () => {
  it('isolates upload attempts under the campaign directory while preserving canonical names and independent downloads/removal', async () => {
    const storage = new FileStorageService();
    const input = {
      gameId: 'game-1',
      gameNumber: 1,
      turn: 4,
      seat: 2,
      playerName: 'Other Player',
      originalName: 'turn.se1',
    };
    const committed = await storage.storeFile({
      ...input,
      content: Buffer.from('committed'),
    });
    const [first, second] = await Promise.all([
      storage.stageUpload({ ...input, content: Buffer.from('first') }),
      storage.stageUpload({ ...input, content: Buffer.from('second') }),
    ]);

    expect(first.fileName).toBe('1-T4-S2-Other-Player.se1');
    expect(second.fileName).toBe('1-T4-S2-Other-Player.se1');
    expect(dirname(first.storagePath)).toBe(
      join(temporaryRoot, 'saves', 'game-1'),
    );
    expect(dirname(second.storagePath)).toBe(
      join(temporaryRoot, 'saves', 'game-1'),
    );
    expect(
      new Set([committed.storagePath, first.storagePath, second.storagePath])
        .size,
    ).toBe(3);
    expect(first.storagePath).toMatch(/\.se1$/);
    const download = await storage.openDownload(first.storagePath);
    expect(download.size).toBe(5);
    expect(await buffer(download.stream)).toEqual(Buffer.from('first'));

    await storage.removeFile(first.storagePath);
    await expect(access(first.storagePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(second.storagePath)).toEqual(Buffer.from('second'));
    expect(await readFile(committed.storagePath)).toEqual(
      Buffer.from('committed'),
    );
  });

  it('stages replacement saves at unique canonical .se1 paths without overwriting content', async () => {
    const storage = new FileStorageService();
    const first = await storage.stageReplacement({
      gameId: 'game-1',
      canonicalName: '1-T4-S2-Other.se1',
      content: Buffer.from('first'),
    });
    const second = await storage.stageReplacement({
      gameId: 'game-1',
      canonicalName: '1-T4-S2-Other.se1',
      content: Buffer.from('second'),
    });

    expect(first.storagePath).not.toBe(second.storagePath);
    expect(first.storagePath).toMatch(/1-T4-S2-Other-replacement-[\w-]+\.se1$/);
    await expect(readFile(first.storagePath)).resolves.toEqual(
      Buffer.from('first'),
    );
    await expect(readFile(second.storagePath)).resolves.toEqual(
      Buffer.from('second'),
    );
  });

  it('removes a staged replacement file', async () => {
    const storage = new FileStorageService();
    const { storagePath } = await storage.stageReplacement({
      gameId: 'game-1',
      canonicalName: '1-T4-S2-Other.se1',
      content: Buffer.from('replacement'),
    });

    await storage.removeFileOrThrow(storagePath);

    await expect(access(storagePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('propagates errors when strict removal cannot delete a file', async () => {
    const storage = new FileStorageService();

    await expect(
      storage.removeFileOrThrow(join(temporaryRoot, 'missing.se1')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps best-effort removal for existing callers', async () => {
    const storage = new FileStorageService();

    await expect(
      storage.removeFile(join(temporaryRoot, 'missing.se1')),
    ).resolves.toBeUndefined();
  });
});
