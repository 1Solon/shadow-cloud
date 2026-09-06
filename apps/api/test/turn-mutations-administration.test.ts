import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

const startedAt = new Date('2026-09-01T00:00:00.000Z');
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  const { db } = fixture;
  await db.user.createMany({
    data: [
      { id: 'owner', email: 'owner@example.com', displayName: 'Overlord' },
      { id: 'target', email: 'target@example.com', displayName: 'Alpha' },
      {
        id: 'outsider',
        email: 'outsider@example.com',
        displayName: 'Outsider',
      },
    ],
  });
  await db.game.create({
    data: {
      id: 'game',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'owner',
      playerCount: 3,
      players: {
        create: [
          {
            id: 'owner-seat',
            turnOrder: 1,
            userId: 'owner',
            role: 'ORGANIZER',
          },
          { id: 'open-seat', turnOrder: 2 },
          { id: 'target-seat', turnOrder: 3, userId: 'target' },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'target',
          activePlayerEntryId: 'target-seat',
          roundNumber: 4,
        },
      },
      turnRecords: {
        create: {
          id: 'turn',
          gamePlayerId: 'target-seat',
          userId: 'target',
          seatNumber: 3,
          playerDisplayName: 'Alpha',
          roundNumber: 4,
          startedAt,
          nextReminderAt: new Date('2026-09-02T12:00:00.000Z'),
        },
      },
    },
  });
  mutations = new TurnMutationsService(db, new TurnRecordsService());
});

afterEach(async () => {
  await fixture?.close();
});

async function persisted(db = fixture.db) {
  return {
    games: await db.game.findMany({ orderBy: { id: 'asc' } }),
    seats: await db.gamePlayer.findMany({ orderBy: { id: 'asc' } }),
    states: await db.turnState.findMany({ orderBy: { id: 'asc' } }),
    history: await db.turnRecord.findMany({ orderBy: { id: 'asc' } }),
    nudges: await db.notificationDelivery.findMany({ orderBy: { id: 'asc' } }),
    audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  };
}

function beforeTransaction(action: (other: PrismaClient) => Promise<unknown>) {
  const other = fixture.connect();
  const transact = fixture.db.$transaction.bind(fixture.db);
  // Control admission only. Every operation and rollback still uses SQLite.
  vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
    async (...args) => {
      await action(other);
      return transact(...args);
    },
  );
}

describe('administration writer contention', () => {
  it.each(['transfer', 'metadata'])(
    'does not retry %s or misreport SQLite contention as a confirmed stale intent',
    async (kind) => {
      const other = fixture.connect();
      const locked = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const writer = other.$transaction(async (transaction) => {
        await transaction.game.update({
          where: { id: 'game' },
          data: { notes: 'Concurrent edit' },
        });
        locked.resolve();
        await release.promise;
      });
      void writer.catch(locked.reject);
      await locked.promise;
      const transactionCalls = vi.spyOn(fixture.db, '$transaction');
      try {
        const result = await (
          kind === 'transfer'
            ? mutations.transferHost('game', 'owner', {
                targetPlayerEntryId: 'target-seat',
              })
            : mutations.updateGameMetadata('game', 'owner', {
                playerCount: 4,
                roundNumber: 5,
                notes: 'Must not persist',
              })
        ).then(
          () => ({ error: null }),
          (error: unknown) => ({ error }),
        );
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error).not.toBeInstanceOf(ConflictException);
        expect(transactionCalls).toHaveBeenCalledOnce();
      } finally {
        release.resolve();
        await writer;
      }
      expect(
        await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
      ).toMatchObject({
        organizerId: 'owner',
        turnRevision: 0,
        playerCount: 3,
        notes: 'Concurrent edit',
      });
      expect(await fixture.db.gamePlayer.count()).toBe(3);
      expect(await fixture.db.turnRecord.count()).toBe(1);
      expect(await fixture.db.auditEvent.count()).toBe(0);
    },
  );
});

