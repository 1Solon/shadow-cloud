import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileStorageService } from '../src/games/file-storage.service';
import type { TurnMutationDependencies } from '../src/games/services/turn-mutations/dependencies';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));
const { GamesQueryService } =
  await import('../src/games/services/games-query.service');

const hour = 60 * 60 * 1000;
const turnStart = new Date('2026-09-01T00:00:00Z');
const at = (hours: number) => new Date(turnStart.getTime() + hours * hour);
const save = (content: string) => ({
  originalname: 'turn.se1',
  buffer: Buffer.from(content),
  size: content.length,
});

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(turnStart);
  fixture = await createSqliteFixture();
  const { db } = fixture;
  for (const [id, displayName, discordId] of [
    ['user-1', 'Alpha', 'discord-1'],
    ['user-2', 'Overlord', 'discord-2'],
    ['user-3', 'Third', 'discord-3'],
  ]) {
    await db.user.create({
      data: {
        id,
        displayName,
        email: `${id}@example.com`,
        identities: { create: { provider: 'discord', providerId: discordId } },
      },
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
          nextReminderAt: at(36),
        },
      },
    },
  });
  let uploadAttempt = 0;
  const dependencies: TurnMutationDependencies = {
    fileStorage: {
      async stageUpload(input) {
        const fileName = `${input.gameNumber}-T${input.turn}-S${input.seat}-${input.playerName}.se1`;
        const storagePath = `/saves/${input.gameId}/upload-${++uploadAttempt}-${fileName}`;
        await input.prepare?.(storagePath);
        return { fileName, storagePath };
      },
      async removeFileOrThrow() {},
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

async function uploadAt(hours: number, userId: string, content: string) {
  vi.setSystemTime(at(hours));
  return mutations.uploadSave('game-1', userId, save(content));
}

function replaceSeatAt(hours: number, seatNumber: number) {
  vi.setSystemTime(at(hours));
  return mutations.replacePlayerInSeat({
    discordThreadId: 'thread-1',
    callerDiscordId: 'discord-2',
    seatNumber,
    newPlayerDiscordId: 'discord-new',
    newPlayerDisplayName: 'Newcomer',
  });
}

async function saveNames() {
  const saves = await fixture.db.fileVersion.findMany({
    where: { gameId: 'game-1' },
    orderBy: { versionNumber: 'asc' },
  });
  return saves.map((save) => save.originalName);
}

describe('save name after /replace', () => {
  it("gives the latest save the new occupant's name when their seat received it", async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await replaceSeatAt(20, 2);

    expect(await saveNames()).toEqual(['1-T4-S2-Newcomer.se1']);
  });

  it('downloads the renamed save under its new name', async () => {
    const upload = await uploadAt(10, 'user-1', 'alpha turn');
    await replaceSeatAt(20, 2);
    const storage = {
      openDownload: async () => ({
        size: 10,
        lastModified: at(10),
        stream: Readable.from(['alpha turn']),
      }),
    } as unknown as FileStorageService;

    const download = await new GamesQueryService(storage).downloadSave(
      'ashes',
      upload.fileVersionId,
    );

    expect(download.originalName).toBe('1-T4-S2-Newcomer.se1');
  });

  it('leaves every save name alone when another seat is replaced', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await uploadAt(20, 'user-3', 'third turn');
    await replaceSeatAt(30, 2);

    expect(await saveNames()).toEqual([
      '1-T4-S2-Third.se1',
      '1-T4-S3-Overlord.se1',
    ]);
  });

  it('keeps the names of older saves handed to the replaced seat', async () => {
    await uploadAt(10, 'user-1', 'alpha turn');
    await uploadAt(20, 'user-3', 'third turn');
    await uploadAt(30, 'user-2', 'overlord turn');
    await uploadAt(40, 'user-1', 'alpha again');
    await replaceSeatAt(50, 2);

    expect(await saveNames()).toEqual([
      '1-T4-S2-Third.se1',
      '1-T4-S3-Overlord.se1',
      '1-T5-S1-Alpha.se1',
      '1-T5-S2-Newcomer.se1',
    ]);
  });

  it('leaves a save alone when its name is not in the generated format', async () => {
    const upload = await uploadAt(10, 'user-1', 'alpha turn');
    await fixture.db.fileVersion.update({
      where: { id: upload.fileVersionId },
      data: { originalName: 'imported.se1' },
    });
    await replaceSeatAt(20, 2);

    expect(await saveNames()).toEqual(['imported.se1']);
  });
});
