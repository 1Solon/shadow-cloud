import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignJWT } from 'jose';
import { GamesController } from '../src/games/games.controller';
import { GamesService } from '../src/games/games.service';
import { GamesTurnService } from '../src/games/services/games-turn.service';
import { ReorderSeatOrderDto } from '../src/games/dto/reorder-seat-order.dto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';
import type { Prisma, PrismaClient } from '@prisma/client';

vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));
const { GamesQueryService } =
  await import('../src/games/services/games-query.service');

const baseline = { campaignId: 'game', revision: 0 };
const intent = {
  seatEntryIds: ['owner-seat', 'other-seat', 'open-seat'],
  baseline,
};
const startedAt = new Date('2026-09-01T00:00:00.000Z');
const uploadFile = {
  originalname: 'turn.se1',
  buffer: Buffer.from([1, 2, 3]),
  size: 3,
};
const uploadMetadata = {
  contentHash: 'sha256:abc',
  idempotencyKey: 'upload-1',
};
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  for (const id of ['owner', 'other', 'replacement']) {
    await fixture.db.user.create({
      data: {
        id,
        displayName: id,
        email: `${id}@example.com`,
        identities: {
          create: { provider: 'discord', providerId: `${id}-discord` },
        },
      },
    });
  }
  await fixture.db.game.create({
    data: {
      id: 'game',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'owner',
      playerCount: 3,
      discordThreadId: 'thread',
      players: {
        create: [
          {
            id: 'owner-seat',
            turnOrder: 1,
            userId: 'owner',
            role: 'ORGANIZER',
          },
          { id: 'other-seat', turnOrder: 2, userId: 'other' },
          { id: 'open-seat', turnOrder: 3 },
        ],
      },
      turnState: {
        create: {
          activePlayerEntryId: 'owner-seat',
          activePlayerId: 'owner',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn',
          gamePlayerId: 'owner-seat',
          userId: 'owner',
          seatNumber: 1,
          playerDisplayName: 'owner',
          roundNumber: 4,
          startedAt,
        },
      },
    },
  });
  mutations = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    fileStorage: {
      stageUpload: async (input) => {
        const storagePath = '/test/turn.se1';
        await input.prepare?.(storagePath);
        return { fileName: 'turn.se1', storagePath };
      },
      removeFileOrThrow: async () => {},
    },
  });
});

afterEach(async () => {
  await fixture?.close();
  vi.unstubAllEnvs();
});

async function persisted(db = fixture.db) {
  return {
    games: await db.game.findMany({ orderBy: { id: 'asc' } }),
    seats: await db.gamePlayer.findMany({ orderBy: { id: 'asc' } }),
    states: await db.turnState.findMany({ orderBy: { id: 'asc' } }),
    history: await db.turnRecord.findMany({ orderBy: { id: 'asc' } }),
    reminders: await db.notificationDelivery.findMany({
      orderBy: { id: 'asc' },
    }),
    audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    files: await db.fileVersion.findMany({ orderBy: { id: 'asc' } }),
  };
}

function beforeTransaction(action: (other: PrismaClient) => Promise<unknown>) {
  const other = fixture.connect();
  const transact = fixture.db.$transaction.bind(fixture.db);
  vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
    async (...args) => {
      await action(other);
      return transact(...args);
    },
  );
}