describe.each(['transfer', 'metadata'])(
  '%s preserved turn validation',
  (kind) => {
    const submit = () =>
      kind === 'transfer'
        ? mutations.transferHost('game', 'owner', {
            targetPlayerEntryId: 'target-seat',
          })
        : mutations.updateGameMetadata('game', 'owner', {});

    it.each(['uninitialized', 'legacy null seat'])(
      'preserves support for an %s campaign',
      async (stateKind) => {
        if (stateKind === 'uninitialized') {
          await fixture.db.turnState.deleteMany();
          await fixture.db.turnRecord.deleteMany();
        } else {
          await fixture.db.turnState.update({
            where: { gameId: 'game' },
            data: { activePlayerEntryId: null },
          });
        }
        const before = await persisted();
        await submit();
        const after = await persisted();
        expect(after.states).toEqual(before.states);
        expect(after.history).toEqual(before.history);
        expect(after.games[0].turnRevision).toBe(kind === 'transfer' ? 1 : 0);
      },
    );

    it('checks history after transaction admission instead of trusting a pre-read', async () => {
      let changed: Awaited<ReturnType<typeof persisted>>;
      beforeTransaction(async (other) => {
        await other.turnRecord.deleteMany();
        changed = await persisted(other);
      });
      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
      expect(await persisted(fixture.connect())).toEqual(changed!);
    });
  },
);

