import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { SaveRejectedNotificationPayload } from '../src/games/bot-notifications.service';
import type { TurnMutationDependencies } from '../src/games/services/turn-mutations/dependencies';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

const hour = 60 * 60 * 1000;
const turnStart = new Date('2026-09-01T00:00:00Z');
const save = (content: string) => ({
  originalname: 'turn.se1',
  buffer: Buffer.from(content),
  size: content.length,
});

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;
let stored: Map<string, Buffer>;
let rejections: SaveRejectedNotificationPayload[];
let shadowLords: Set<string>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fixture = await createSqliteFixture();
  const { db } = fixture;
  for (const [id, displayName] of [
    ['user-1', 'Alpha'],
    ['user-2', 'Overlord'],
    ['user-3', 'Third'],
    ['user-4', 'Outsider'],
  ]) {
    await db.user.create({
      data: { id, displayName, email: `${id}@example.com` },
    });
  }
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'user-2',
      discordThreadId: 'thread-1',
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', turnOrder: 1 },
          { id: 'seat-2', userId: 'user-3', turnOrder: 2 },
          { id: 'seat-3', userId: 'user-2', turnOrder: 3, role: 'ORGANIZER' },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'user-1',
          activePlayerEntryId: 'seat-1',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn-1',
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          seatNumber: 1,
          playerDisplayName: 'Alpha',
          roundNumber: 4,
          startedAt: turnStart,
          nextReminderAt: new Date(turnStart.getTime() + 36 * hour),
        },
      },
    },
  });
  stored = new Map();
  rejections = [];
  shadowLords = new Set();
  let uploadAttempt = 0;
  const dependencies: TurnMutationDependencies = {
    authService: {
      isUserShadowOverride: async (userId) => shadowLords.has(userId),
    },
    fileStorage: {
      async stageUpload(input) {
        const fileName = `${input.gameNumber}-T${input.turn}-S${input.seat}-${input.playerName}.se1`;
        const storagePath = `/saves/${input.gameId}/upload-${++uploadAttempt}-${fileName}`;
        await input.prepare?.(storagePath);
        stored.set(storagePath, input.content);
        return { fileName, storagePath };
      },
      async removeFileOrThrow(path) {
        stored.delete(path);
      },
    },
    botNotifications: {
      notifySaveUploaded: async () => {},
      notifyGameInitialized: async () => {},
      notifyThreadRenamed: async () => {},
      enqueueSaveRejected: async (_transaction, payload) => {
        rejections.push(payload);
      },
    },
  };
  mutations = new TurnMutationsService(
    db,
    new TurnRecordsService(),
    dependencies,
  );
});

afterEach(async () => {
  vi.useRealTimers();
  await fixture?.close();
});

async function uploadAt(at: Date, userId: string, content: string) {
  vi.setSystemTime(at);
  return mutations.uploadSave('game-1', userId, save(content));
}

async function rejectAt(
  at: Date,
  userId: string,
  fileVersionId: string,
  options: { shadowOverrideEnabled?: boolean } = {},
) {
  vi.setSystemTime(at);
  return mutations.rejectSave(userId, {
    gameId: '1',
    fileVersionId,
    ...options,
  });
}

const at = (hours: number) => new Date(turnStart.getTime() + hours * hour);

