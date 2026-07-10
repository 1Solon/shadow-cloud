import { describe, expect, it } from 'vitest';
import { buildGameDetailFileVersionPayload } from '../src/games/support/game-detail-file-version-payload';

describe('buildGameDetailFileVersionPayload', () => {
  it('includes uploadedById for desktop sync ownership checks', () => {
    const payload = buildGameDetailFileVersionPayload({
      id: 'file-version-1',
      originalName: 'G0001_turn_7.se1',
      uploadedAt: new Date('2026-05-03T10:20:30.000Z'),
      uploadedById: 'user-1',
      contentHash: 'sha256:abc123',
      idempotencyKey: 'game-1:upload:sha256:abc123',
      replacedAt: new Date('2026-07-10T14:30:00.000Z'),
      uploadedBy: {
        displayName: 'Solon',
      },
      replacedBy: {
        displayName: 'Vertëks',
      },
    });

    expect(payload).toEqual({
      id: 'file-version-1',
      originalName: 'G0001_turn_7.se1',
      uploadedAt: '2026-05-03T10:20:30.000Z',
      uploadedById: 'user-1',
      uploadedByDisplayName: 'Solon',
      contentHash: 'sha256:abc123',
      idempotencyKey: 'game-1:upload:sha256:abc123',
      replacedAt: '2026-07-10T14:30:00.000Z',
      replacedByDisplayName: 'Vertëks',
    });
  });

  it('includes null replacement metadata when a file has not been replaced', () => {
    expect(
      buildGameDetailFileVersionPayload({
        id: 'file-version-2',
        originalName: '1-T4-S2-Other.se1',
        uploadedAt: new Date('2026-07-10T14:00:00.000Z'),
        uploadedById: 'user-2',
        contentHash: null,
        idempotencyKey: null,
        uploadedBy: { displayName: 'Other' },
        replacedAt: null,
        replacedBy: null,
      }),
    ).toMatchObject({
      replacedAt: null,
      replacedByDisplayName: null,
    });
  });
});