describe('atomic Overlord transfer', () => {
  it('rolls back all stale organizer roles when an audit trigger rejects their cleanup', async () => {
    await fixture.db.gamePlayer.update({
      where: { id: 'owner-seat' },
      data: { userId: 'outsider' },
    });
    await fixture.db.gamePlayer.update({
      where: { id: 'open-seat' },
      data: { role: 'ORGANIZER' },
    });
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_role_cleanup AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'ROSTER_UPDATED'
      AND (SELECT organizerId FROM Game WHERE id = NEW.gameId) = 'target'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT role FROM GamePlayer WHERE id = 'target-seat') = 'ORGANIZER'
      AND (SELECT role FROM GamePlayer WHERE id = 'owner-seat') = 'PLAYER'
      AND (SELECT role FROM GamePlayer WHERE id = 'open-seat') = 'PLAYER'
      BEGIN SELECT RAISE(ABORT, 'late role cleanup failure'); END`);
    const before = await persisted();
    await expect(
      mutations.transferHost('game', 'owner', {
        targetPlayerEntryId: 'target-seat',
      }),
    ).rejects.toThrow();
    expect(await persisted(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_role_cleanup');
    await mutations.transferHost('game', 'owner', {
      targetPlayerEntryId: 'target-seat',
    });
    expect(
      await fixture.db.gamePlayer.findMany({
        where: { gameId: 'game', role: 'ORGANIZER' },
      }),
    ).toEqual([
      expect.objectContaining({ id: 'target-seat', userId: 'target' }),
    ]);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 1 });
  });

  it.each(['missing', 'wrong occupant', 'wrong seat', 'wrong round'])(
    'rejects transfer with %s open history and rolls back the revision fence',
    async (kind) => {
      if (kind === 'missing') await fixture.db.turnRecord.deleteMany();
      else
        await fixture.db.turnRecord.update({
          where: { id: 'turn' },
          data:
            kind === 'wrong occupant'
              ? { userId: 'owner' }
              : kind === 'wrong seat'
                ? { gamePlayerId: 'owner-seat' }
                : { roundNumber: 3 },
        });
      const before = await persisted();
      await expect(
        mutations.transferHost('game', 'owner', {
          targetPlayerEntryId: 'target-seat',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persisted(fixture.connect())).toEqual(before);
    },
  );

  it('keeps only the new Overlord seat role after initialization, approval and replacement unseat the owner', async () => {
    const game = await mutations.createGameFromDiscordInit({
      gameNumber: 2,
      name: 'Cross-writer campaign',
      playerCount: 3,
      organizerDiscordId: 'original-owner',
      organizerDisplayName: 'Original owner',
      discordGuildId: 'guild',
      discordChannelId: 'channel',
      discordThreadId: 'cross-writer-thread',
    });
    const request = await fixture.db.registrationRequest.create({
      data: {
        gameId: game.id,
        playerDiscordId: 'next-owner',
        playerDisplayName: 'Next owner',
      },
    });
    const approved = await mutations.approveRegistrationRequest(
      request.id,
      undefined,
      'original-owner',
    );
    await mutations.replacePlayerInSeat({
      discordThreadId: 'cross-writer-thread',
      callerDiscordId: 'original-owner',
      seatNumber: 1,
      newPlayerDiscordId: 'replacement',
      newPlayerDisplayName: 'Replacement',
    });
    const before = await persisted();
    expect(before.games.find((entry) => entry.id === game.id)).toMatchObject({
      organizerId: game.organizerId,
      turnRevision: 2,
    });
    expect(before.seats.filter((seat) => seat.gameId === game.id)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: game.organizerId }),
      ]),
    );
    await mutations.transferHost(game.id, game.organizerId, {
      targetPlayerEntryId: approved.player.id,
    });
    const after = await persisted(fixture.connect());
    expect(
      after.seats.filter(
        (seat) => seat.gameId === game.id && seat.role === 'ORGANIZER',
      ),
    ).toEqual([expect.objectContaining({ id: approved.player.id })]);
    expect(after.games.find((entry) => entry.id === game.id)).toMatchObject({
      organizerId: after.seats.find((seat) => seat.id === approved.player.id)!
        .userId,
      turnRevision: 3,
    });
    expect(after.states).toEqual(before.states);
    expect(after.history).toEqual(before.history);
    expect(after.nudges).toEqual(before.nudges);
    expect(after.audits).toHaveLength(before.audits.length + 1);
    expect(after.seats.filter((seat) => seat.gameId !== game.id)).toEqual(
      before.seats.filter((seat) => seat.gameId !== game.id),
    );
  });

  it.each(['cleared', 'removed'])(
    'allows an Overlord whose former seat was %s to transfer',
    async (kind) => {
      if (kind === 'cleared')
        await fixture.db.gamePlayer.update({
          where: { id: 'owner-seat' },
          data: { userId: null, role: 'PLAYER' },
        });
      else await fixture.db.gamePlayer.delete({ where: { id: 'owner-seat' } });
      await mutations.transferHost('game', 'owner', {
        targetPlayerEntryId: 'target-seat',
      });
      expect(
        await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
      ).toMatchObject({ organizerId: 'target', turnRevision: 1 });
      expect(
        JSON.parse((await fixture.db.auditEvent.findFirstOrThrow()).payload),
      ).toMatchObject({
        previousOrganizerEntryId: null,
        previousOrganizerDisplayName: null,
      });
    },
  );

  it('allows external Shadow override without making an external call inside the transaction', async () => {
    let inTransaction = false;
    const transact = fixture.db.$transaction.bind(fixture.db);
    vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
      async (...args) => {
        inTransaction = true;
        try {
          return await transact(...args);
        } finally {
          inTransaction = false;
        }
      },
    );
    const shadow = vi.fn(async () => {
      expect(inTransaction).toBe(false);
      return true;
    });
    const service = new TurnMutationsService(
      fixture.db,
      new TurnRecordsService(),
      { authService: { isUserShadowOverride: shadow } },
    );
    await service.transferHost('game', 'outsider', {
      targetPlayerEntryId: 'target-seat',
    });
    expect(shadow).toHaveBeenCalledOnce();
    expect(await fixture.db.auditEvent.findFirstOrThrow()).toMatchObject({
      actorId: 'outsider',
    });
  });

  it('rejects unauthenticated, unauthorized, absent, empty, foreign and current-owner targets without writes', async () => {
    await fixture.db.game.create({
      data: {
        id: 'other',
        gameNumber: 2,
        slug: 'other',
        name: 'Other',
        organizerId: 'owner',
        players: {
          create: { id: 'foreign-seat', turnOrder: 1, userId: 'target' },
        },
      },
    });
    const before = await persisted();
    await expect(
      mutations.transferHost('game', undefined, {
        targetPlayerEntryId: 'target-seat',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      mutations.transferHost('missing', 'owner', {
        targetPlayerEntryId: 'target-seat',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      mutations.transferHost('game', 'outsider', {
        targetPlayerEntryId: 'target-seat',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    for (const targetPlayerEntryId of [
      'missing',
      'open-seat',
      'foreign-seat',
    ]) {
      await expect(
        mutations.transferHost('game', 'owner', { targetPlayerEntryId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    await expect(
      mutations.transferHost('game', 'owner', {
        targetPlayerEntryId: 'owner-seat',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await persisted()).toEqual(before);
  });

  it('increments on transfer and reversal even though the original owner and roles return', async () => {
    await mutations.transferHost('game', 'owner', {
      targetPlayerEntryId: 'target-seat',
    });
    await mutations.transferHost('game', 'target', {
      targetPlayerEntryId: 'owner-seat',
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ organizerId: 'owner', turnRevision: 2 });
  });

  it.each([
    'target occupant',
    'target role',
    'owner role',
    'seat order',
    'membership',
    'round',
    'owner',
    'revision reversal',
  ])(
    'revalidates %s at admission, including writers without revision support',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persisted>>;
      beforeTransaction(async (other) => {
        if (change === 'target occupant')
          await other.gamePlayer.update({
            where: { id: 'target-seat' },
            data: { userId: 'outsider' },
          });
        if (change === 'target role')
          await other.gamePlayer.update({
            where: { id: 'target-seat' },
            data: { role: 'ORGANIZER' },
          });
        if (change === 'owner role')
          await other.gamePlayer.update({
            where: { id: 'owner-seat' },
            data: { role: 'PLAYER' },
          });
        if (change === 'seat order')
          await other.gamePlayer.update({
            where: { id: 'open-seat' },
            data: { turnOrder: 4 },
          });
        if (change === 'membership')
          await other.gamePlayer.update({
            where: { id: 'open-seat' },
            data: { userId: 'outsider' },
          });
        if (change === 'round')
          await other.turnState.update({
            where: { gameId: 'game' },
            data: { roundNumber: 5 },
          });
        if (change === 'owner')
          await other.game.update({
            where: { id: 'game' },
            data: { organizerId: 'outsider' },
          });
        if (change === 'revision reversal') {
          const competitor = new TurnMutationsService(
            other,
            new TurnRecordsService(),
          );
          await competitor.transferHost('game', 'owner', {
            targetPlayerEntryId: 'target-seat',
          });
          await competitor.transferHost('game', 'target', {
            targetPlayerEntryId: 'owner-seat',
          });
        }
        afterChange = await persisted(other);
      });
      await expect(
        mutations.transferHost('game', 'owner', {
          targetPlayerEntryId: 'target-seat',
        }),
      ).rejects.toBeInstanceOf(
        change === 'owner' ? ForbiddenException : ConflictException,
      );
      expect(await persisted()).toEqual(afterChange!);
    },
  );

  it('rolls back ownership, roles, revision and audit when a late trigger rejects the transfer', async () => {
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_transfer AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'ROSTER_UPDATED'
      AND (SELECT organizerId FROM Game WHERE id = NEW.gameId) = 'target'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT role FROM GamePlayer WHERE id = 'owner-seat') = 'PLAYER'
      AND (SELECT role FROM GamePlayer WHERE id = 'target-seat') = 'ORGANIZER'
      BEGIN SELECT RAISE(ABORT, 'late transfer failure'); END`);
    const before = await persisted();
    await expect(
      mutations.transferHost('game', 'owner', {
        targetPlayerEntryId: 'target-seat',
      }),
    ).rejects.toThrow();
    expect(await persisted(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_transfer');
    await mutations.transferHost('game', 'owner', {
      targetPlayerEntryId: 'target-seat',
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 1 });
  });

  it('transfers ownership and roles with one revision and audit without changing the active turn', async () => {
    const history = await fixture.db.turnRecord.findMany();
    const state = await fixture.db.turnState.findMany();
    expect(
      await mutations.transferHost('ashes', 'owner', {
        targetPlayerEntryId: 'target-seat',
      }),
    ).toEqual({
      gameId: 'game',
      gameNumber: 1,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: 'target',
      organizerDisplayName: 'Alpha',
      player: { displayName: 'Alpha', turnOrder: 3 },
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ organizerId: 'target', turnRevision: 1 });
    expect(
      await fixture.db.gamePlayer.findUniqueOrThrow({
        where: { id: 'owner-seat' },
      }),
    ).toMatchObject({ role: 'PLAYER' });
    expect(
      await fixture.db.gamePlayer.findUniqueOrThrow({
        where: { id: 'target-seat' },
      }),
    ).toMatchObject({ role: 'ORGANIZER' });
    expect(await fixture.db.turnRecord.findMany()).toEqual(history);
    expect(await fixture.db.turnState.findMany()).toEqual(state);
    const audits = await fixture.db.auditEvent.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: 'owner',
      eventType: 'ROSTER_UPDATED',
    });
    expect(JSON.parse(audits[0].payload)).toEqual({
      action: 'host_transferred',
      previousOrganizerEntryId: 'owner-seat',
      previousOrganizerDisplayName: 'Overlord',
      nextOrganizerEntryId: 'target-seat',
      nextOrganizerDisplayName: 'Alpha',
    });
  });
});

