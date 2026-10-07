import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import {
  deleteConcludedCampaign,
  deleteDueCampaigns,
} from '../src/games/support/campaign-deletion';
import {
  campaignConcludedMessage,
  VICTORY_GRACE_PERIOD_MS,
} from '../src/games/support/campaign-conclusion';
import { createSqliteFixture } from './support/sqlite-fixture';

const thread = 'thread-1';
const startedAt = new Date('2026-09-01T00:00:00.000Z');
const designatedAt = new Date('2026-09-02T00:00:00.000Z');
const afterGrace = new Date(designatedAt.getTime() + VICTORY_GRACE_PERIOD_MS);
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;
let isUserShadowOverride: ReturnType<typeof vi.fn>;

const declare = (
  callerDiscordId = 'discord-2',
  victorDiscordId = 'discord-1',
) =>
  mutations.designateVictory(
    { discordThreadId: thread, callerDiscordId, victorDiscordId },
    { now: designatedAt },
  );

beforeEach(async () => {
  fixture = await createSqliteFixture();
  const { db } = fixture;
  for (const [id, name, discordId] of [
    ['user-1', 'Alpha', 'discord-1'],
    ['user-2', 'Overlord', 'discord-2'],
    ['user-3', 'Lord', 'discord-3'],
    ['user-4', 'Outsider', 'discord-4'],
  ]) {
    await db.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        displayName: name,
        identities: { create: { provider: 'discord', providerId: discordId } },
      },
    });
  }
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 7,
      name: 'Ashes',
      slug: 'ashes',
      discordThreadId: thread,
      organizerId: 'user-2',
      players: {
        create: [
          { id: 'seat-1', userId: 'user-1', turnOrder: 1 },
          { id: 'seat-2', userId: 'user-2', turnOrder: 2, role: 'ORGANIZER' },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'user-1',
          activePlayerEntryId: 'seat-1',
          roundNumber: 3,
        },
      },
      turnRecords: {
        create: {
          id: 'turn-1',
          gamePlayerId: 'seat-1',
          userId: 'user-1',
          seatNumber: 1,
          playerDisplayName: 'Alpha',
          roundNumber: 3,
          startedAt,
          nextReminderAt: new Date('2026-09-01T12:00:00.000Z'),
        },
      },
    },
  });
  isUserShadowOverride = vi.fn(async (userId: string) => userId === 'user-3');
  mutations = new TurnMutationsService(db, new TurnRecordsService(), {
    authService: { isUserShadowOverride },
  });
});

afterEach(async () => {
  await fixture?.close();
});

