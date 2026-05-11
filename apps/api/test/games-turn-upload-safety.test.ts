import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findFirst: vi.fn(),
  },
  fileVersion: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    FILE_UPLOADED: 'FILE_UPLOADED',
    TURN_ADVANCED: 'TURN_ADVANCED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
    PLAYER: 'PLAYER',
  },
  prisma: prismaMock,
}));

const { GamesTurnService } = await import(
  '../src/games/services/games-turn.service'
);

function createGame(override = {}) {
  const players = [
    {
      id: 'entry-1',
      userId: 'user-1',
      user: {
        id: 'user-1',
        displayName: 'Solon',
        identities: [],
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
        identities: [],
      },
      role: 'PLAYER',
      turnOrder: 2,
    },
  ];

  const game = {
    id: 'game-1',
    gameNumber: 1,
    slug: 'ashes',
    name: 'Ashes',
    discordThreadId: null,
    organizerId: 'user-1',
    organizer: {
      identities: [],
    },
    players,
    turnState: {
      activePlayerId: 'user-1',
      activePlayerEntryId: 'entry-1',
      roundNumber: 4,
    },
  };

  return {
    ...game,
    ...override,
  };
}

function createService() {
  const fileStorage = {
    storeFile: vi.fn(async () => ({
      storagePath: '/saves/game-1/turn.se1',
      fileName: '1-T4-S2-Other.se1',
    })),
    removeFile: vi.fn(async () => undefined),
  };
  const botNotifications = {
    notifySaveUploaded: vi.fn(async () => undefined),
  };

  return {
    service: new GamesTurnService(
      {} as never,
      fileStorage as never,
      botNotifications as never,
    ),
    fileStorage,
    botNotifications,
  };
}

describe('GamesTurnService upload safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.game.findFirst.mockResolvedValue(createGame());
  });

  it('returns the existing upload result for a repeated idempotency key without advancing turn again', async () => {
    prismaMock.fileVersion.findFirst.mockResolvedValue({
      id: 'file-version-1',
      originalName: '1-T4-S2-Other.se1',
      versionNumber: 7,
      uploadedAt: new Date('2026-05-03T10:00:00.000Z'),
    });
    const { service, fileStorage, botNotifications } = createService();

    const result = await service.uploadSave(
      '1',
      'user-1',
      {
        originalname: 'turn.se1',
        buffer: Buffer.from([1, 2, 3]),
      } as never,
      {
        contentHash: 'sha256:abc',
        idempotencyKey: 'game-1:user-1:abc',
        expectedActivePlayerEntryId: 'entry-1',
        expectedActivePlayerUserId: 'user-1',
        expectedRoundNumber: 4,
        expectedLatestFileVersionId: null,
      },
    );

    expect(result).toMatchObject({
      fileVersionId: 'file-version-1',
      versionNumber: 7,
      originalName: '1-T4-S2-Other.se1',
      idempotentReplay: true,
    });
    expect(fileStorage.storeFile).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(botNotifications.notifySaveUploaded).not.toHaveBeenCalled();
  });

  it('rejects stale expected turn state before storing the file', async () => {
    prismaMock.fileVersion.findFirst.mockResolvedValue(null);
    const { service, fileStorage } = createService();

    await expect(
      service.uploadSave(
        '1',
        'user-1',
        {
          originalname: 'turn.se1',
          buffer: Buffer.from([1, 2, 3]),
        } as never,
        {
          contentHash: 'sha256:abc',
          idempotencyKey: 'game-1:user-1:abc',
          expectedActivePlayerEntryId: 'entry-1',
          expectedActivePlayerUserId: 'user-1',
          expectedRoundNumber: 3,
          expectedLatestFileVersionId: null,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fileStorage.storeFile).not.toHaveBeenCalled();
  });

  it('stores a wraparound upload with the incremented round for seat one', async () => {
    const game = createGame({
      turnState: {
        activePlayerId: 'user-2',
        activePlayerEntryId: 'entry-2',
        roundNumber: 4,
      },
    });
    prismaMock.game.findFirst.mockResolvedValue(game);
    prismaMock.fileVersion.findFirst.mockResolvedValue(null);
    const transaction = {
      fileVersion: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({
          id: 'file-version-8',
          originalName: '1-T5-S1-Solon.se1',
          uploadedAt: new Date('2026-05-03T10:00:00.000Z'),
        })),
      },
      auditEvent: {
        create: vi.fn(async () => ({})),
      },
      turnState: {
        update: vi.fn(async () => ({
          roundNumber: 5,
        })),
      },
    };
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
    const { service, fileStorage } = createService();

    await service.uploadSave(
      '1',
      'user-2',
      {
        originalname: 'turn.se1',
        buffer: Buffer.from([1, 2, 3]),
      } as never,
    );

    expect(fileStorage.storeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: 5,
        seat: 1,
        playerName: 'Solon',
      }),
    );
  });
});