describe('save rejection', () => {
  it('returns the turn to the uploader and resumes their clock without the time the save was held', async () => {
    const upload = await uploadAt(at(10), 'user-1', 'alpha turn');
    const storagePath = [...stored.keys()][0];

    expect(
      await rejectAt(at(15), 'user-3', upload.fileVersionId),
    ).toMatchObject({
      versionNumber: 1,
      roundNumber: 4,
      activePlayer: { id: 'seat-1', userId: 'user-1', displayName: 'Alpha' },
    });

    const { db } = fixture;
    expect(
      await db.turnState.findUnique({ where: { gameId: 'game-1' } }),
    ).toMatchObject({
      activePlayerId: 'user-1',
      activePlayerEntryId: 'seat-1',
      roundNumber: 4,
    });
    const records = await db.turnRecord.findMany({
      orderBy: { startedAt: 'asc' },
    });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: 'turn-1',
      startedAt: at(5),
      endedAt: null,
      completionReason: null,
      nextReminderAt: at(41),
    });
    expect(records[1]).toMatchObject({
      gamePlayerId: 'seat-2',
      startedAt: at(10),
      endedAt: at(15),
      completionReason: 'REJECTED',
      nextReminderAt: null,
    });
    expect(await db.fileVersion.findMany()).toEqual([]);
    expect(await db.rejectedSave.findMany()).toEqual([
      expect.objectContaining({
        id: upload.fileVersionId,
        versionNumber: 1,
        uploadedById: 'user-1',
        rejectedById: 'user-3',
        rejectedAt: at(15),
      }),
    ]);
    expect(stored.has(storagePath)).toBe(false);
    expect(await db.saveCleanup.findMany()).toEqual([]);
    expect(await db.game.findUnique({ where: { id: 'game-1' } })).toMatchObject(
      { turnRevision: 2, saveRevision: 2 },
    );
    expect(
      await db.auditEvent.findMany({ where: { eventType: 'SAVE_REJECTED' } }),
    ).toHaveLength(1);
    expect(rejections).toEqual([
      {
        game: {
          id: 'game-1',
          gameNumber: 1,
          slug: 'ashes',
          name: 'Ashes',
          discordThreadId: 'thread-1',
        },
        rejection: {
          versionNumber: 1,
          originalName: '1-T4-S2-Third.se1',
          rejectedAt: at(15).toISOString(),
          rejectedBy: { id: 'user-3', displayName: 'Third', discordId: null },
        },
        turn: {
          roundNumber: 4,
          activePlayer: {
            id: 'user-1',
            displayName: 'Alpha',
            discordId: null,
            turnOrder: 1,
          },
        },
      },
    ]);
  });

  it('rolls a save that finished the round back into the previous round', async () => {
    await uploadAt(at(1), 'user-1', 'alpha turn');
    await uploadAt(at(2), 'user-3', 'third turn');
    const upload = await uploadAt(at(3), 'user-2', 'overlord turn');
    expect(upload).toMatchObject({ roundNumber: 5, roundAdvanced: true });

    expect(await rejectAt(at(4), 'user-1', upload.fileVersionId)).toMatchObject(
      {
        roundNumber: 4,
        activePlayer: { id: 'seat-3', userId: 'user-2' },
      },
    );
    expect(
      await fixture.db.turnState.findUnique({ where: { gameId: 'game-1' } }),
    ).toMatchObject({ activePlayerEntryId: 'seat-3', roundNumber: 4 });
  });

  it.each([
    ['the uploader withdrawing', 'user-1', false],
    ['the Overlord', 'user-2', false],
    ['a Shadow Lord under Shadow Override', 'user-4', true],
  ])('lets %s reject the save', async (_label, userId, override) => {
    shadowLords.add('user-4');
    const upload = await uploadAt(at(1), 'user-1', 'alpha turn');

    await expect(
      rejectAt(at(2), userId, upload.fileVersionId, {
        shadowOverrideEnabled: override,
      }),
    ).resolves.toMatchObject({ activePlayer: { userId: 'user-1' } });
  });

  it('refuses anyone else, including a Shadow Lord without Shadow Override', async () => {
    shadowLords.add('user-4');
    const upload = await uploadAt(at(1), 'user-1', 'alpha turn');

    await expect(
      rejectAt(at(2), 'user-4', upload.fileVersionId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await fixture.db.fileVersion.count()).toBe(1);
  });

  it('only rejects the latest save during the turn it started', async () => {
    const first = await uploadAt(at(1), 'user-1', 'alpha turn');
    const second = await uploadAt(at(2), 'user-3', 'third turn');

    await expect(
      rejectAt(at(3), 'user-2', first.fileVersionId),
    ).rejects.toThrow(
      new ConflictException('Only the latest save can be rejected.'),
    );

    await fixture.db.game.update({
      where: { id: 'game-1' },
      data: { turnRevision: { increment: 1 } },
    });
    await expect(
      rejectAt(at(3), 'user-2', second.fileVersionId),
    ).rejects.toThrow(
      new ConflictException(
        'This save can no longer be rejected because the campaign has moved on since it was uploaded.',
      ),
    );
  });

  it('refuses a save rejected earlier', async () => {
    const upload = await uploadAt(at(1), 'user-1', 'alpha turn');
    await rejectAt(at(2), 'user-3', upload.fileVersionId);

    await expect(
      rejectAt(at(3), 'user-3', upload.fileVersionId),
    ).rejects.toThrow(new ConflictException('Save #1 was already rejected.'));
  });

  it('refuses the rejected file again and numbers the corrected save after it', async () => {
    const upload = await uploadAt(at(1), 'user-1', 'alpha turn');
    await rejectAt(at(2), 'user-3', upload.fileVersionId);

    await expect(uploadAt(at(3), 'user-1', 'alpha turn')).rejects.toThrow(
      new ConflictException(
        'This is save #1, which Third rejected. Upload a corrected save.',
      ),
    );
    await expect(
      uploadAt(at(3), 'user-1', 'corrected alpha turn'),
    ).resolves.toMatchObject({
      versionNumber: 2,
      activePlayer: { id: 'seat-2' },
    });
  });

  it('waits a full repeat interval before reminding an overdue uploader again', async () => {
    await fixture.db.turnRecord.update({
      where: { id: 'turn-1' },
      data: {
        reminderCount: 1,
        lastReminderAt: at(36),
        nextReminderAt: at(60),
      },
    });
    const upload = await uploadAt(at(60), 'user-1', 'alpha turn');
    await rejectAt(at(70), 'user-3', upload.fileVersionId);

    expect(
      await fixture.db.turnRecord.findUnique({ where: { id: 'turn-1' } }),
    ).toMatchObject({
      startedAt: at(10),
      reminderCount: 1,
      lastReminderAt: at(46),
      nextReminderAt: at(94),
    });
  });

  it('rejects through Discord as the linked Shadow Cloud user', async () => {
    await fixture.db.authIdentity.create({
      data: { provider: 'discord', providerId: 'discord-3', userId: 'user-3' },
    });
    const upload = await uploadAt(at(1), 'user-1', 'alpha turn');

    await expect(
      mutations.rejectSaveFromDiscord({
        fileVersionId: upload.fileVersionId,
        callerDiscordId: 'discord-unknown',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      mutations.rejectSaveFromDiscord({
        fileVersionId: upload.fileVersionId,
        callerDiscordId: 'discord-3',
      }),
    ).resolves.toMatchObject({ activePlayer: { userId: 'user-1' } });
  });
});
