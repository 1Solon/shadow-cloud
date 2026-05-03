import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShadowCloudApiClient, listGames } from './shadowCloudApi';

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
      'Could not reach Shadow-Cloud API at https://shadow-cloud.solonsstuff.com.',
    );
  });

  it('uses a runtime API remote when one is supplied', async () => {
    const fetch = vi.fn(async () =>
      Response.json([
        {
          id: 'game-1',
          slug: 'ashes',
          gameNumber: 1,
          name: 'Ashes',
          roundNumber: 4,
          activePlayerUserId: 'user-1',
          activePlayerDisplayName: 'Solon',
          participantUserIds: ['user-1'],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetch);

    const client = createShadowCloudApiClient({
      apiBaseUrl: 'https://api.example.test/',
    });

    await client.listGames('desktop-token');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.test/v1/games',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer desktop-token',
        }),
      }),
    );
  });
});
