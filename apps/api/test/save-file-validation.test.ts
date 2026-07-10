import { afterEach, describe, expect, it } from 'vitest';
import {
  assertReplacementSaveFile,
  getMaxSaveFileSizeBytes,
} from '../src/games/support/save-file-validation';

const initialMaxSaveSize = process.env.SHADOW_CLOUD_MAX_SAVE_SIZE_BYTES;

function file(originalname: string, size: number) {
  return {
    originalname,
    buffer: Buffer.alloc(size),
    size,
  };
}

afterEach(() => {
  if (initialMaxSaveSize === undefined) {
    delete process.env.SHADOW_CLOUD_MAX_SAVE_SIZE_BYTES;
    return;
  }

  process.env.SHADOW_CLOUD_MAX_SAVE_SIZE_BYTES = initialMaxSaveSize;
});

describe('assertReplacementSaveFile', () => {
  it('accepts files with the exact .se1 extension', () => {
    expect(() => assertReplacementSaveFile(file('turn.se1', 3))).not.toThrow();
  });

  it('accepts files with a case-insensitive .se1 extension', () => {
    expect(() => assertReplacementSaveFile(file('turn.SE1', 3))).not.toThrow();
  });

  it('rejects disguised executable files', () => {
    expect(() => assertReplacementSaveFile(file('turn.se1.exe', 3))).toThrow(
      'Replacement files must use the .se1 extension.',
    );
  });

  it('rejects empty files', () => {
    expect(() => assertReplacementSaveFile(file('turn.se1', 0))).toThrow(
      'A replacement save file is required.',
    );
  });

  it('uses the configured maximum size limit', () => {
    process.env.SHADOW_CLOUD_MAX_SAVE_SIZE_BYTES = '4';

    expect(getMaxSaveFileSizeBytes()).toBe(4);
    expect(() => assertReplacementSaveFile(file('turn.se1', 5))).toThrow(
      'The replacement save exceeds 25 MB.',
    );
  });
});