describe('Seat Order draft baseline', () => {
  it('rejects malformed intent at the direct owner interface without TypeErrors or writes', async () => {
    const before = await persisted();
    for (const invalid of [
      { baseline },
      { ...intent, seatEntryIds: false },
      { ...intent, seatEntryIds: new Array(3) },
      { ...intent, clearedSeatEntryIds: new Set(['other-seat']) },
      { ...intent, removedSeatEntryIds: [1] },
      { ...intent, activePlayerEntryId: {} },
    ]) {
      await expect(
        mutations.reorderSeatOrder('1', 'owner', invalid as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await persisted()).toEqual(before);
  });

  it('preserves omitted and null optional intent fields as an effective no-op', async () => {
    const before = await persisted();
    await mutations.reorderSeatOrder('1', 'owner', intent);
    await mutations.reorderSeatOrder('1', 'owner', {
      ...intent,
      clearedSeatEntryIds: null,
      removedSeatEntryIds: null,
      activePlayerEntryId: null,
    } as never);
    expect(await persisted()).toEqual(before);
  });

  it.each(['revision-aware replacement', 'injected occupant write'])(
    'rejects a %s during processing with the stale-draft code and preserves the competing write',
    async (writer) => {
      const loaded = await mutations.getSeatOrder('1', 'owner');
      let changed: Awaited<ReturnType<typeof persisted>>;
      beforeTransaction(async (other) => {
        if (writer === 'revision-aware replacement') {
          await new TurnMutationsService(
            other,
            new TurnRecordsService(),
          ).replacePlayerInSeat({
            discordThreadId: 'thread',
            callerDiscordId: 'owner-discord',
            seatNumber: 2,
            newPlayerDiscordId: 'replacement-discord',
            newPlayerDisplayName: 'replacement',
          });
        } else {
          await other.gamePlayer.update({
            where: { id: 'other-seat' },
            data: { userId: 'replacement' },
          });
        }
        changed = await persisted(other);
      });
      await expect(
        mutations.reorderSeatOrder('1', 'owner', {
          ...intent,
          baseline: loaded.seatOrderBaseline,
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'STALE_SEAT_ORDER' },
      });
      expect(await persisted()).toEqual(changed!);
      expect(
        changed!.seats.find((seat) => seat.id === 'other-seat')?.userId,
      ).toBe('replacement');
    },
  );

  it('allows only one edit from a shared loaded baseline across independent connections', async () => {
    const loaded = await mutations.getSeatOrder('1', 'owner');
    let changed: Awaited<ReturnType<typeof persisted>>;
    beforeTransaction(async (other) => {
      await new TurnMutationsService(
        other,
        new TurnRecordsService(),
      ).reorderSeatOrder('1', 'owner', {
        ...intent,
        seatEntryIds: ['other-seat', 'owner-seat', 'open-seat'],
        baseline: loaded.seatOrderBaseline,
      });
      changed = await persisted(other);
    });
    await expect(
      mutations.reorderSeatOrder('1', 'owner', {
        ...intent,
        clearedSeatEntryIds: ['other-seat'],
        baseline: loaded.seatOrderBaseline,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
    expect(await persisted()).toEqual(changed!);
    expect(changed!.games[0].turnRevision).toBe(1);
  });

  it('keeps the loaded baseline usable when a late trigger rolls back every Seat Order effect', async () => {
    await fixture.db.notificationDelivery.create({
      data: {
        id: 'pending',
        gameId: 'game',
        gameSlug: 'ashes',
        turnRecordId: 'turn',
        event: 'TURN_NUDGE',
        payload: '{}',
      },
    });
    const loaded = await mutations.getSeatOrder('1', 'owner');
    const before = await persisted();
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_baseline_edit AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'TURN_REASSIGNED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT COUNT(*) FROM GamePlayer WHERE gameId = NEW.gameId) = 2
      AND (SELECT userId FROM GamePlayer WHERE id = 'owner-seat') IS NULL
      AND (SELECT activePlayerEntryId FROM TurnState WHERE gameId = NEW.gameId) = 'other-seat'
      AND (SELECT COUNT(*) FROM TurnRecord WHERE gameId = NEW.gameId) = 2
      AND (SELECT status FROM NotificationDelivery WHERE id = 'pending') = 'CANCELLED'
      BEGIN SELECT RAISE(ABORT, 'late baseline failure'); END`);
    const edit = {
      baseline: loaded.seatOrderBaseline,
      seatEntryIds: ['other-seat', 'owner-seat'],
      removedSeatEntryIds: ['open-seat'],
      clearedSeatEntryIds: ['owner-seat'],
    };
    await expect(
      mutations.reorderSeatOrder('1', 'owner', edit),
    ).rejects.toThrow();
    expect(await persisted(fixture.connect())).toEqual(before);
    expect(await mutations.getSeatOrder('1', 'owner')).toEqual(loaded);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_baseline_edit');
    expect(
      (await mutations.reorderSeatOrder('1', 'owner', edit)).seatOrder
        .seatOrderBaseline,
    ).toEqual({ campaignId: 'game', revision: 1 });
  });

  it.each([
    'skip',
    'upload',
    'inactive replacement',
    'active replacement',
    'inactive resignation',
    'active resignation',
    'seat growth',
    'seat removal',
    'round correction',
    'Overlord transfer',
    'registration approval',
    'combined Seat Order',
  ])(
    '%s invalidates a previously loaded draft with one committed revision',
    async (writer) => {
      const loaded = await mutations.getSeatOrder('1', 'owner');
      if (writer === 'skip')
        await mutations.skipPlayerTurn({
          discordThreadId: 'thread',
          callerDiscordId: 'owner-discord',
        });
      if (writer === 'upload')
        await mutations.uploadSave('1', 'owner', uploadFile, uploadMetadata);
      if (writer === 'inactive replacement' || writer === 'active replacement')
        await mutations.replacePlayerInSeat({
          discordThreadId: 'thread',
          callerDiscordId: 'owner-discord',
          seatNumber: writer === 'active replacement' ? 1 : 2,
          newPlayerDiscordId: 'replacement-discord',
          newPlayerDisplayName: 'replacement',
        });
      if (writer === 'inactive resignation' || writer === 'active resignation')
        await mutations.resignPlayerFromDiscord({
          discordThreadId: 'thread',
          playerDiscordId:
            writer === 'active resignation' ? 'owner-discord' : 'other-discord',
        });
      if (writer === 'seat growth')
        await mutations.updateGameMetadata('1', 'owner', { playerCount: 4 });
      if (writer === 'seat removal')
        await mutations.updateGameMetadata('1', 'owner', { playerCount: 2 });
      if (writer === 'round correction')
        await mutations.updateGameMetadata('1', 'owner', { roundNumber: 5 });
      if (writer === 'Overlord transfer')
        await mutations.transferHost('1', 'owner', {
          targetPlayerEntryId: 'other-seat',
        });
      if (writer === 'registration approval') {
        const request = await fixture.db.registrationRequest.create({
          data: {
            gameId: 'game',
            playerDiscordId: 'replacement-discord',
            playerDisplayName: 'replacement',
          },
        });
        await mutations.approveRegistrationRequest(
          request.id,
          undefined,
          'owner-discord',
        );
      }
      if (writer === 'combined Seat Order')
        await mutations.reorderSeatOrder('1', 'owner', {
          ...intent,
          seatEntryIds: ['owner-seat', 'other-seat'],
          clearedSeatEntryIds: ['other-seat'],
          removedSeatEntryIds: ['open-seat'],
        });
      const afterWriter = await persisted();
      expect(afterWriter.games[0].turnRevision).toBe(1);
      await expect(
        mutations.reorderSeatOrder(
          '1',
          writer === 'Overlord transfer' ? 'other' : 'owner',
          {
            seatEntryIds: loaded.players.map((seat) => seat.id),
            baseline: loaded.seatOrderBaseline,
          },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'STALE_SEAT_ORDER' },
      });
      expect(await persisted()).toEqual(afterWriter);
    },
  );

  it.each([
    'occupant',
    'ordering',
    'ownership and roles',
    'round',
    'active turn',
    'seat membership',
  ])('rejects a draft after %s changes and is restored', async (change) => {
    const loaded = await mutations.getSeatOrder('1', 'owner');
    if (change === 'occupant') {
      await mutations.replacePlayerInSeat({
        discordThreadId: 'thread',
        callerDiscordId: 'owner-discord',
        seatNumber: 2,
        newPlayerDiscordId: 'replacement-discord',
        newPlayerDisplayName: 'replacement',
      });
      await mutations.replacePlayerInSeat({
        discordThreadId: 'thread',
        callerDiscordId: 'owner-discord',
        seatNumber: 2,
        newPlayerDiscordId: 'other-discord',
        newPlayerDisplayName: 'other',
      });
    }
    if (change === 'ordering') {
      await mutations.reorderSeatOrder('1', 'owner', {
        ...intent,
        seatEntryIds: ['other-seat', 'owner-seat', 'open-seat'],
      });
      await mutations.reorderSeatOrder('1', 'owner', {
        ...intent,
        baseline: { campaignId: 'game', revision: 1 },
      });
    }
    if (change === 'ownership and roles') {
      await mutations.transferHost('1', 'owner', {
        targetPlayerEntryId: 'other-seat',
      });
      await mutations.transferHost('1', 'other', {
        targetPlayerEntryId: 'owner-seat',
      });
    }
    if (change === 'round') {
      await mutations.updateGameMetadata('1', 'owner', { roundNumber: 5 });
      await mutations.updateGameMetadata('1', 'owner', { roundNumber: 4 });
    }
    if (change === 'active turn') {
      await mutations.skipPlayerTurn({
        discordThreadId: 'thread',
        callerDiscordId: 'owner-discord',
      });
      await mutations.skipPlayerTurn({
        discordThreadId: 'thread',
        callerDiscordId: 'owner-discord',
      });
    }
    if (change === 'seat membership') {
      await mutations.updateGameMetadata('1', 'owner', { playerCount: 4 });
      await mutations.updateGameMetadata('1', 'owner', { playerCount: 3 });
    }
    expect(await mutations.getSeatOrder('1', 'owner')).toEqual({
      ...loaded,
      seatOrderBaseline: { campaignId: 'game', revision: 2 },
    });
    const before = await persisted();
    await expect(
      mutations.reorderSeatOrder('1', 'owner', intent),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
    expect(await persisted()).toEqual(before);
  });

  it('initialization establishes a campaign-bound baseline which registration approval invalidates', async () => {
    const initialized = await mutations.createGameFromDiscordInit({
      gameNumber: 2,
      name: 'New campaign',
      playerCount: 2,
      organizerDiscordId: 'owner-discord',
      organizerDisplayName: 'owner',
      discordGuildId: 'guild',
      discordChannelId: 'channel',
      discordThreadId: 'new-thread',
    });
    const loaded = await mutations.getSeatOrder(initialized.id, 'owner');
    expect(loaded).toMatchObject({
      gameId: initialized.id,
      organizerId: 'owner',
      roundNumber: 1,
      seatOrderBaseline: { campaignId: initialized.id, revision: 0 },
    });
    expect(loaded.players).toHaveLength(2);
    expect(
      await new GamesQueryService({} as never).getGameDetail('2'),
    ).toMatchObject({
      seatOrderBaseline: loaded.seatOrderBaseline,
      activePlayerEntryId: loaded.activePlayerEntryId,
    });
    await expect(
      mutations.reorderSeatOrder('2', 'owner', {
        seatEntryIds: loaded.players.map((seat) => seat.id),
        baseline,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
    const request = await fixture.db.registrationRequest.create({
      data: {
        gameId: initialized.id,
        playerDiscordId: 'other-discord',
        playerDisplayName: 'other',
      },
    });
    await mutations.approveRegistrationRequest(
      request.id,
      undefined,
      'owner-discord',
    );
    await expect(
      mutations.reorderSeatOrder('2', 'owner', {
        seatEntryIds: loaded.players.map((seat) => seat.id),
        baseline: loaded.seatOrderBaseline,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
    expect(
      (await mutations.getSeatOrder('2', 'owner')).seatOrderBaseline,
    ).toEqual({ campaignId: initialized.id, revision: 1 });
    expect(
      (await mutations.getSeatOrder('1', 'owner')).seatOrderBaseline,
    ).toEqual(baseline);
  });

  it('treats a same-seat completed upload as a new turn but leaves a post-upload baseline current on replay', async () => {
    await fixture.db.gamePlayer.update({
      where: { id: 'other-seat' },
      data: { userId: null },
    });
    const loaded = await mutations.getSeatOrder('1', 'owner');
    await mutations.uploadSave('1', 'owner', uploadFile, uploadMetadata);
    const afterUpload = await mutations.getSeatOrder('1', 'owner');
    expect(afterUpload).toMatchObject({
      activePlayerEntryId: 'owner-seat',
      activePlayerUserId: 'owner',
      roundNumber: 5,
      seatOrderBaseline: { campaignId: 'game', revision: 1 },
    });
    expect((await persisted()).history).toHaveLength(2);
    await expect(
      mutations.reorderSeatOrder('1', 'owner', {
        ...intent,
        baseline: loaded.seatOrderBaseline,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
    const beforeReplay = await persisted();
    expect(
      await mutations.uploadSave('1', 'owner', uploadFile, uploadMetadata),
    ).toMatchObject({ idempotentReplay: true });
    expect(await persisted()).toEqual(beforeReplay);
    await mutations.reorderSeatOrder('1', 'owner', {
      ...intent,
      baseline: afterUpload.seatOrderBaseline,
    });
    expect(await persisted()).toEqual(beforeReplay);
  });

  it('keeps a loaded baseline current after cosmetic, reminder, no-op and rejected operations', async () => {
    const loaded = await mutations.getSeatOrder('1', 'owner');
    await mutations.updateGameMetadata('1', 'owner', {
      notes: 'Updated notes',
      name: 'New name',
      turnTargetHours: 12,
    });
    await mutations.updateGameMetadata('1', 'owner', {
      playerCount: 3,
      roundNumber: 4,
    });
    await fixture.db.user.update({
      where: { id: 'other' },
      data: { displayName: 'Renamed' },
    });
    await fixture.db.notificationDelivery.create({
      data: {
        event: 'TURN_NUDGE',
        status: 'DELIVERED',
        gameId: 'game',
        gameSlug: 'ashes',
        turnRecordId: 'turn',
        payload: '{}',
      },
    });
    await fixture.db.turnRecord.update({
      where: { id: 'turn' },
      data: {
        reminderCount: 1,
        lastReminderAt: new Date(),
        nextReminderAt: new Date(),
      },
    });
    const rejectedRequest = await fixture.db.registrationRequest.create({
      data: {
        gameId: 'game',
        playerDiscordId: 'replacement-discord',
        playerDisplayName: 'replacement',
      },
    });
    await mutations.rejectRegistrationRequest(
      rejectedRequest.id,
      undefined,
      'owner-discord',
    );
    await expect(
      mutations.approveRegistrationRequest(
        rejectedRequest.id,
        undefined,
        'owner-discord',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      mutations.transferHost('1', 'owner', {
        targetPlayerEntryId: 'owner-seat',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      mutations.replacePlayerInSeat({
        discordThreadId: 'thread',
        callerDiscordId: 'owner-discord',
        seatNumber: 1,
        newPlayerDiscordId: 'other-discord',
        newPlayerDisplayName: 'other',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await mutations.getSeatOrder('1', 'owner')).seatOrderBaseline,
    ).toEqual(loaded.seatOrderBaseline);
    const beforeNoop = await persisted();
    const saved = await mutations.reorderSeatOrder('1', 'owner', {
      ...intent,
      baseline: loaded.seatOrderBaseline,
    });
    expect(saved.seatOrder).toMatchObject({
      name: 'New name',
      seatOrderBaseline: baseline,
      players: expect.arrayContaining([
        expect.objectContaining({ id: 'other-seat', displayName: 'Renamed' }),
      ]),
    });
    expect(await persisted()).toEqual(beforeNoop);
  });

  it.each([
    undefined,
    null,
    false,
    0,
    '0',
    [],
    {},
    { campaignId: 'game' },
    { revision: 0 },
    { campaignId: '', revision: 0 },
    { campaignId: '  ', revision: 0 },
    { campaignId: 1, revision: 0 },
    { campaignId: 'game', revision: '0' },
    { campaignId: 'game', revision: null },
    { campaignId: 'game', revision: -1 },
    { campaignId: 'game', revision: 0.5 },
    { campaignId: 'game', revision: Number.MAX_SAFE_INTEGER + 1 },
    { campaignId: 'game', revision: NaN },
    { campaignId: 'game', revision: Infinity },
  ])(
    'rejects malformed baseline %j without writes or synthesis',
    async (invalid) => {
      const before = await persisted();
      await expect(
        mutations.reorderSeatOrder('1', 'owner', {
          ...intent,
          baseline: invalid,
        } as never),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'SEAT_ORDER_BASELINE_REQUIRED',
          message: expect.stringMatching(/reload/i),
        },
      });
      expect(await persisted()).toEqual(before);
    },
  );

  it.each([
    { campaignId: 'other-game', revision: 0 },
    { campaignId: 'game', revision: 1 },
    { campaignId: 'game', revision: Number.MAX_SAFE_INTEGER },
  ])(
    'rejects a valid but noncurrent baseline %j including no-ops',
    async (stale) => {
      const before = await persisted();
      await expect(
        mutations.reorderSeatOrder('1', 'owner', {
          ...intent,
          baseline: stale,
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'STALE_SEAT_ORDER' },
      });
      expect(await persisted()).toEqual(before);
    },
  );

  it('binds a baseline to stable campaign identity rather than its changeable number', async () => {
    await mutations.updateGameMetadata('1', 'owner', { gameNumber: 8 });
    expect(
      (await mutations.getSeatOrder('8', 'owner')).seatOrderBaseline,
    ).toEqual(baseline);
    await mutations.reorderSeatOrder('8', 'owner', intent);
    await fixture.db.game.create({
      data: {
        id: 'different-game',
        gameNumber: 1,
        name: 'Different',
        slug: 'different',
        organizerId: 'owner',
        players: {
          create: { id: 'different-seat', turnOrder: 1, userId: 'owner' },
        },
      },
    });
    await expect(
      mutations.reorderSeatOrder('1', 'owner', {
        ...intent,
        seatEntryIds: ['different-seat'],
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
  });

  it('preserves authorization and missing-campaign precedence over malformed or stale baselines', async () => {
    for (const submitted of [
      undefined,
      { campaignId: 'other-game', revision: 99 },
    ]) {
      const edit = { ...intent, baseline: submitted } as never;
      await expect(
        mutations.reorderSeatOrder('1', undefined, edit),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        mutations.reorderSeatOrder('missing', 'owner', edit),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        mutations.reorderSeatOrder('1', 'other', edit),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    beforeTransaction(async (other) => {
      await new TurnMutationsService(
        other,
        new TurnRecordsService(),
      ).transferHost('1', 'owner', { targetPlayerEntryId: 'other-seat' });
    });
    await expect(
      mutations.reorderSeatOrder('1', 'owner', intent),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await persisted()).games[0]).toMatchObject({
      organizerId: 'other',
      turnRevision: 1,
    });
  });

  it('checks recovery permissions locally in the read transaction and remote shadow roles beforehand', async () => {
    await expect(mutations.getSeatOrder('1', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      mutations.getSeatOrder('missing', 'owner'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(mutations.getSeatOrder('1', 'other')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    beforeTransaction(async (other) => {
      await new TurnMutationsService(
        other,
        new TurnRecordsService(),
      ).transferHost('1', 'owner', { targetPlayerEntryId: 'other-seat' });
    });
    await expect(mutations.getSeatOrder('1', 'owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    let admitted = false;
    const authService = {
      isUserShadowOverride: vi.fn(async () => {
        expect(admitted).toBe(false);
        return true;
      }),
    };
    mutations = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
      authService,
    });
    beforeTransaction(async () => {
      admitted = true;
    });
    expect(await mutations.getSeatOrder('1', 'replacement')).toMatchObject({
      organizerId: 'other',
      seatOrderBaseline: { campaignId: 'game', revision: 1 },
    });
    expect(authService.isUserShadowOverride).toHaveBeenCalledExactlyOnceWith(
      'replacement',
    );
    admitted = false;
    await expect(
      mutations.reorderSeatOrder('1', 'replacement', intent),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
    await expect(
      mutations.reorderSeatOrder('1', 'replacement', {
        seatEntryIds: intent.seatEntryIds,
      } as never),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'SEAT_ORDER_BASELINE_REQUIRED' },
    });
  });

  it('keeps uninitialized recovery and POST snapshots free of invented active turns', async () => {
    await fixture.db.turnRecord.deleteMany();
    await fixture.db.turnState.deleteMany();
    expect(await mutations.getSeatOrder('1', 'owner')).toMatchObject({
      activePlayerEntryId: null,
      activePlayerUserId: null,
      roundNumber: null,
      seatOrderBaseline: baseline,
    });
    const response = await mutations.reorderSeatOrder('1', 'owner', {
      ...intent,
      seatEntryIds: ['other-seat', 'owner-seat', 'open-seat'],
      activePlayerEntryId: 'other-seat',
    });
    expect(response.activePlayerEntryId).toBe('other-seat');
    expect(response.seatOrder).toMatchObject({
      activePlayerEntryId: null,
      activePlayerUserId: null,
      roundNumber: null,
      seatOrderBaseline: { campaignId: 'game', revision: 1 },
    });
    expect((await persisted()).history).toEqual([]);
  });

  it('returns the snapshot of its own commit even if another writer commits before the response is delivered', async () => {
    const other = fixture.connect();
    const transact = fixture.db.$transaction.bind(fixture.db);
    vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
      async (...args) => {
        const result = await transact(...args);
        await new TurnMutationsService(
          other,
          new TurnRecordsService(),
        ).skipPlayerTurn({
          discordThreadId: 'thread',
          callerDiscordId: 'owner-discord',
        });
        return result;
      },
    );
    const response = await mutations.reorderSeatOrder('1', 'owner', {
      ...intent,
      seatEntryIds: ['other-seat', 'owner-seat', 'open-seat'],
    });
    expect(response.seatOrder).toMatchObject({
      activePlayerEntryId: 'owner-seat',
      seatOrderBaseline: { campaignId: 'game', revision: 1 },
    });
    expect(await mutations.getSeatOrder('1', 'owner')).toMatchObject({
      activePlayerEntryId: 'other-seat',
      seatOrderBaseline: { campaignId: 'game', revision: 2 },
    });
    await expect(
      mutations.reorderSeatOrder('1', 'owner', {
        ...intent,
        baseline: response.seatOrder.seatOrderBaseline,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'STALE_SEAT_ORDER' },
    });
  });

  it('exposes authenticated recovery and preserves required baseline validation through the real HTTP/DTO path', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'seat-order-test-secret');
    const service = new GamesService(
      {} as never,
      new GamesQueryService({} as never),
      {} as never,
      new GamesTurnService(mutations),
      {} as never,
      {} as never,
      mutations,
    );
    class TestModule {}
    Module({
      controllers: [GamesController],
      providers: [{ provide: GamesService, useValue: service }],
    })(TestModule);
    // Vitest's TS transform does not emit the metadata tsc emits in production.
    Reflect.defineMetadata(
      'design:paramtypes',
      [GamesService],
      GamesController,
    );
    Reflect.defineMetadata(
      'design:paramtypes',
      [String, Object, ReorderSeatOrderDto],
      GamesController.prototype,
      'reorderSeatOrder',
    );
    const app = await NestFactory.create(TestModule, { logger: false });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    try {
      const url = `${await app.getUrl()}/v1/games/1/seat-order`;
      const token = await new SignJWT({ sub: 'owner' })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode('seat-order-test-secret'));
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      };
      expect((await fetch(url)).status).toBe(401);
      const loaded = await fetch(url, { headers });
      expect(loaded.status).toBe(200);
      expect(await loaded.json()).toMatchObject({
        gameId: 'game',
        seatOrderBaseline: baseline,
      });
      const missing = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ seatEntryIds: intent.seatEntryIds }),
      });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toMatchObject({
        code: 'SEAT_ORDER_BASELINE_REQUIRED',
        message: expect.stringMatching(/reload/i),
      });
      for (const malformed of [
        null,
        {},
        { campaignId: 'game', revision: '0' },
        { campaignId: '', revision: 0 },
      ]) {
        const invalid = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...intent, baseline: malformed }),
        });
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toMatchObject({
          code: 'SEAT_ORDER_BASELINE_REQUIRED',
        });
      }
      const stale = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...intent,
          baseline: { campaignId: 'wrong-game', revision: 0 },
        }),
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: 'STALE_SEAT_ORDER' });
      const invalidIntent = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...intent, seatEntryIds: ['foreign'] }),
      });
      expect(invalidIntent.status).toBe(400);
      expect(await invalidIntent.json()).not.toHaveProperty(
        'code',
        'STALE_SEAT_ORDER',
      );
      const valid = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(intent),
      });
      expect(valid.status).toBe(201);
      expect(await valid.json()).toMatchObject({
        gameId: 'game',
        seatOrder: { seatOrderBaseline: baseline },
      });
      const invalidIntents = [
        { seatEntryIds: [] },
        { seatEntryIds: undefined },
        { seatEntryIds: null },
        { seatEntryIds: 'owner-seat' },
        { seatEntryIds: {} },
        { seatEntryIds: [1] },
        { seatEntryIds: [null] },
        { clearedSeatEntryIds: 'other-seat' },
        { clearedSeatEntryIds: {} },
        { clearedSeatEntryIds: [1] },
        { removedSeatEntryIds: false },
        { removedSeatEntryIds: [null] },
        { activePlayerEntryId: 1 },
        { activePlayerEntryId: ['owner-seat'] },
        { activePlayerEntryId: {} },
      ];
      const beforeInvalid = await persisted();
      for (const invalid of invalidIntents) {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...intent, ...invalid }),
        });
        expect(response.status, JSON.stringify(invalid)).toBe(400);
      }
      expect(await persisted()).toEqual(beforeInvalid);
      await mutations.skipPlayerTurn({
        discordThreadId: 'thread',
        callerDiscordId: 'owner-discord',
      });
      const afterSkip = await persisted();
      for (const invalid of invalidIntents) {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...intent, ...invalid }),
        });
        expect(response.status, JSON.stringify(invalid)).toBe(409);
        expect(await response.json()).toMatchObject({
          code: 'STALE_SEAT_ORDER',
        });
      }
      expect(await persisted()).toEqual(afterSkip);
      await mutations.transferHost('1', 'owner', {
        targetPlayerEntryId: 'other-seat',
      });
      const afterTransfer = await persisted();
      for (const invalid of invalidIntents) {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...intent, ...invalid }),
        });
        expect(response.status, JSON.stringify(invalid)).toBe(403);
      }
      expect(await persisted()).toEqual(afterTransfer);
    } finally {
      await app.close();
    }
  });

  it('loads the detail roster, active turn, history and baseline from one consistent SQLite snapshot', async () => {
    await fixture.db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    const competitor = new TurnMutationsService(
      fixture.connect(),
      new TurnRecordsService(),
    );
    const interleave = (db: Prisma.TransactionClient) => {
      const find = db.game.findFirst.bind(db.game);
      vi.spyOn(db.game, 'findFirst').mockImplementationOnce(async (args) => {
        const game = await find(args);
        await competitor.skipPlayerTurn({
          discordThreadId: 'thread',
          callerDiscordId: 'owner-discord',
        });
        return game;
      });
    };
    const transact = fixture.db.$transaction.bind(fixture.db);
    vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
      (callback, options) =>
        transact(async (tx) => {
          interleave(tx);
          return callback(tx);
        }, options),
    );
    interleave(fixture.db);
    const detail = await new GamesQueryService({} as never).getGameDetail('1');
    expect(detail).toMatchObject({
      id: 'game',
      organizerId: 'owner',
      activePlayerEntryId: 'owner-seat',
      activePlayerUserId: 'owner',
      openTurn: {
        id: 'turn',
        gamePlayerId: 'owner-seat',
        userId: 'owner',
        endedAt: null,
      },
      recentCompletedTurns: [],
      seatOrderBaseline: baseline,
    });
    expect((await persisted()).games[0].turnRevision).toBe(1);
  });

  it('loads an authoritative recovery snapshot and returns the next snapshot atomically with a successful edit', async () => {
    const loaded = await mutations.getSeatOrder('1', 'owner');
    expect(loaded).toEqual({
      gameId: 'game',
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'owner',
      players: [
        {
          id: 'owner-seat',
          userId: 'owner',
          displayName: 'owner',
          turnOrder: 1,
          isOrganizer: true,
        },
        {
          id: 'other-seat',
          userId: 'other',
          displayName: 'other',
          turnOrder: 2,
          isOrganizer: false,
        },
        {
          id: 'open-seat',
          userId: null,
          displayName: null,
          turnOrder: 3,
          isOrganizer: false,
        },
      ],
      activePlayerEntryId: 'owner-seat',
      activePlayerUserId: 'owner',
      roundNumber: 4,
      seatOrderBaseline: baseline,
    });
    const response = await mutations.reorderSeatOrder('ashes', 'owner', {
      ...intent,
      seatEntryIds: ['other-seat', 'owner-seat', 'open-seat'],
      baseline: loaded.seatOrderBaseline,
    });
    expect(response.seatOrder).toEqual({
      ...loaded,
      players: [
        { ...loaded.players[1], turnOrder: 1 },
        { ...loaded.players[0], turnOrder: 2 },
        loaded.players[2],
      ],
      seatOrderBaseline: { campaignId: 'game', revision: 1 },
    });
    expect(await mutations.getSeatOrder('game', 'owner')).toEqual(
      response.seatOrder,
    );
    const before = await persisted();
    const noop = await mutations.reorderSeatOrder('1', 'owner', {
      seatEntryIds: response.seatOrder.players.map((seat) => seat.id),
      baseline: response.seatOrder.seatOrderBaseline,
    });
    expect(noop.seatOrder).toEqual(response.seatOrder);
    expect(await persisted()).toEqual(before);
  });

  it('rejects a draft loaded before a turn change, even when the requested roster is a no-op', async () => {
    await mutations.skipPlayerTurn({
      discordThreadId: 'thread',
      callerDiscordId: 'owner-discord',
    });
    const afterSkip = await persisted();
    await expect(
      mutations.reorderSeatOrder('1', 'owner', intent),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'STALE_SEAT_ORDER',
        message: expect.stringMatching(/reload/i),
      },
    });
    expect(await persisted()).toEqual(afterSkip);
  });

  it('rejects an old baseline-less no-op with an actionable reload error', async () => {
    const before = await persisted();
    await expect(
      mutations.reorderSeatOrder('1', 'owner', {
        seatEntryIds: intent.seatEntryIds,
      } as never),
    ).rejects.toMatchObject({
      status: 400,
      response: {
        code: 'SEAT_ORDER_BASELINE_REQUIRED',
        message: expect.stringMatching(/reload/i),
      },
    });
    expect(await persisted()).toEqual(before);
  });
});
