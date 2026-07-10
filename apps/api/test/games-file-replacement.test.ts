import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    FILE_REPLACED: 'FILE_REPLACED',
  },
  prisma: prismaMock,
}));

const { GamesFileService } =
  await import('../src/games/services/games-file.service');

const replacementFile = {
  buffer: Buffer.from([4, 5, 6]),
  originalname: 'corrected.se1',
  size: 3,
};

function createFileVersion() {
  return {
    id: 'version-7',
    uploadedById: 'owner-1',
    storagePath: '/saves/game-1/original.se1',
    originalName: 'original.se1',
    versionNumber: 7,
    clientOriginalName: 'original-client.se1',
    clientFileSize: 2,
    contentHash: 'previous-hash',
  };
}

function createGame(fileVersions = [createFileVersion()]) {
  return {
    id: 'game-1',
    gameNumber: 42,
    slug: 'test-game',
    name: 'Test Game',
    discordThreadId: 'thread-1',
    fileVersions,
  };
}

function createService() {
  const authService = {
    isUserShadowOverride: vi.fn(),
  };
  const fileStorage = {
    stageReplacement: vi.fn(),
    removeFileOrThrow: vi.fn(),
  };
  const botNotifications = {
    enqueueSaveReplaced: vi.fn(),
  };

  return {
    service: new GamesFileService(
      authService as never,
      fileStorage as never,
      botNotifications as never,
    ),
    authService,
    fileStorage,
    botNotifications,
  };
}

