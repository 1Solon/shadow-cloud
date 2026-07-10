import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