describe('designating a victory', () => {
  it('concludes the campaign with a victory record and stops turn nudges', async () => {
    await fixture.db.notificationDelivery.create({
      data: {
        id: 'nudge',
        event: 'TURN_NUDGE',
        gameId: 'game-1',
        gameSlug: 'ashes',
        turnRecordId: 'turn-1',
        payload: '{}',
      },
    });

    await expect(declare()).resolves.toEqual({
      gameId: 'game-1',
      gameNumber: 7,
      slug: 'ashes',
      name: 'Ashes',
      victor: { displayName: 'Alpha', discordId: 'discord-1' },
      designatedAt: designatedAt.toISOString(),
      deletionDueAt: afterGrace.toISOString(),
    });

    expect(await fixture.db.victoryRecord.findMany()).toEqual([
      expect.objectContaining({
        gameId: 'game-1',
        gameNumber: 7,
        gameName: 'Ashes',
        victorId: 'user-1',
        victorDisplayName: 'Alpha',
        designatedById: 'user-2',
        designatedByDisplayName: 'Overlord',
        designatedAt,
      }),
    ]);
    expect(
      await fixture.db.notificationDelivery.findUniqueOrThrow({
        where: { id: 'nudge' },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({
        where: { id: 'turn-1' },
      }),
    ).toMatchObject({ endedAt: null, startedAt });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 1 });
    expect(
      await fixture.db.auditEvent.findMany({ select: { eventType: true } }),
    ).toEqual([{ eventType: 'VICTORY_DESIGNATED' }]);
  });

  it('previews the outcome without changing anything', async () => {
    await expect(
      mutations.designateVictory(
        {
          discordThreadId: thread,
          callerDiscordId: 'discord-2',
          victorDiscordId: 'discord-2',
        },
        { preview: true, now: designatedAt },
      ),
    ).resolves.toMatchObject({
      victor: { displayName: 'Overlord', discordId: 'discord-2' },
      deletionDueAt: afterGrace.toISOString(),
    });

    expect(await fixture.db.victoryRecord.count()).toBe(0);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game-1' } }),
    ).toMatchObject({ turnRevision: 0 });
  });

  it('lets a Shadow Lord designate the Victor without a seat', async () => {
    await declare('discord-3');

    expect(await fixture.db.victoryRecord.findFirstOrThrow()).toMatchObject({
      designatedById: 'user-3',
      designatedByDisplayName: 'Lord',
    });
  });

  it('refuses players who are neither the Overlord nor a Shadow Lord', async () => {
    await expect(declare('discord-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(declare('discord-unknown')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await fixture.db.victoryRecord.count()).toBe(0);
  });

  it('requires the Victor to occupy a seat', async () => {
    await expect(declare('discord-2', 'discord-4')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(await fixture.db.victoryRecord.count()).toBe(0);
  });

  it('refuses a second victory while the campaign is concluded', async () => {
    await declare();

    await expect(declare('discord-2', 'discord-2')).rejects.toThrow(
      campaignConcludedMessage,
    );
    expect(await fixture.db.victoryRecord.count()).toBe(1);
  });
});

describe('a concluded campaign', () => {
  it('refuses turn, roster, and metadata changes', async () => {
    await declare();

    await expect(
      mutations.skipPlayerTurn({
        discordThreadId: thread,
        callerDiscordId: 'discord-2',
      }),
    ).rejects.toThrow(campaignConcludedMessage);
    await expect(
      mutations.resignPlayerFromDiscord({
        discordThreadId: thread,
        playerDiscordId: 'discord-1',
      }),
    ).rejects.toThrow(campaignConcludedMessage);
    await expect(
      mutations.updateGameMetadata('game-1', 'user-2', { notes: 'GG' }),
    ).rejects.toThrow(campaignConcludedMessage);

    expect(
      await fixture.db.turnState.findUniqueOrThrow({
        where: { gameId: 'game-1' },
      }),
    ).toMatchObject({ activePlayerEntryId: 'seat-1' });
    expect(
      await fixture.db.gamePlayer.findUniqueOrThrow({
        where: { id: 'seat-1' },
      }),
    ).toMatchObject({ userId: 'user-1' });
  });

  it('keeps its victory record when deleted by hand during the grace period', async () => {
    await declare();

    await fixture.db.game.delete({ where: { id: 'game-1' } });

    expect(await fixture.db.victoryRecord.findFirstOrThrow()).toMatchObject({
      gameId: null,
      gameName: 'Ashes',
      victorDisplayName: 'Alpha',
    });
  });
});

describe('undoing a victory', () => {
  const undo = (now: Date, callerDiscordId = 'discord-2') =>
    mutations.undoVictory(
      { discordThreadId: thread, callerDiscordId },
      { now },
    );

  it('removes the record and resumes the turn without counting the pause', async () => {
    await declare();
    const resumedAt = new Date(designatedAt.getTime() + 3 * 86_400_000);

    await expect(undo(resumedAt)).resolves.toMatchObject({
      victor: { displayName: 'Alpha', discordId: 'discord-1' },
    });

    expect(await fixture.db.victoryRecord.count()).toBe(0);
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({
        where: { id: 'turn-1' },
      }),
    ).toMatchObject({
      endedAt: null,
      startedAt: new Date(startedAt.getTime() + 3 * 86_400_000),
    });
    await expect(
      mutations.skipPlayerTurn({
        discordThreadId: thread,
        callerDiscordId: 'discord-2',
      }),
    ).resolves.toMatchObject({ nextPlayer: { turnOrder: 2 } });
  });

  it('lets a Shadow Lord undo, but not other players', async () => {
    await declare();

    await expect(
      undo(new Date(designatedAt.getTime() + 1), 'discord-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await undo(new Date(designatedAt.getTime() + 1), 'discord-3');

    expect(await fixture.db.victoryRecord.count()).toBe(0);
  });

  it('refuses when the campaign has not concluded or its grace period has ended', async () => {
    await expect(undo(designatedAt)).rejects.toBeInstanceOf(ConflictException);

    await declare();

    await expect(undo(afterGrace)).rejects.toBeInstanceOf(ConflictException);
    expect(await fixture.db.victoryRecord.count()).toBe(1);
  });
});

describe('deleting a concluded campaign', () => {
  let saveDirectory: string;
  const storage = {
    removeFileOrThrow: (path: string) => unlink(path),
    removeGameDirectory: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    saveDirectory = await mkdtemp(join(tmpdir(), 'shadow-cloud-victory-'));
  });

  afterEach(async () => {
    await rm(saveDirectory, { recursive: true, force: true });
  });

  async function seedSaves() {
    const savePath = join(saveDirectory, 'save.se1');
    const resetSourcePath = join(saveDirectory, 'reset-source.se1');
    await writeFile(savePath, 'save');
    await writeFile(resetSourcePath, 'reset');
    await fixture.db.fileVersion.create({
      data: {
        id: 'version-1',
        gameId: 'game-1',
        uploadedById: 'user-1',
        storagePath: savePath,
        originalName: 'save.se1',
        versionNumber: 1,
      },
    });
    await fixture.db.passwordReset.create({
      data: {
        gameId: 'game-1',
        fileVersionId: 'version-1',
        sourcePath: resetSourcePath,
        sourceId: 'source',
        outputId: 'output',
        outputRevision: 1,
        saveRevision: 0,
        actorId: 'user-2',
        regimeId: 'regime',
        regimeName: 'Regime',
        state: 'CLOSED',
      },
    });
    await fixture.db.notificationDelivery.create({
      data: {
        event: 'SAVE_UPLOADED',
        gameId: 'game-1',
        gameSlug: 'ashes',
        payload: '{}',
      },
    });
    return { savePath, resetSourcePath };
  }

  it('waits for the grace period to end', async () => {
    await declare();
    const victory = await fixture.db.victoryRecord.findFirstOrThrow();

    await expect(
      deleteConcludedCampaign(
        fixture.db,
        storage,
        victory.id,
        new Date(afterGrace.getTime() - 1),
      ),
    ).resolves.toBe(false);
    await expect(
      deleteDueCampaigns(
        fixture.db,
        storage,
        new Date(afterGrace.getTime() - 1),
      ),
    ).resolves.toEqual([]);

    expect(await fixture.db.game.count()).toBe(1);
  });

  it('deletes everything but the victory record and queues the final notice', async () => {
    const { savePath, resetSourcePath } = await seedSaves();
    await declare();

    await expect(
      deleteDueCampaigns(fixture.db, storage, afterGrace),
    ).resolves.toEqual([]);

    expect(await fixture.db.game.count()).toBe(0);
    for (const count of await Promise.all([
      fixture.db.gamePlayer.count(),
      fixture.db.turnState.count(),
      fixture.db.turnRecord.count(),
      fixture.db.fileVersion.count(),
      fixture.db.auditEvent.count(),
      fixture.db.passwordReset.count(),
      fixture.db.saveCleanup.count(),
    ])) {
      expect(count).toBe(0);
    }
    expect(existsSync(savePath)).toBe(false);
    expect(existsSync(resetSourcePath)).toBe(false);
    expect(storage.removeGameDirectory).toHaveBeenCalledWith('game-1');
    expect(await fixture.db.victoryRecord.findFirstOrThrow()).toMatchObject({
      gameId: null,
      gameNumber: 7,
      gameName: 'Ashes',
      victorId: 'user-1',
      victorDisplayName: 'Alpha',
    });
    const deliveries = await fixture.db.notificationDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      event: 'CAMPAIGN_DELETED',
      status: 'PENDING',
      gameId: 'game-1',
    });
    expect(JSON.parse(deliveries[0].payload)).toEqual({
      game: {
        id: 'game-1',
        gameNumber: 7,
        slug: 'ashes',
        name: 'Ashes',
        discordThreadId: thread,
      },
      victory: { victorDisplayName: 'Alpha', victorDiscordId: 'discord-1' },
    });
  });

  it('frees the campaign number for reuse', async () => {
    await declare();
    await deleteDueCampaigns(fixture.db, storage, afterGrace);

    await fixture.db.game.create({
      data: {
        gameNumber: 7,
        name: 'Ashes II',
        slug: 'ashes-ii',
        organizerId: 'user-2',
      },
    });

    expect(await fixture.db.victoryRecord.count()).toBe(1);
  });
});
