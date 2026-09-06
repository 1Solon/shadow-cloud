import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

const replacement = {
  discordThreadId: 'thread-1',
  callerDiscordId: 'discord-2',
  seatNumber: 1,
  newPlayerDiscordId: 'discord-3',
  newPlayerDisplayName: 'Replacement',
};
const resignation = {
  discordThreadId: 'thread-1',
  playerDiscordId: 'discord-1',
};
const startedAt = new Date('2026-09-01T00:00:00.000Z');
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;

beforeEach(async () => {
  fixture = await createSqliteFixture();
  const { db } = fixture;
  for (const [id, displayName] of [
    ['1', 'Alpha'],
    ['2', 'Overlord'],
    ['4', 'Fourth'],
  ]) {
    await db.user.create({
      data: {
        id: `user-${id}`,
        email: `${id}@example.com`,
        displayName,
        identities: {
          create: { provider: 'discord', providerId: `discord-${id}` },
        },
      },
    });
  }
  await db.game.create({
    data: {
      id: 'game-1',
      gameNumber: 1,
      name: 'Ashes',
      slug: 'ashes',
      discordThreadId: 'thread-1',
      organizerId: 'user-2',
      playerCount: 5,
      players: {
        create: [
          { id: 'seat-open', turnOrder: 1 },
          { id: 'seat-1', userId: 'user-1', turnOrder: 2 },
          { id: 'seat-2', userId: 'user-2', turnOrder: 3, role: 'ORGANIZER' },
          { id: 'seat-4', userId: 'user-4', turnOrder: 4 },
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
          seatNumber: 2,
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

async function persistedState(db = fixture.db) {
  return {
    games: await db.game.findMany({ orderBy: { id: 'asc' } }),
    seats: await db.gamePlayer.findMany({ orderBy: { id: 'asc' } }),
    turns: await db.turnState.findMany({ orderBy: { id: 'asc' } }),
    history: await db.turnRecord.findMany({ orderBy: { id: 'asc' } }),
    reminders: await db.notificationDelivery.findMany({
      orderBy: { id: 'asc' },
    }),
    audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    identities: await db.authIdentity.findMany({ orderBy: { id: 'asc' } }),
  };
}

function beforeTransaction(action: (other: PrismaClient) => Promise<unknown>) {
  const other = fixture.connect();
  const transact = fixture.db.$transaction.bind(fixture.db);
  // Control admission only; all transaction operations and rollback use SQLite.
  vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
    async (...args) => {
      await action(other);
      return transact(...args);
    },
  );
}

async function seedDeliveries() {
  for (const status of [
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED',
  ] as const) {
    await fixture.db.notificationDelivery.create({
      data: {
        id: status,
        event: 'TURN_NUDGE',
        status,
        gameId: 'game-1',
        gameSlug: 'ashes',
        turnRecordId: 'turn-1',
        payload: '{}',
        processingStartedAt: startedAt,
      },
    });
  }
  await fixture.db.notificationDelivery.create({
    data: {
      id: 'other-event',
      event: 'SAVE_UPLOADED',
      gameId: 'game-1',
      gameSlug: 'ashes',
      turnRecordId: 'turn-1',
      payload: '{}',
    },
  });
  await fixture.db.turnRecord.create({
    data: {
      id: 'old-turn',
      gameId: 'game-1',
      roundNumber: 3,
      playerDisplayName: 'Fourth',
      startedAt,
      endedAt: startedAt,
    },
  });
  await fixture.db.notificationDelivery.create({
    data: {
      id: 'other-turn',
      event: 'TURN_NUDGE',
      gameId: 'game-1',
      gameSlug: 'ashes',
      turnRecordId: 'old-turn',
      payload: '{}',
    },
  });
}

describe('membership intentions through real SQLite', () => {
  describe.each(['replace', 'resign'] as const)(
    'inactive %s history proof',
    (operation) => {
      it.each(['missing', 'wrong occupant', 'wrong seat', 'wrong round'])(
        'rolls back when current history becomes %s during admission',
        async (invalid) => {
          await seedDeliveries();
          let afterChange: Awaited<ReturnType<typeof persistedState>>;
          beforeTransaction(async (other) => {
            if (invalid === 'missing') {
              await other.turnRecord.delete({ where: { id: 'turn-1' } });
            } else {
              await other.turnRecord.update({
                where: { id: 'turn-1' },
                data:
                  invalid === 'wrong occupant'
                    ? { userId: 'user-4' }
                    : invalid === 'wrong seat'
                      ? { gamePlayerId: 'seat-4' }
                      : { roundNumber: 5 },
              });
            }
            afterChange = await persistedState(other);
          });
          await expect(
            operation === 'replace'
              ? mutations.replacePlayerInSeat({ ...replacement, seatNumber: 3 })
              : mutations.resignPlayerFromDiscord({
                  ...resignation,
                  playerDiscordId: 'discord-2',
                }),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(await persistedState(fixture.connect())).toEqual(afterChange!);
        },
      );
    },
  );

  it('rejects replacement by the former Overlord as forbidden after a competing transfer commits', async () => {
    let afterTransfer: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      const competing = new TurnMutationsService(
        other,
        new TurnRecordsService(),
      );
      await competing.transferHost('game-1', 'user-2', {
        targetPlayerEntryId: 'seat-4',
      });
      afterTransfer = await persistedState(other);
      expect(afterTransfer.games[0]).toMatchObject({
        organizerId: 'user-4',
        turnRevision: 1,
      });
    });
    await expect(
      mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await persistedState(fixture.connect())).toEqual(afterTransfer!);
  });

  it.each([2, 3])(
    'preserves duplicate replacement rejection, including the same seat, for target %s',
    async (seatNumber) => {
      const before = await persistedState();
      await expect(
        mutations.replacePlayerInSeat({
          ...replacement,
          seatNumber,
          newPlayerDiscordId: 'discord-1',
          newPlayerDisplayName: 'Must not rename',
        }),
      ).rejects.toThrow('This player is already in another seat in this game.');
      expect(await persistedState()).toEqual(before);
    },
  );

  it.each(['membership', 'identity', 'email fallback'])(
    'rechecks duplicate replacement membership after admission changes to %s',
    async (change) => {
      await fixture.db.user.create({
        data: {
          id: 'user-3',
          email: 'discord-3@discord.shadow-cloud.local',
          displayName: 'Before',
          ...(change === 'membership'
            ? {
                identities: {
                  create: { provider: 'discord', providerId: 'discord-3' },
                },
              }
            : {}),
        },
      });
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'identity')
          await other.authIdentity.create({
            data: {
              provider: 'discord',
              providerId: 'discord-3',
              userId: 'user-4',
            },
          });
        else
          await other.gamePlayer.update({
            where: { id: 'seat-open' },
            data: { userId: 'user-3' },
          });
        afterChange = await persistedState(other);
      });
      await expect(
        mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 }),
      ).rejects.toThrow('This player is already in another seat in this game.');
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it('rejects a replacement identity remapped to a different eligible user during admission', async () => {
    for (const id of ['3', '5'])
      await fixture.db.user.create({
        data: {
          id: `user-${id}`,
          email: `${id}@example.com`,
          displayName: id,
        },
      });
    await fixture.db.authIdentity.create({
      data: { provider: 'discord', providerId: 'discord-3', userId: 'user-3' },
    });
    let afterChange: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      await other.authIdentity.update({
        where: {
          provider_providerId: { provider: 'discord', providerId: 'discord-3' },
        },
        data: { userId: 'user-5' },
      });
      afterChange = await persistedState(other);
    });
    await expect(
      mutations.replacePlayerInSeat(replacement),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(afterChange!);
  });

  it.each(['replace', 'resign'])(
    'rejects changed inactive target membership before %s, even when the active player is unchanged',
    async (operation) => {
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        await other.gamePlayer.update({
          where: { id: 'seat-2' },
          data: { userId: 'user-4' },
        });
        afterChange = await persistedState(other);
      });
      await expect(
        operation === 'replace'
          ? mutations.replacePlayerInSeat({ ...replacement, seatNumber: 3 })
          : mutations.resignPlayerFromDiscord({
              ...resignation,
              playerDiscordId: 'discord-2',
            }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it.each([1, 5])(
    'fills open or absent seat %s without a baseline, timing changes, or ownership transfer',
    async (seatNumber) => {
      await seedDeliveries();
      const before = await persistedState();
      expect(
        await mutations.replacePlayerInSeat({ ...replacement, seatNumber }),
      ).toMatchObject({
        player: { turnOrder: seatNumber, tookActiveTurn: false },
      });
      const after = await persistedState();
      expect(after.games[0]).toMatchObject({
        turnRevision: 1,
        organizerId: 'user-2',
        playerCount: 5,
      });
      expect(after.turns).toEqual(before.turns);
      expect(after.history).toEqual(before.history);
      expect(after.reminders).toEqual(before.reminders);
      expect(
        after.seats.find((seat) => seat.turnOrder === seatNumber)?.userId,
      ).toBe(after.audits[0].actorId);
    },
  );

  it.each(['replace', 'resign'])(
    'allows %s before turn initialization without creating history',
    async (operation) => {
      await fixture.db.turnRecord.deleteMany();
      await fixture.db.turnState.deleteMany();
      if (operation === 'replace')
        await mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 });
      else await mutations.resignPlayerFromDiscord(resignation);
      const after = await persistedState();
      expect(after.games[0].turnRevision).toBe(1);
      expect(after.turns).toEqual([]);
      expect(after.history).toEqual([]);
      expect(after.audits).toHaveLength(1);
    },
  );

  it('protects the last occupied seat without changing revision or timing', async () => {
    await fixture.db.gamePlayer.updateMany({
      where: { id: { in: ['seat-2', 'seat-4'] } },
      data: { userId: null },
    });
    const before = await persistedState();
    await expect(
      mutations.resignPlayerFromDiscord(resignation),
    ).rejects.toThrow(
      'Cannot resign when you are the only active player in the game.',
    );
    expect(await persistedState()).toEqual(before);
  });

  it('wraps active resignation to the first occupied seat without advancing the round', async () => {
    await fixture.db.turnState.update({
      where: { gameId: 'game-1' },
      data: { activePlayerId: 'user-4', activePlayerEntryId: 'seat-4' },
    });
    await fixture.db.turnRecord.update({
      where: { id: 'turn-1' },
      data: {
        gamePlayerId: 'seat-4',
        userId: 'user-4',
        seatNumber: 4,
        playerDisplayName: 'Fourth',
      },
    });
    await mutations.resignPlayerFromDiscord({
      ...resignation,
      playerDiscordId: 'discord-4',
    });
    const after = await persistedState();
    expect(after.turns[0]).toMatchObject({
      activePlayerId: 'user-1',
      activePlayerEntryId: 'seat-1',
      roundNumber: 4,
    });
    expect(after.history.find((turn) => turn.endedAt === null)).toMatchObject({
      gamePlayerId: 'seat-1',
      roundNumber: 4,
    });
    expect(after.games[0].turnRevision).toBe(1);
  });

  it('preserves missing campaign, absent membership, unauthorized caller, and seat-limit errors without writes', async () => {
    const before = await persistedState();
    await expect(
      mutations.replacePlayerInSeat({
        ...replacement,
        discordThreadId: 'missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      mutations.resignPlayerFromDiscord({
        ...resignation,
        discordThreadId: 'missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      mutations.resignPlayerFromDiscord({
        ...resignation,
        playerDiscordId: 'unknown',
      }),
    ).rejects.toThrow('Player is not registered in this game.');
    await expect(
      mutations.replacePlayerInSeat({
        ...replacement,
        callerDiscordId: 'discord-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      mutations.replacePlayerInSeat({ ...replacement, seatNumber: 6 }),
    ).rejects.toThrow("Seat 6 exceeds this game's seat limit.");
    expect(await persistedState()).toEqual(before);
  });

  describe.each(['replace', 'resign'] as const)(
    '%s admission proof',
    (operation) => {
      const execute = () =>
        operation === 'replace'
          ? mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 })
          : mutations.resignPlayerFromDiscord(resignation);

      it('resolves a unique legacy active occupant and uses current reminder policy without rejecting cosmetic edits', async () => {
        await fixture.db.turnState.update({
          where: { gameId: 'game-1' },
          data: { activePlayerEntryId: null },
        });
        beforeTransaction(async (other) => {
          await other.game.update({
            where: { id: 'game-1' },
            data: { turnRemindersEnabled: false, notes: 'New notes' },
          });
          await other.user.update({
            where: { id: 'user-2' },
            data: { displayName: 'Renamed Overlord' },
          });
        });
        await execute();
        const state = await persistedState();
        const open = state.history.find((turn) => turn.endedAt === null)!;
        expect(open).toMatchObject({
          nextReminderAt: null,
          roundNumber: 4,
          playerDisplayName:
            operation === 'replace' ? 'Replacement' : 'Renamed Overlord',
        });
        expect(state.turns[0].activePlayerEntryId).toBe(
          operation === 'replace' ? 'seat-1' : 'seat-2',
        );
        expect(state.games[0].turnRevision).toBe(1);
      });

      it('does not retry SQLite contention or report it as a confirmed stale intent', async () => {
        const other = fixture.connect();
        const locked = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const writer = other.$transaction(async (transaction) => {
          await transaction.game.update({
            where: { id: 'game-1' },
            data: { notes: 'Concurrent edit' },
          });
          locked.resolve();
          await release.promise;
        });
        void writer.catch(locked.reject);
        await locked.promise;
        try {
          const error = await execute().then(
            () => null,
            (error: unknown) => error,
          );
          expect(error).toBeInstanceOf(Error);
          expect(error).not.toBeInstanceOf(ConflictException);
        } finally {
          release.resolve();
          await writer;
        }
        const state = await persistedState();
        expect(state.games[0]).toMatchObject({
          turnRevision: 0,
          notes: 'Concurrent edit',
        });
        expect(state.turns[0].activePlayerEntryId).toBe('seat-1');
        expect(state.history).toHaveLength(1);
        expect(state.audits).toEqual([]);
        expect(
          state.identities.some(
            (identity) => identity.providerId === 'discord-3',
          ),
        ).toBe(false);
      });

      it.each([
        'active occupant',
        'active selection',
        'round',
        'successor occupant',
        'successor order',
        'inserted successor',
        'target order',
        'revision',
      ])(
        'rejects changed %s without overwriting the admitted state',
        async (change) => {
          if (change === 'inserted successor') {
            await fixture.db.gamePlayer.update({
              where: { id: 'seat-2' },
              data: { turnOrder: 5 },
            });
            await fixture.db.gamePlayer.update({
              where: { id: 'seat-open' },
              data: { turnOrder: 3 },
            });
            await fixture.db.user.create({
              data: {
                id: 'user-5',
                email: '5@example.com',
                displayName: 'Fifth',
              },
            });
          }
          let afterChange: Awaited<ReturnType<typeof persistedState>>;
          beforeTransaction(async (other) => {
            if (change === 'active occupant')
              await other.gamePlayer.update({
                where: { id: 'seat-1' },
                data: { userId: 'user-4' },
              });
            if (change === 'active selection')
              await other.turnState.update({
                where: { gameId: 'game-1' },
                data: {
                  activePlayerId: 'user-4',
                  activePlayerEntryId: 'seat-4',
                },
              });
            if (change === 'round')
              await other.turnState.update({
                where: { gameId: 'game-1' },
                data: { roundNumber: 5 },
              });
            if (change === 'successor occupant')
              await other.gamePlayer.update({
                where: { id: 'seat-2' },
                data: { userId: null },
              });
            if (change === 'successor order')
              await other.gamePlayer.update({
                where: { id: 'seat-2' },
                data: { turnOrder: 5 },
              });
            if (change === 'inserted successor') {
              await other.gamePlayer.update({
                where: { id: 'seat-open' },
                data: { userId: 'user-5' },
              });
            }
            if (change === 'target order')
              await other.gamePlayer.update({
                where: { id: 'seat-1' },
                data: { turnOrder: 5 },
              });
            if (change === 'revision')
              await other.game.update({
                where: { id: 'game-1' },
                data: { turnRevision: { increment: 2 } },
              });
            afterChange = await persistedState(other);
          });
          await expect(execute()).rejects.toBeInstanceOf(ConflictException);
          expect(await persistedState()).toEqual(afterChange!);
        },
      );

      it('reads participant proof after the revision fence, not before it', async () => {
        await fixture.db
          .$executeRawUnsafe(`CREATE TRIGGER change_at_fence AFTER UPDATE OF turnRevision ON Game
        WHEN NEW.turnRevision = 1
        BEGIN UPDATE GamePlayer SET userId = NULL WHERE id = 'seat-2'; END`);
        const before = await persistedState();
        await expect(execute()).rejects.toBeInstanceOf(ConflictException);
        expect(await persistedState()).toEqual(before);
      });

      it.each([
        'missing history',
        'mismatched history',
        'mismatched occupant',
        'empty active seat',
        'foreign active seat',
      ])('rejects %s atomically', async (invalid) => {
        if (invalid === 'missing history')
          await fixture.db.turnRecord.deleteMany();
        if (invalid === 'mismatched history')
          await fixture.db.turnRecord.update({
            where: { id: 'turn-1' },
            data: { userId: 'user-2' },
          });
        if (invalid === 'mismatched occupant')
          await fixture.db.turnState.update({
            where: { gameId: 'game-1' },
            data: { activePlayerId: 'user-2' },
          });
        if (invalid === 'empty active seat')
          await fixture.db.turnState.update({
            where: { gameId: 'game-1' },
            data: { activePlayerEntryId: 'seat-open' },
          });
        if (invalid === 'foreign active seat') {
          await fixture.db.game.create({
            data: {
              gameNumber: 2,
              name: 'Other',
              slug: 'other',
              organizerId: 'user-2',
              players: {
                create: { id: 'foreign-seat', userId: 'user-1', turnOrder: 1 },
              },
            },
          });
          await fixture.db.turnState.update({
            where: { gameId: 'game-1' },
            data: { activePlayerEntryId: 'foreign-seat' },
          });
        }
        const before = await persistedState();
        await expect(execute()).rejects.toBeInstanceOf(ConflictException);
        expect(await persistedState()).toEqual(before);
      });
    },
  );

  it.each(['owner', 'caller identity', 'deleted caller'])(
    'rechecks replacement authorization after changed %s',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'owner')
          await other.game.update({
            where: { id: 'game-1' },
            data: { organizerId: 'user-1' },
          });
        else if (change === 'caller identity')
          await other.authIdentity.update({
            where: {
              provider_providerId: {
                provider: 'discord',
                providerId: 'discord-2',
              },
            },
            data: { userId: 'user-1' },
          });
        else
          await other.authIdentity.delete({
            where: {
              provider_providerId: {
                provider: 'discord',
                providerId: 'discord-2',
              },
            },
          });
        afterChange = await persistedState(other);
      });
      await expect(
        mutations.replacePlayerInSeat(replacement),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it.each(['rebound', 'deleted'])(
    'rejects resignation after the caller identity is %s',
    async (change) => {
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        const where = {
          provider_providerId: { provider: 'discord', providerId: 'discord-1' },
        };
        if (change === 'deleted') await other.authIdentity.delete({ where });
        else
          await other.authIdentity.update({
            where,
            data: { userId: 'user-2' },
          });
        afterChange = await persistedState(other);
      });
      await expect(
        mutations.resignPlayerFromDiscord(resignation),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it.each(['replace', 'resign'])(
    '%s cancels only pending nudges belonging to the completed turn',
    async (operation) => {
      await seedDeliveries();
      const before = await persistedState();
      if (operation === 'replace')
        await mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 });
      else await mutations.resignPlayerFromDiscord(resignation);
      const after = await persistedState();
      expect(
        after.reminders.find((delivery) => delivery.id === 'PENDING'),
      ).toMatchObject({
        status: 'CANCELLED',
        processingStartedAt: null,
      });
      expect(
        after.reminders.filter((delivery) => delivery.id !== 'PENDING'),
      ).toEqual(
        before.reminders.filter((delivery) => delivery.id !== 'PENDING'),
      );
    },
  );

  it.each(['new user', 'existing identity', 'existing email'])(
    'rolls back replacement after all coupled writes, including %s changes',
    async (identityState) => {
      await seedDeliveries();
      if (identityState !== 'new user') {
        await fixture.db.user.create({
          data: {
            id: 'user-3',
            email: 'discord-3@discord.shadow-cloud.local',
            displayName: 'Before',
            ...(identityState === 'existing identity'
              ? {
                  identities: {
                    create: { provider: 'discord', providerId: 'discord-3' },
                  },
                }
              : {}),
          },
        });
      }
      await fixture.db
        .$executeRawUnsafe(`CREATE TRIGGER fail_replace AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'PLAYER_REPLACED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT userId FROM GamePlayer WHERE id = 'seat-1') = NEW.actorId
      AND (SELECT activePlayerId FROM TurnState WHERE gameId = NEW.gameId) = NEW.actorId
      AND (SELECT displayName FROM User WHERE id = NEW.actorId) = 'Replacement'
      AND (SELECT userId FROM AuthIdentity WHERE providerId = 'discord-3') = NEW.actorId
      AND (SELECT status FROM NotificationDelivery WHERE id = 'PENDING') = 'CANCELLED'
      AND EXISTS (SELECT 1 FROM TurnRecord WHERE userId = NEW.actorId AND endedAt IS NULL)
      AND (SELECT completionReason FROM TurnRecord WHERE id = 'turn-1') = 'REPLACED'
      BEGIN SELECT RAISE(ABORT, 'late replacement failure'); END`);
      const before = await persistedState();
      await expect(
        mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 }),
      ).rejects.toThrow();
      expect(await persistedState(fixture.connect())).toEqual(before);
      await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_replace');
      await mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 });
      expect((await persistedState()).games[0].turnRevision).toBe(1);
    },
  );

  it('rolls back active Overlord resignation after roster, history, nudges, audit and revision writes', async () => {
    await seedDeliveries();
    await fixture.db.game.update({
      where: { id: 'game-1' },
      data: { organizerId: 'user-1' },
    });
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-1' },
      data: { role: 'ORGANIZER' },
    });
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-2' },
      data: { role: 'PLAYER' },
    });
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_resign AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'PLAYER_RESIGNED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT organizerId FROM Game WHERE id = NEW.gameId) = 'user-1'
      AND (SELECT userId FROM GamePlayer WHERE id = 'seat-1') IS NULL
      AND (SELECT role FROM GamePlayer WHERE id = 'seat-1') = 'PLAYER'
      AND (SELECT activePlayerEntryId FROM TurnState WHERE gameId = NEW.gameId) = 'seat-2'
      AND (SELECT status FROM NotificationDelivery WHERE id = 'PENDING') = 'CANCELLED'
      AND EXISTS (SELECT 1 FROM TurnRecord WHERE gamePlayerId = 'seat-2' AND endedAt IS NULL)
      AND (SELECT completionReason FROM TurnRecord WHERE id = 'turn-1') = 'RESIGNED'
      BEGIN SELECT RAISE(ABORT, 'late resignation failure'); END`);
    const before = await persistedState();
    await expect(
      mutations.resignPlayerFromDiscord(resignation),
    ).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_resign');
    expect(await mutations.resignPlayerFromDiscord(resignation)).toMatchObject({
      player: { wasOrganizer: true },
    });
    expect((await persistedState()).games[0]).toMatchObject({
      turnRevision: 1,
      organizerId: 'user-1',
    });
  });

  it('rejects an ambiguous resigning membership instead of advancing to another seat for the same player', async () => {
    await fixture.db.gamePlayer.update({
      where: { id: 'seat-2' },
      data: { userId: 'user-1' },
    });
    const before = await persistedState();
    await expect(
      mutations.resignPlayerFromDiscord(resignation),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(before);
  });

  it.each(['replace', 'resign'])(
    'keeps the Overlord owner and every timer unchanged for inactive %s',
    async (operation) => {
      await seedDeliveries();
      const before = await persistedState();
      if (operation === 'replace') {
        expect(
          await mutations.replacePlayerInSeat({
            ...replacement,
            seatNumber: 3,
          }),
        ).toMatchObject({
          player: { tookActiveTurn: false },
        });
      } else {
        expect(
          await mutations.resignPlayerFromDiscord({
            ...resignation,
            playerDiscordId: 'discord-2',
          }),
        ).toMatchObject({
          player: { wasOrganizer: true },
        });
      }
      const after = await persistedState();
      expect(after.games[0]).toMatchObject({
        organizerId: 'user-2',
        turnRevision: 1,
      });
      expect(after.turns).toEqual(before.turns);
      expect(after.history).toEqual(before.history);
      expect(after.reminders).toEqual(before.reminders);
      expect(after.audits).toHaveLength(1);
      if (operation === 'resign') {
        expect(after.seats.find((seat) => seat.id === 'seat-2')).toMatchObject({
          userId: null,
          role: 'PLAYER',
        });
        // Ownership, not the old occupied seat or role, continues to authorize.
        await mutations.replacePlayerInSeat({ ...replacement, seatNumber: 3 });
        expect((await persistedState()).games[0]).toMatchObject({
          organizerId: 'user-2',
          turnRevision: 2,
        });
      }
    },
  );

  it('resigns the active player into the next occupied seat, ignoring open-seat indexes and retaining the round', async () => {
    expect(await mutations.resignPlayerFromDiscord(resignation)).toEqual({
      gameId: 'game-1',
      slug: 'ashes',
      name: 'Ashes',
      player: { displayName: 'Alpha', turnOrder: 2, wasOrganizer: false },
    });
    const state = await persistedState();
    expect(state.games[0]).toMatchObject({
      turnRevision: 1,
      organizerId: 'user-2',
    });
    expect(state.seats.find((seat) => seat.id === 'seat-1')).toMatchObject({
      userId: null,
      turnOrder: 2,
    });
    expect(state.turns[0]).toMatchObject({
      activePlayerEntryId: 'seat-2',
      activePlayerId: 'user-2',
      roundNumber: 4,
    });
    expect(state.history).toHaveLength(2);
    const open = state.history.find((turn) => turn.endedAt === null)!;
    expect(open).toMatchObject({
      gamePlayerId: 'seat-2',
      userId: 'user-2',
      roundNumber: 4,
      playerDisplayName: 'Overlord',
    });
    expect(state.history.find((turn) => turn.id === 'turn-1')).toMatchObject({
      endedAt: open.startedAt,
      completionReason: 'RESIGNED',
      nextReminderAt: null,
      startedAt,
    });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: 'user-1',
      eventType: 'PLAYER_RESIGNED',
    });
    expect(JSON.parse(state.audits[0].payload)).toEqual({
      playerDiscordId: 'discord-1',
      playerDisplayName: 'Alpha',
      playerEntryId: 'seat-1',
      turnOrder: 2,
      wasOrganizer: false,
      turnAdvanced: true,
    });
  });

  it('replaces the active occupant with a distinct timed turn in the same seat and round', async () => {
    expect(
      await mutations.replacePlayerInSeat({ ...replacement, seatNumber: 2 }),
    ).toEqual({
      gameId: 'game-1',
      slug: 'ashes',
      name: 'Ashes',
      player: {
        displayName: 'Replacement',
        turnOrder: 2,
        tookActiveTurn: true,
      },
    });
    const state = await persistedState();
    const newUser = state.identities.find(
      (identity) => identity.providerId === 'discord-3',
    )!.userId;
    expect(state.games[0]).toMatchObject({
      turnRevision: 1,
      organizerId: 'user-2',
    });
    expect(state.seats.find((seat) => seat.id === 'seat-1')).toMatchObject({
      userId: newUser,
    });
    expect(state.turns[0]).toMatchObject({
      activePlayerEntryId: 'seat-1',
      activePlayerId: newUser,
      roundNumber: 4,
    });
    expect(state.history).toHaveLength(2);
    const open = state.history.find((turn) => turn.endedAt === null)!;
    expect(open).toMatchObject({
      gamePlayerId: 'seat-1',
      userId: newUser,
      roundNumber: 4,
      playerDisplayName: 'Replacement',
    });
    expect(open.id).not.toBe('turn-1');
    expect(state.history.find((turn) => turn.id === 'turn-1')).toMatchObject({
      endedAt: open.startedAt,
      completionReason: 'REPLACED',
      nextReminderAt: null,
      startedAt,
    });
    expect(open.nextReminderAt!.getTime() - open.startedAt.getTime()).toBe(
      36 * 60 * 60 * 1000,
    );
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      actorId: newUser,
      eventType: 'PLAYER_REPLACED',
    });
    expect(JSON.parse(state.audits[0].payload)).toEqual({
      seatNumber: 2,
      seatEntryId: 'seat-1',
      newPlayerDiscordId: 'discord-3',
      newPlayerDisplayName: 'Replacement',
      tookActiveTurn: true,
    });
  });
});
