import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGames } from './shadowCloudApi';

describe('Shadow-Cloud API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the configured API base URL when the API cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(listGames('desktop-token')).rejects.toThrow(
      'Could not reach Shadow-Cloud API at http://localhost:3001.',
    );
  });
});
