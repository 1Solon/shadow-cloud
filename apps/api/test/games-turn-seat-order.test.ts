import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

// This transport seam must not use a production database singleton.
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  prisma: {},
}));
const { GamesTurnService } =
  await import('../src/games/services/games-turn.service');

describe('GamesTurnService Seat Order compatibility', () => {
  it('passes the existing request unchanged to the mutation owner and returns its response', async () => {
    const input = {
      baseline: { campaignId: 'game-1', revision: 0 },
      seatEntryIds: ['seat-2', 'seat-1'],
      clearedSeatEntryIds: ['seat-1'],
      removedSeatEntryIds: ['seat-open'],
      activePlayerEntryId: 'seat-2',
    };
    const response = {
      gameId: 'game-1',
      slug: 'ashes',
      name: 'Ashes',
      activePlayerEntryId: 'seat-2',
      players: [
        { seatEntryId: 'seat-2', turnOrder: 1, displayName: 'Other' },
        { seatEntryId: 'seat-1', turnOrder: 2, displayName: null },
      ],
    };
    const mutations = { reorderSeatOrder: vi.fn(async () => response) };
    const service = new GamesTurnService(mutations as never);
    expect(await service.reorderSeatOrder('1', 'user-1', input)).toBe(response);
    expect(mutations.reorderSeatOrder).toHaveBeenCalledExactlyOnceWith(
      '1',
      'user-1',
      input,
    );
  });

  it('preserves mutation errors without silently retrying the intent', async () => {
    const conflict = new ConflictException('The roster changed.');
    const mutations = {
      reorderSeatOrder: vi.fn(async () => {
        throw conflict;
      }),
    };
    const service = new GamesTurnService(mutations as never);
    await expect(
      service.reorderSeatOrder('1', 'user-1', {
        seatEntryIds: ['seat-1'],
        baseline: { campaignId: 'game-1', revision: 0 },
      }),
    ).rejects.toBe(conflict);
    expect(mutations.reorderSeatOrder).toHaveBeenCalledTimes(1);
  });
});