describe('GamesFileService replaceSave', () => {
  let warning: ReturnType<typeof vi.spyOn>;
  let transaction: {
    fileVersion: {
      updateMany: ReturnType<typeof vi.fn>;
      create?: undefined;
    };
    auditEvent: {
      create: ReturnType<typeof vi.fn>;
    };
    notificationDelivery: {
      create: ReturnType<typeof vi.fn>;
    };
    turnState?: undefined;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    warning = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    transaction = {
      fileVersion: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
      notificationDelivery: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    prismaMock.game.findFirst.mockResolvedValue(createGame());
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      displayName: 'Original Uploader',
      identities: [
        {
          provider: 'discord',
          providerId: 'discord-owner-1',
        },
      ],
    });
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(transaction),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows the original uploader to replace a historical save without active membership', async () => {
    const { service, authService, fileStorage, botNotifications } =
      createService();
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });

    const result = await service.replaceSave(
      '42',
      'version-7',
      'owner-1',
      replacementFile,
      {},
    );

    const update = transaction.fileVersion.updateMany.mock.calls[0][0];
    const replacedAt = update.data.replacedAt as Date;

    expect(authService.isUserShadowOverride).not.toHaveBeenCalled();
    expect(fileStorage.stageReplacement).toHaveBeenCalledWith({
      gameId: 'game-1',
      canonicalName: 'original.se1',
      content: replacementFile.buffer,
    });
    expect(transaction.fileVersion.create).toBeUndefined();
    expect(transaction.turnState).toBeUndefined();
    expect(transaction.fileVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'version-7',
        gameId: 'game-1',
        storagePath: '/saves/game-1/original.se1',
      },
      data: expect.objectContaining({
        storagePath: '/saves/game-1/replacement.se1',
        clientOriginalName: 'corrected.se1',
        clientFileSize: replacementFile.buffer.byteLength,
        contentHash: null,
        replacedById: 'owner-1',
      }),
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: {
        gameId: 'game-1',
        actorId: 'owner-1',
        eventType: 'FILE_REPLACED',
        payload: JSON.stringify({
          fileVersionId: 'version-7',
          versionNumber: 7,
          originalName: 'original.se1',
          replacementActor: {
            id: 'owner-1',
            displayName: 'Original Uploader',
          },
          previous: {
            storagePath: '/saves/game-1/original.se1',
            clientOriginalName: 'original-client.se1',
            clientFileSize: 2,
            contentHash: 'previous-hash',
          },
          next: {
            storagePath: '/saves/game-1/replacement.se1',
            clientOriginalName: 'corrected.se1',
            clientFileSize: replacementFile.buffer.byteLength,
            contentHash: null,
          },
        }),
      },
    });
    expect(botNotifications.enqueueSaveReplaced).toHaveBeenCalledWith(
      transaction,
      {
        game: {
          id: 'game-1',
          gameNumber: 42,
          slug: 'test-game',
          name: 'Test Game',
          discordThreadId: 'thread-1',
        },
        replacement: {
          versionId: 'version-7',
          versionNumber: 7,
          originalName: 'original.se1',
          replacedAt: replacedAt.toISOString(),
          replacedBy: {
            id: 'owner-1',
            displayName: 'Original Uploader',
            discordId: 'discord-owner-1',
          },
        },
      },
    );
    expect(fileStorage.removeFileOrThrow).toHaveBeenCalledWith(
      '/saves/game-1/original.se1',
    );
    expect(result).toEqual({
      fileVersionId: 'version-7',
      versionNumber: 7,
      originalName: 'original.se1',
      replacedAt: replacedAt.toISOString(),
      replacedByDisplayName: 'Original Uploader',
    });
  });

  it('rejects a request without an authenticated user id', async () => {
    const { service } = createService();

    await expect(
      service.replaceSave('42', 'version-7', undefined, replacementFile),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prismaMock.game.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a replacement that fails save-file validation', async () => {
    const { service } = createService();

    await expect(
      service.replaceSave('42', 'version-7', 'owner-1', {
        ...replacementFile,
        originalname: 'corrected.txt',
      }),
    ).rejects.toMatchObject({
      status: 400,
    });

    expect(prismaMock.game.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a missing game', async () => {
    const { service } = createService();
    prismaMock.game.findFirst.mockResolvedValue(null);

    await expect(
      service.replaceSave('missing', 'version-7', 'owner-1', replacementFile),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a file version that does not belong to the game', async () => {
    const { service } = createService();
    prismaMock.game.findFirst.mockResolvedValue(createGame([]));

    await expect(
      service.replaceSave('42', 'other-version', 'owner-1', replacementFile),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a non-owner when the local override gate is disabled', async () => {
    const { service, authService } = createService();

    await expect(
      service.replaceSave('42', 'version-7', 'organizer-1', replacementFile, {
        shadowOverrideEnabled: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(authService.isUserShadowOverride).not.toHaveBeenCalled();
  });

  it('rejects a non-owner whose shadow role is not confirmed', async () => {
    const { service, authService } = createService();
    authService.isUserShadowOverride.mockResolvedValue(false);

    await expect(
      service.replaceSave('42', 'version-7', 'shadow-1', replacementFile, {
        shadowOverrideEnabled: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(authService.isUserShadowOverride).toHaveBeenCalledWith('shadow-1');
  });

  it('allows a non-owner only after the local override gate and shadow role confirmation', async () => {
    const { service, authService, fileStorage } = createService();
    authService.isUserShadowOverride.mockResolvedValue(true);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'shadow-1',
      displayName: 'Shadow Admin',
      identities: [],
    });
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });

    await service.replaceSave('42', 'version-7', 'shadow-1', replacementFile, {
      shadowOverrideEnabled: true,
    });

    expect(authService.isUserShadowOverride).toHaveBeenCalledWith('shadow-1');
    expect(transaction.fileVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          replacedById: 'shadow-1',
        }),
      }),
    );
    expect(transaction.fileVersion.create).toBeUndefined();
    expect(transaction.turnState).toBeUndefined();
  });

  it('rejects an authenticated actor that no longer exists', async () => {
    const { service, fileStorage } = createService();
    prismaMock.user.findUnique.mockResolvedValue(null);
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });

    await expect(
      service.replaceSave('42', 'version-7', 'owner-1', replacementFile),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(fileStorage.stageReplacement).not.toHaveBeenCalled();
  });

  it('removes the staged replacement and rejects when the compare-and-swap loses', async () => {
    const { service, fileStorage } = createService();
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });
    transaction.fileVersion.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.replaceSave('42', 'version-7', 'owner-1', replacementFile),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(fileStorage.removeFileOrThrow).toHaveBeenCalledWith(
      '/saves/game-1/replacement.se1',
    );
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it('removes only the staged replacement when the transaction fails', async () => {
    const { service, fileStorage } = createService();
    const transactionError = new Error('transaction failed');
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });
    prismaMock.$transaction.mockRejectedValue(transactionError);

    await expect(
      service.replaceSave('42', 'version-7', 'owner-1', replacementFile),
    ).rejects.toBe(transactionError);

    expect(fileStorage.removeFileOrThrow).toHaveBeenCalledWith(
      '/saves/game-1/replacement.se1',
    );
  });

  it('preserves the transaction error when staged-file rollback cleanup also fails', async () => {
    const { service, fileStorage } = createService();
    const transactionError = new Error('transaction failed');
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });
    fileStorage.removeFileOrThrow.mockRejectedValue(
      new Error('cleanup failed'),
    );
    prismaMock.$transaction.mockRejectedValue(transactionError);

    await expect(
      service.replaceSave('42', 'version-7', 'owner-1', replacementFile),
    ).rejects.toBe(transactionError);
  });

  it('keeps the replacement successful when old-file cleanup fails after commit', async () => {
    const { service, fileStorage } = createService();
    fileStorage.stageReplacement.mockResolvedValue({
      storagePath: '/saves/game-1/replacement.se1',
    });
    fileStorage.removeFileOrThrow.mockRejectedValue(
      new Error('cleanup failed'),
    );

    await expect(
      service.replaceSave('42', 'version-7', 'owner-1', replacementFile),
    ).resolves.toMatchObject({
      fileVersionId: 'version-7',
      replacedByDisplayName: 'Original Uploader',
    });
    expect(fileStorage.removeFileOrThrow).toHaveBeenCalledWith(
      '/saves/game-1/original.se1',
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Unable to remove previous save'),
      expect.any(String),
    );
    expect(transaction.fileVersion.create).toBeUndefined();
    expect(transaction.turnState).toBeUndefined();
  });
});
