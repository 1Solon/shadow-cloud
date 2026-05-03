import { describe, expect, it } from 'vitest';
import {
  buildCampaignDirectoryName,
  chooseNewestPendingSave,
  createFileFingerprint,
  getConflictSafeFileName,
  isShadowEmpireSave,
} from './sync-files';

describe('sync file helpers', () => {
  it('builds sanitized campaign directory names with a padded game number', () => {
    expect(buildCampaignDirectoryName(7, '  Ashes: <North>?  ')).toBe(
      'G0007 - Ashes North',
    );
  });

  it('recognizes only top-level .se1 saves case-insensitively', () => {
    expect(isShadowEmpireSave({ name: 'turn.SE1', isFile: true })).toBe(true);
    expect(isShadowEmpireSave({ name: 'notes.txt', isFile: true })).toBe(false);
    expect(isShadowEmpireSave({ name: 'nested.se1', isFile: false })).toBe(
      false,
    );
  });

  it('chooses the newest pending save and skips remembered fingerprints', async () => {
    const older = {
      name: 'older.se1',
      path: 'C:/saves/older.se1',
      modifiedAt: 10,
      size: 5,
      bytes: new Uint8Array([1, 2, 3]),
    };
    const newest = {
      name: 'newest.se1',
      path: 'C:/saves/newest.se1',
      modifiedAt: 20,
      size: 5,
      bytes: new Uint8Array([4, 5, 6]),
    };
    const fingerprint = await createFileFingerprint(newest);

    await expect(
      chooseNewestPendingSave([older, newest], new Set([fingerprint])),
    ).resolves.toMatchObject({
      file: {
        name: 'older.se1',
        path: 'C:/saves/older.se1',
      },
    });
  });

  it('suffixes downloads instead of overwriting local files', () => {
    const existing = new Set(['turn.se1', 'turn (1).se1']);

    expect(getConflictSafeFileName('turn.se1', existing)).toBe('turn (2).se1');
    expect(getConflictSafeFileName('fresh.se1', existing)).toBe('fresh.se1');
  });
});
