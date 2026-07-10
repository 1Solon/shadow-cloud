import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findFirst: vi.fn(),
  },
  fileVersion: {
    findFirst: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  },
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    FILE_DOWNLOADED: 'FILE_DOWNLOADED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
    PLAYER: 'PLAYER',
  },
  prisma: prismaMock,
}));

const { GamesQueryService } =
  await import('../src/games/services/games-query.service');

function createGame() {
  return {
    id: 'game-1',
    gameNumber: 1,
    slug: 'test1',
    name: 'test1',
    retentionLimit: 5,
    players: [
      {
        id: 'entry-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          displayName: 'Solon',
        },
        role: 'ORGANIZER',
        turnOrder: 1,
      },
      {
        id: 'entry-2',
        userId: 'user-2',
        user: {
          id: 'user-2',
          displayName: 'Other',
        },
        role: 'PLAYER',
        turnOrder: 2,
      },
    ],
    turnState: {
      activePlayerId: 'user-1',
      activePlayerEntryId: 'entry-1',
      roundNumber: 11,
    },
  };
}

describe('GamesQueryService download filenames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.game.findFirst.mockResolvedValue(createGame());
    prismaMock.fileVersion.findFirst.mockResolvedValue({
      id: 'file-version-10',
      gameId: 'game-1',
      storagePath: '/saves/game-1/42-T4-S2-Other-replacement-id.se1',
      originalName: '42-T4-S2-Other.se1',
      versionNumber: 10,
    });
    prismaMock.auditEvent.create.mockResolvedValue({});
  });

  it('downloads a file version using its stored filename, not the current turn filename', async () => {
    const fileStorage = {
      openDownload: vi.fn(async () => ({
        size: 3,
        lastModified: new Date('2026-05-11T13:54:00.000Z'),
        stream: Readable.from(Buffer.from([1, 2, 3])),
      })),
      createDownloadFileName: vi.fn(() => '1-T11-S1-Solon.se1'),
    };
    const service = new GamesQueryService(fileStorage as never);

    const download = await service.downloadSave('1', 'file-version-10');

    expect(download.originalName).toBe('42-T4-S2-Other.se1');
    expect(fileStorage.openDownload).toHaveBeenCalledWith(
      '/saves/game-1/42-T4-S2-Other-replacement-id.se1',
    );
    expect(fileStorage.createDownloadFileName).not.toHaveBeenCalled();
  });
});