describe.each([
  { label: 'seat-count', input: { playerCount: 4 } },
  { label: 'no-op', input: {} },
  { label: 'metadata-only', input: { notes: 'Must not persist' } },
])('$label metadata turn coherence', ({ input }) => {
  it.each(['missing', 'wrong occupant', 'wrong seat', 'wrong round'])(
    'rejects %s open history without committing any changes',
    async (kind) => {
      if (kind === 'missing') await fixture.db.turnRecord.deleteMany();
      else
        await fixture.db.turnRecord.update({
          where: { id: 'turn' },
          data:
            kind === 'wrong occupant'
              ? { userId: 'owner' }
              : kind === 'wrong seat'
                ? { gamePlayerId: 'owner-seat' }
                : { roundNumber: 3 },
        });
      const before = await persisted();
      await expect(
        mutations.updateGameMetadata('game', 'owner', input),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persisted(fixture.connect())).toEqual(before);
    },
  );
});

describe('atomic mixed metadata', () => {
  it('leaves revision unchanged for no-ops, excluded metadata and cap-only corrections', async () => {
    await mutations.updateGameMetadata('game', 'owner', {});
    await mutations.updateGameMetadata('game', 'owner', {
      playerCount: 3,
      roundNumber: 4,
    });
    await mutations.updateGameMetadata('game', 'owner', {
      name: 'New name',
      notes: 'notes',
      gameNumber: 12,
      turnTargetHours: 48,
      hasAiPlayers: true,
      techLevel: 5,
    });
    await fixture.db.game.update({
      where: { id: 'game' },
      data: { playerCount: 4 },
    });
    await mutations.updateGameMetadata('game', 'owner', { playerCount: 3 });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 0 });
    expect(await fixture.db.turnRecord.findMany()).toEqual([
      expect.objectContaining({ startedAt, endedAt: null, roundNumber: 4 }),
    ]);
  });

  it('increments once per round correction and reversal, never closes or restarts the turn', async () => {
    await mutations.updateGameMetadata('game', 'owner', { roundNumber: 5 });
    await mutations.updateGameMetadata('game', 'owner', { roundNumber: 4 });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 2 });
    expect(await fixture.db.turnRecord.findMany()).toEqual([
      expect.objectContaining({
        id: 'turn',
        roundNumber: 4,
        startedAt,
        endedAt: null,
      }),
    ]);
  });

  it('rejects occupied-seat truncation and duplicate campaign numbers atomically', async () => {
    await fixture.db.game.create({
      data: {
        id: 'other',
        gameNumber: 2,
        slug: 'other',
        name: 'Other',
        organizerId: 'owner',
      },
    });
    const before = await persisted();
    await expect(
      mutations.updateGameMetadata('game', 'owner', {
        playerCount: 1,
        roundNumber: 5,
        notes: 'must not persist',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      mutations.updateGameMetadata('game', 'owner', {
        gameNumber: 2,
        playerCount: 4,
        roundNumber: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persisted()).toEqual(before);
  });

  it.each(['missing', 'mismatched'])(
    'rolls back the mixed submission when open history is %s',
    async (kind) => {
      if (kind === 'missing') await fixture.db.turnRecord.deleteMany();
      else
        await fixture.db.turnRecord.update({
          where: { id: 'turn' },
          data: { userId: 'outsider' },
        });
      const before = await persisted();
      await expect(
        mutations.updateGameMetadata('game', 'owner', {
          playerCount: 4,
          roundNumber: 5,
          notes: 'must not persist',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persisted()).toEqual(before);
    },
  );

  it.each([
    'occupancy',
    'order',
    'role',
    'owner',
    'round',
    'cap',
    'round reversal',
  ])(
    'rejects concurrent %s without clobbering the current roster or metadata',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persisted>>;
      beforeTransaction(async (other) => {
        if (change === 'occupancy')
          await other.gamePlayer.update({
            where: { id: 'open-seat' },
            data: { userId: 'outsider' },
          });
        if (change === 'order')
          await other.gamePlayer.update({
            where: { id: 'open-seat' },
            data: { turnOrder: 4 },
          });
        if (change === 'role')
          await other.gamePlayer.update({
            where: { id: 'target-seat' },
            data: { role: 'ORGANIZER' },
          });
        if (change === 'owner')
          await other.game.update({
            where: { id: 'game' },
            data: { organizerId: 'outsider' },
          });
        if (change === 'round')
          await other.turnState.update({
            where: { gameId: 'game' },
            data: { roundNumber: 6 },
          });
        if (change === 'cap')
          await other.game.update({
            where: { id: 'game' },
            data: { playerCount: 4 },
          });
        if (change === 'round reversal') {
          const competitor = new TurnMutationsService(
            other,
            new TurnRecordsService(),
          );
          await competitor.updateGameMetadata('game', 'owner', {
            roundNumber: 5,
          });
          await competitor.updateGameMetadata('game', 'owner', {
            roundNumber: 4,
          });
        }
        afterChange = await persisted(other);
      });
      await expect(
        mutations.updateGameMetadata('game', 'owner', {
          playerCount: 2,
          roundNumber: 5,
          notes: 'must not persist',
          turnTargetHours: 48,
        }),
      ).rejects.toBeInstanceOf(
        change === 'owner' ? ForbiddenException : ConflictException,
      );
      expect(await persisted()).toEqual(afterChange!);
    },
  );

  it('rolls back every mixed effect after metadata, seats, state, history, nudges, audit and revision were written', async () => {
    await fixture.db.turnRecord.create({
      data: {
        id: 'closed-turn',
        gameId: 'game',
        gamePlayerId: 'open-seat',
        userId: 'outsider',
        seatNumber: 2,
        playerDisplayName: 'Former occupant',
        roundNumber: 3,
        startedAt: new Date('2026-08-30T00:00:00.000Z'),
        endedAt: startedAt,
        completionReason: 'RESIGNED',
      },
    });
    await fixture.db.notificationDelivery.create({
      data: {
        id: 'nudge',
        event: 'TURN_NUDGE',
        gameId: 'game',
        gameSlug: 'ashes',
        turnRecordId: 'turn',
        payload: '{}',
      },
    });
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_metadata AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'METADATA_UPDATED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT notes FROM Game WHERE id = NEW.gameId) = 'changed'
      AND (SELECT turnTargetHours FROM Game WHERE id = NEW.gameId) = 48
      AND (SELECT COUNT(*) FROM GamePlayer WHERE gameId = NEW.gameId) = 2
      AND (SELECT roundNumber FROM TurnState WHERE gameId = NEW.gameId) = 5
      AND (SELECT roundNumber FROM TurnRecord WHERE id = 'turn') = 5
      AND (SELECT gamePlayerId FROM TurnRecord WHERE id = 'closed-turn') IS NULL
      AND (SELECT status FROM NotificationDelivery WHERE id = 'nudge') = 'CANCELLED'
      BEGIN SELECT RAISE(ABORT, 'late mixed metadata failure'); END`);
    const before = await persisted();
    await expect(
      mutations.updateGameMetadata('game', 'owner', {
        playerCount: 2,
        roundNumber: 5,
        notes: 'changed',
        turnTargetHours: 48,
      }),
    ).rejects.toThrow();
    expect(await persisted(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_metadata');
    await mutations.updateGameMetadata('game', 'owner', {
      playerCount: 2,
      roundNumber: 5,
      notes: 'changed',
      turnTargetHours: 48,
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 1 });
    expect(
      await fixture.db.turnRecord.findUniqueOrThrow({
        where: { id: 'closed-turn' },
      }),
    ).toMatchObject({
      gamePlayerId: null,
      userId: 'outsider',
      seatNumber: 2,
      playerDisplayName: 'Former occupant',
      endedAt: startedAt,
    });
  });

  it('removes only open seats and fills order gaps on expansion, advancing revision for each reversal', async () => {
    await mutations.updateGameMetadata('game', 'owner', { playerCount: 2 });
    expect(
      await fixture.db.gamePlayer.findMany({ orderBy: { turnOrder: 'asc' } }),
    ).toEqual([
      expect.objectContaining({
        id: 'owner-seat',
        turnOrder: 1,
        userId: 'owner',
      }),
      expect.objectContaining({
        id: 'target-seat',
        turnOrder: 3,
        userId: 'target',
      }),
    ]);
    await mutations.updateGameMetadata('game', 'owner', { playerCount: 3 });
    expect(
      (
        await fixture.db.gamePlayer.findMany({ orderBy: { turnOrder: 'asc' } })
      ).map((seat) => seat.turnOrder),
    ).toEqual([1, 2, 3]);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ turnRevision: 2, playerCount: 3 });
  });

  it('commits seats, corrected round, reminder policy, metadata and audit with one revision', async () => {
    await fixture.db.notificationDelivery.create({
      data: {
        id: 'nudge',
        event: 'TURN_NUDGE',
        gameId: 'game',
        gameSlug: 'ashes',
        turnRecordId: 'turn',
        payload: '{}',
      },
    });
    const response = await mutations.updateGameMetadata('1', 'owner', {
      playerCount: 4,
      roundNumber: 5,
      name: '  New Ashes  ',
      notes: ' note ',
      turnTargetHours: 48,
    });
    expect(response).toMatchObject({
      id: 'game',
      name: 'New Ashes',
      notes: 'note',
      playerCount: 4,
      roundNumber: 5,
      turnTargetHours: 48,
    });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'game' } }),
    ).toMatchObject({ name: 'New Ashes', playerCount: 4, turnRevision: 1 });
    expect(await fixture.db.gamePlayer.count()).toBe(4);
    expect(
      await fixture.db.turnState.findUniqueOrThrow({
        where: { gameId: 'game' },
      }),
    ).toMatchObject({ roundNumber: 5, activePlayerEntryId: 'target-seat' });
    expect(await fixture.db.turnRecord.findMany()).toEqual([
      expect.objectContaining({
        id: 'turn',
        roundNumber: 5,
        startedAt,
        endedAt: null,
        nextReminderAt: new Date('2026-09-03T12:00:00.000Z'),
      }),
    ]);
    expect(
      await fixture.db.notificationDelivery.findUniqueOrThrow({
        where: { id: 'nudge' },
      }),
    ).toMatchObject({ status: 'CANCELLED' });
    const audits = await fixture.db.auditEvent.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: 'owner',
      eventType: 'METADATA_UPDATED',
    });
    expect(JSON.parse(audits[0].payload)).toMatchObject({
      previousMetadata: {
        name: 'Ashes',
        playerCount: 3,
        roundNumber: 4,
        turnTargetHours: 24,
      },
      nextMetadata: {
        name: 'New Ashes',
        playerCount: 4,
        roundNumber: 5,
        turnTargetHours: 48,
      },
    });
  });
});
