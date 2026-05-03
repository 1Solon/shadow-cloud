import { describe, expect, it } from 'vitest';
import { buildGameDetailFileVersionPayload } from '../src/games/support/game-detail-file-version-payload';

describe('buildGameDetailFileVersionPayload', () => {
  it('includes uploadedById for desktop sync ownership checks', () => {
    const payload = buildGameDetailFileVersionPayload({
      id: 'file-version-1',
      originalName: 'G0001_turn_7.se1',
      uploadedAt: new Date('2026-05-03T10:20:30.000Z'),
      uploadedById: 'user-1',
      uploadedBy: {
        displayName: 'Solon',
      },
    });

    expect(payload).toEqual({
      id: 'file-version-1',
      originalName: 'G0001_turn_7.se1',
      uploadedAt: '2026-05-03T10:20:30.000Z',
      uploadedById: 'user-1',
      uploadedByDisplayName: 'Solon',
    });
  });
});
