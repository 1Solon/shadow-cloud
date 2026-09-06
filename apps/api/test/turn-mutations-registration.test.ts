import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { GamesRegistrationService } from '../src/games/services/games-registration.service';
import { createSqliteFixture } from './support/sqlite-fixture';

// Route the legacy caller's singleton to the same real migrated database.
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));

const initialization = {
  gameNumber: 15,
  name: 'Ashes',
  playerCount: 3,
  organizerDiscordId: 'overlord-discord',
  organizerDisplayName: 'Overlord',
  organizerUsername: 'overlord',
  discordGuildId: 'guild',
  discordChannelId: 'channel',
  discordThreadId: 'thread',
  turnTargetHours: 6,
  turnReminderGraceHours: 2,
  turnReminderRepeatHours: 4,
};
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let mutations: TurnMutationsService;
const notifyGameInitialized = vi.fn();

beforeEach(async () => {
  fixture = await createSqliteFixture();
  notifyGameInitialized.mockReset();
  mutations = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    botNotifications: {
      notifyGameInitialized,
      notifySaveUploaded: vi.fn(),
      notifyThreadRenamed: vi.fn(),
    },
  });
});

afterEach(async () => {
  await fixture?.close();
});

async function persistedState(db = fixture.db) {
  return {
    games: await db.game.findMany({ orderBy: { id: 'asc' } }),
    users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    identities: await db.authIdentity.findMany({ orderBy: { id: 'asc' } }),
    seats: await db.gamePlayer.findMany({ orderBy: { id: 'asc' } }),
    states: await db.turnState.findMany({ orderBy: { id: 'asc' } }),
    history: await db.turnRecord.findMany({ orderBy: { id: 'asc' } }),
    reminders: await db.notificationDelivery.findMany({
      orderBy: { id: 'asc' },
    }),
    requests: await db.registrationRequest.findMany({ orderBy: { id: 'asc' } }),
    audits: await db.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  };
}

async function pendingRequest(
  gameId: string,
  playerDiscordId = 'player-discord',
) {
  return fixture.db.registrationRequest.create({
    data: {
      gameId,
      playerDiscordId,
      playerDisplayName: 'Player',
      playerUsername: 'player-name',
      discordMessageId: 'original-message',
    },
  });
}

function beforeTransaction(action: (other: PrismaClient) => Promise<unknown>) {
  const other = fixture.connect();
  const transact = fixture.db.$transaction.bind(fixture.db);
  // Control admission only; all domain reads, writes and rollback stay real.
  vi.spyOn(fixture.db, '$transaction').mockImplementationOnce(
    async (...args) => {
      await action(other);
      return transact(...args);
    },
  );
}

describe('atomic registration through real SQLite', () => {
  it('preserves rejection authorization, missing and consumed errors and the original message when omitted', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    const before = await persistedState();
    for (const approver of [undefined, 'unknown-discord']) {
      await expect(
        mutations.rejectRegistrationRequest(
          request.id,
          'rejection-message',
          approver,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState()).toEqual(before);
    }
    await expect(
      mutations.rejectRegistrationRequest(
        'missing',
        undefined,
        'overlord-discord',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await persistedState()).toEqual(before);
    await mutations.rejectRegistrationRequest(
      request.id,
      undefined,
      'overlord-discord',
    );
    const rejected = await persistedState();
    expect(rejected.requests[0]).toMatchObject({
      status: 'REJECTED',
      discordMessageId: 'original-message',
    });
    expect(rejected.games).toEqual(before.games);
    await expect(
      mutations.rejectRegistrationRequest(
        request.id,
        'second-message',
        'overlord-discord',
      ),
    ).rejects.toThrow(
      `Registration request ${request.id} has already been rejected.`,
    );
    expect(await persistedState()).toEqual(rejected);
  });

  it.each(['owner', 'identity'])(
    'revalidates changed local %s authority before committing rejection',
    async (change) => {
      const game = await mutations.createGameFromDiscordInit(initialization);
      const request = await pendingRequest(game.id);
      const otherOwner = await fixture.db.user.create({
        data: { email: 'other@example.com', displayName: 'Other' },
      });
      let changed: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'owner') {
          await other.game.update({
            where: { id: game.id },
            data: { organizerId: otherOwner.id },
          });
        } else {
          await other.authIdentity.update({
            where: {
              provider_providerId: {
                provider: 'discord',
                providerId: 'overlord-discord',
              },
            },
            data: { userId: otherOwner.id },
          });
        }
        changed = await persistedState(other);
      });
      await expect(
        mutations.rejectRegistrationRequest(
          request.id,
          'rejection-message',
          'overlord-discord',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState(fixture.connect())).toEqual(changed!);
    },
  );

  it.each([
    'missing',
    'mismatched round',
    'mismatched seat',
    'mismatched occupant',
  ])(
    'rejects approval against %s initialized history without any surviving changes',
    async (history) => {
      const game = await mutations.createGameFromDiscordInit(initialization);
      const request = await pendingRequest(game.id);
      if (history === 'missing') {
        await fixture.db.turnRecord.deleteMany({ where: { gameId: game.id } });
      } else if (history === 'mismatched round') {
        await fixture.db.turnRecord.updateMany({
          where: { gameId: game.id },
          data: { roundNumber: 2 },
        });
      } else if (history === 'mismatched seat') {
        const vacant = await fixture.db.gamePlayer.findFirstOrThrow({
          where: { gameId: game.id, userId: null },
        });
        await fixture.db.turnRecord.updateMany({
          where: { gameId: game.id },
          data: { gamePlayerId: vacant.id },
        });
      } else {
        await fixture.db.turnRecord.updateMany({
          where: { gameId: game.id },
          data: { userId: null },
        });
      }
      const before = await persistedState();
      await expect(
        mutations.approveRegistrationRequest(
          request.id,
          'approval-message',
          'overlord-discord',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState(fixture.connect())).toEqual(before);
    },
  );

  it('rolls back request status, response time and message when the rejection audit fails late', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_rejection AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'REGISTRATION_REJECTED'
      AND (SELECT COUNT(*) FROM RegistrationRequest WHERE gameId = NEW.gameId
        AND status = 'REJECTED' AND discordMessageId = 'rejection-message' AND respondedAt IS NOT NULL) = 1
      BEGIN SELECT RAISE(ABORT, 'injected failure after rejection audit'); END`);
    const before = await persistedState();
    await expect(
      mutations.rejectRegistrationRequest(
        request.id,
        'rejection-message',
        'overlord-discord',
      ),
    ).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_rejection');
    expect(
      await mutations.rejectRegistrationRequest(
        request.id,
        'rejection-message',
        'overlord-discord',
      ),
    ).toEqual({
      gameId: game.id,
      slug: 'ashes',
      name: 'Ashes',
      player: { displayName: 'Player', discordId: 'player-discord' },
    });
    const after = await persistedState();
    expect(after.requests[0]).toMatchObject({
      status: 'REJECTED',
      discordMessageId: 'rejection-message',
      respondedAt: expect.any(Date),
    });
    expect(after.games).toEqual(before.games);
    expect(after.seats).toEqual(before.seats);
    expect(after.history).toEqual(before.history);
    const audit = after.audits.find(
      (audit) => audit.eventType === 'REGISTRATION_REJECTED',
    )!;
    expect(audit.actorId).toBeNull();
    expect(JSON.parse(audit.payload)).toEqual({
      requestId: request.id,
      playerDiscordId: 'player-discord',
      playerDisplayName: 'Player',
    });
  });

  it('rejects approval when rejection wins without changing its message, audit or revision', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    let rejected: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      await new TurnMutationsService(
        other,
        new TurnRecordsService(),
      ).rejectRegistrationRequest(
        request.id,
        'rejection-message',
        'overlord-discord',
      );
      rejected = await persistedState(other);
    });
    await expect(
      mutations.approveRegistrationRequest(
        request.id,
        'approval-message',
        'overlord-discord',
      ),
    ).rejects.toThrow(
      `Registration request ${request.id} has already been rejected.`,
    );
    expect(await persistedState()).toEqual(rejected!);
    expect(rejected!.games[0].turnRevision).toBe(0);
    expect(rejected!.users).toHaveLength(1);
  });

  it('commits only one decision when approval and rejection run simultaneously on separate connections', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    const competitor = new TurnMutationsService(
      fixture.connect(),
      new TurnRecordsService(),
    );
    const outcomes = await Promise.allSettled([
      mutations.approveRegistrationRequest(
        request.id,
        'approval-message',
        'overlord-discord',
      ),
      competitor.rejectRegistrationRequest(
        request.id,
        'rejection-message',
        'overlord-discord',
      ),
    ]);
    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const after = await persistedState(fixture.connect());
    const approved = outcomes[0].status === 'fulfilled';
    expect(after.requests[0]).toMatchObject({
      status: approved ? 'APPROVED' : 'REJECTED',
      discordMessageId: approved ? 'approval-message' : 'rejection-message',
    });
    expect(after.games[0].turnRevision).toBe(approved ? 1 : 0);
    expect(after.seats.filter((seat) => seat.userId != null)).toHaveLength(
      approved ? 2 : 1,
    );
    expect(after.users).toHaveLength(approved ? 2 : 1);
    expect(
      after.audits.filter(
        (audit) => audit.eventType === 'REGISTRATION_APPROVED',
      ),
    ).toHaveLength(approved ? 1 : 0);
    expect(
      after.audits.filter(
        (audit) => audit.eventType === 'REGISTRATION_REJECTED',
      ),
    ).toHaveLength(approved ? 0 : 1);
  });

  it('never lets a stale caller rejection overwrite a committed approval or its message', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    const caller = new GamesRegistrationService(undefined!, mutations);
    const competitor = new TurnMutationsService(
      fixture.connect(),
      new TurnRecordsService(),
    );
    let approved: Awaited<ReturnType<typeof persistedState>> | undefined;
    const approve = async () => {
      if (approved) return;
      await competitor.approveRegistrationRequest(
        request.id,
        'approval-message',
        'overlord-discord',
      );
      approved = await persistedState();
    };
    // Schedule the competing commit after the old standalone read, or before
    // transaction admission once the caller delegates to the atomic owner.
    const read = fixture.db.registrationRequest.findUnique.bind(
      fixture.db.registrationRequest,
    );
    vi.spyOn(
      fixture.db.registrationRequest,
      'findUnique',
    ).mockImplementationOnce(async (...args) => {
      const observed = await read(...args);
      await approve();
      return observed;
    });
    beforeTransaction(approve);
    const outcome = await caller
      .rejectRegistrationRequest(
        request.id,
        'rejection-message',
        'overlord-discord',
      )
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(
      await fixture.db.registrationRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({
      status: 'APPROVED',
      discordMessageId: 'approval-message',
    });
    expect(outcome).toBeInstanceOf(ConflictException);
    expect(await persistedState(fixture.connect())).toEqual(approved);
  });

  it('keeps migrated seat-order, open-turn and identity uniqueness constraints enforced', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    await expect(
      fixture.db.gamePlayer.create({ data: { gameId: game.id, turnOrder: 2 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      fixture.db.turnRecord.create({
        data: {
          gameId: game.id,
          roundNumber: 1,
          playerDisplayName: 'Duplicate',
          startedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      fixture.db.authIdentity.create({
        data: {
          userId: game.organizerId,
          provider: 'discord',
          providerId: 'overlord-discord',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      fixture.db.registrationRequest.create({
        data: {
          gameId: 'missing',
          playerDiscordId: 'unknown',
          playerDisplayName: 'Unknown',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const request = await pendingRequest(game.id);
    await mutations.approveRegistrationRequest(
      request.id,
      undefined,
      'overlord-discord',
    );
    expect(
      await fixture.db.gamePlayer.count({ where: { gameId: game.id } }),
    ).toBe(3);
    expect(
      await fixture.db.turnRecord.count({ where: { endedAt: null } }),
    ).toBe(1);
  });

  it('restores an existing Overlord identity when initialization fails after its display name update', async () => {
    const original = await fixture.db.user.create({
      data: {
        email: 'original@example.com',
        displayName: 'Original',
        identities: {
          create: { provider: 'discord', providerId: 'overlord-discord' },
        },
      },
    });
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_existing_init AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'GAME_CREATED'
      AND (SELECT displayName FROM User WHERE id = NEW.actorId) = 'Overlord'
      BEGIN SELECT RAISE(ABORT, 'injected existing identity failure'); END`);
    const before = await persistedState();
    await expect(
      mutations.createGameFromDiscordInit(initialization),
    ).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    expect(
      await fixture.db.user.findUniqueOrThrow({ where: { id: original.id } }),
    ).toMatchObject({ displayName: 'Original' });
  });

  it('resolves current seat allocation after another writer fills the earlier open seat', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    const occupied = await fixture.db.user.create({
      data: { email: 'occupied@example.com', displayName: 'Occupied' },
    });
    const seats = await fixture.db.gamePlayer.findMany({
      where: { gameId: game.id },
      orderBy: { turnOrder: 'asc' },
    });
    beforeTransaction((other) =>
      other.gamePlayer.update({
        where: { id: seats[1].id },
        data: { userId: occupied.id },
      }),
    );
    expect(
      await mutations.approveRegistrationRequest(
        request.id,
        undefined,
        'overlord-discord',
      ),
    ).toMatchObject({ player: { id: seats[2].id, turnOrder: 3 } });
    expect(
      await fixture.db.gamePlayer.findUniqueOrThrow({
        where: { id: seats[1].id },
      }),
    ).toMatchObject({ userId: occupied.id });
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: game.id } }),
    ).toMatchObject({ turnRevision: 1 });
  });

  it('uses current capacity even when it changes immediately before admission', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    let changed: Awaited<ReturnType<typeof persistedState>>;
    beforeTransaction(async (other) => {
      await other.game.update({
        where: { id: game.id },
        data: { playerCount: 1 },
      });
      changed = await persistedState(other);
    });
    await expect(
      mutations.approveRegistrationRequest(
        request.id,
        undefined,
        'overlord-discord',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await persistedState()).toEqual(changed!);
  });

  it('preserves duplicate thread and campaign number conflicts without orphaning a new Overlord', async () => {
    await mutations.createGameFromDiscordInit(initialization);
    const before = await persistedState();
    await expect(
      mutations.createGameFromDiscordInit({
        ...initialization,
        gameNumber: 16,
        organizerDiscordId: 'new-overlord',
      }),
    ).rejects.toThrow('Thread thread is already linked to game ashes.');
    expect(await persistedState()).toEqual(before);
    await expect(
      mutations.createGameFromDiscordInit({
        ...initialization,
        discordThreadId: 'new-thread',
        organizerDiscordId: 'new-overlord',
      }),
    ).rejects.toThrow('Game number 15 is already in use.');
    expect(await persistedState()).toEqual(before);
  });

  it('reuses identity, resolves slug collisions and retains default timing on initialization', async () => {
    const first = await mutations.createGameFromDiscordInit(initialization);
    const second = await mutations.createGameFromDiscordInit({
      ...initialization,
      gameNumber: 16,
      discordThreadId: 'second-thread',
      organizerDisplayName: 'Renamed Overlord',
      playerCount: undefined,
      turnTargetHours: undefined,
      turnReminderGraceHours: undefined,
      turnReminderRepeatHours: undefined,
    });
    expect(second).toMatchObject({
      slug: 'ashes-2',
      organizerId: first.organizerId,
    });
    expect(await fixture.db.user.count()).toBe(1);
    expect(await fixture.db.authIdentity.count()).toBe(1);
    expect(
      await fixture.db.gamePlayer.count({ where: { gameId: second.id } }),
    ).toBe(1);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: second.id } }),
    ).toMatchObject({
      turnRevision: 0,
      turnTargetHours: 24,
      turnReminderGraceHours: 12,
      turnReminderRepeatHours: 24,
    });
    const record = await fixture.db.turnRecord.findFirstOrThrow({
      where: { gameId: second.id },
    });
    expect(record.playerDisplayName).toBe('Renamed Overlord');
    expect(record.nextReminderAt!.getTime() - record.startedAt.getTime()).toBe(
      36 * 60 * 60 * 1000,
    );
  });

  it('notifies after initialization commits and never undoes a campaign on transport failure', async () => {
    notifyGameInitialized.mockImplementationOnce(async () => {
      const committed = await persistedState(fixture.connect());
      expect(committed.games).toHaveLength(1);
      expect(committed.history).toHaveLength(1);
      throw new Error('notification transport failed');
    });
    await expect(
      mutations.createGameFromDiscordInit(initialization),
    ).rejects.toThrow('notification transport failed');
    const after = await persistedState();
    expect(after.games).toHaveLength(1);
    expect(after.games[0].turnRevision).toBe(0);
    expect(after.users).toHaveLength(1);
    expect(after.audits).toHaveLength(1);
  });

  it.each(['same request', 'same player', 'last seat'])(
    'rejects a competing approval for the %s after the winner commits',
    async (competition) => {
      const game = await mutations.createGameFromDiscordInit({
        ...initialization,
        playerCount: competition === 'last seat' ? 2 : 3,
      });
      const request = await pendingRequest(game.id);
      const competitorRequest =
        competition === 'same request'
          ? request
          : await pendingRequest(
              game.id,
              competition === 'same player' ? 'player-discord' : 'other-player',
            );
      let winner: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        await new TurnMutationsService(
          other,
          new TurnRecordsService(),
        ).approveRegistrationRequest(
          competitorRequest.id,
          'winner-message',
          'overlord-discord',
        );
        winner = await persistedState(other);
      });
      await expect(
        mutations.approveRegistrationRequest(
          request.id,
          'loser-message',
          'overlord-discord',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(winner!);
      expect(winner!.games[0].turnRevision).toBe(1);
      expect(
        winner!.audits.filter(
          (audit) => audit.eventType === 'REGISTRATION_APPROVED',
        ),
      ).toHaveLength(1);
    },
  );

  it('admits only one of two simultaneous requests competing for the last seat', async () => {
    const game = await mutations.createGameFromDiscordInit({
      ...initialization,
      playerCount: 2,
    });
    const first = await pendingRequest(game.id);
    const second = await pendingRequest(game.id, 'other-player');
    const other = new TurnMutationsService(
      fixture.connect(),
      new TurnRecordsService(),
    );
    const outcomes = await Promise.allSettled([
      mutations.approveRegistrationRequest(
        first.id,
        undefined,
        'overlord-discord',
      ),
      other.approveRegistrationRequest(
        second.id,
        undefined,
        'overlord-discord',
      ),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected'),
    ).toHaveLength(1);
    const after = await persistedState(fixture.connect());
    expect(after.games[0].turnRevision).toBe(1);
    expect(after.seats.filter((seat) => seat.userId != null)).toHaveLength(2);
    expect(
      after.requests.filter((request) => request.status === 'APPROVED'),
    ).toHaveLength(1);
    expect(
      after.requests.filter((request) => request.status === 'PENDING'),
    ).toHaveLength(1);
    expect(after.identities).toHaveLength(2);
    expect(
      after.audits.filter(
        (audit) => audit.eventType === 'REGISTRATION_APPROVED',
      ),
    ).toHaveLength(1);
  });

  it('does not retry or mislabel SQLite write contention as a consumed request', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    const other = fixture.connect();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = other.$transaction(async (transaction) => {
      await transaction.game.update({
        where: { id: game.id },
        data: { notes: 'Concurrent edit' },
      });
      locked.resolve();
      await release.promise;
    });
    void writer.catch(locked.reject);
    await locked.promise;
    try {
      const outcome = await mutations
        .approveRegistrationRequest(request.id, undefined, 'overlord-discord')
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).not.toBeInstanceOf(ConflictException);
    } finally {
      release.resolve();
      await writer;
    }
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: game.id } }),
    ).toMatchObject({ turnRevision: 0, notes: 'Concurrent edit' });
    expect(
      await fixture.db.registrationRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
    ).toMatchObject({ status: 'PENDING' });
    expect(await fixture.db.user.count()).toBe(1);
    expect(await fixture.db.auditEvent.count()).toBe(1);
  });

  it.each([undefined, 'unknown-discord', 'player-discord'])(
    'rejects an ineligible approver %s with no writes',
    async (approver) => {
      const game = await mutations.createGameFromDiscordInit(initialization);
      await fixture.db.user.create({
        data: {
          email: 'player@example.com',
          displayName: 'Player',
          identities: {
            create: { provider: 'discord', providerId: 'player-discord' },
          },
        },
      });
      const request = await pendingRequest(game.id);
      const before = await persistedState();
      await expect(
        mutations.approveRegistrationRequest(request.id, undefined, approver),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState()).toEqual(before);
    },
  );

  it.each(['owner', 'identity', 'request campaign'])(
    'checks changed %s authorization after transaction admission',
    async (change) => {
      const game = await mutations.createGameFromDiscordInit(initialization);
      const request = await pendingRequest(game.id);
      const otherOwner = await fixture.db.user.create({
        data: {
          email: 'other@example.com',
          displayName: 'Other',
          identities: {
            create: { provider: 'discord', providerId: 'other-discord' },
          },
        },
      });
      const otherGame = await fixture.db.game.create({
        data: {
          gameNumber: 16,
          name: 'Other',
          slug: 'other',
          organizerId: otherOwner.id,
        },
      });
      let afterChange: Awaited<ReturnType<typeof persistedState>>;
      beforeTransaction(async (other) => {
        if (change === 'owner') {
          await other.game.update({
            where: { id: game.id },
            data: { organizerId: otherOwner.id },
          });
        } else if (change === 'identity') {
          await other.authIdentity.update({
            where: {
              provider_providerId: {
                provider: 'discord',
                providerId: 'overlord-discord',
              },
            },
            data: { userId: otherOwner.id },
          });
        } else {
          await other.registrationRequest.update({
            where: { id: request.id },
            data: { gameId: otherGame.id },
          });
        }
        afterChange = await persistedState(other);
      });
      await expect(
        mutations.approveRegistrationRequest(
          request.id,
          undefined,
          'overlord-discord',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await persistedState()).toEqual(afterChange!);
    },
  );

  it.each(['APPROVED', 'REJECTED'] as const)(
    'rejects an already %s request without consuming a revision',
    async (status) => {
      const game = await mutations.createGameFromDiscordInit(initialization);
      const request = await pendingRequest(game.id);
      await fixture.db.registrationRequest.update({
        where: { id: request.id },
        data: { status },
      });
      const before = await persistedState();
      await expect(
        mutations.approveRegistrationRequest(
          request.id,
          undefined,
          'overlord-discord',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await persistedState()).toEqual(before);
    },
  );

  it('rejects missing and deleted-campaign requests without writes', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    await fixture.db.game.delete({ where: { id: game.id } });
    const before = await persistedState();
    for (const requestId of [request.id, 'missing']) {
      await expect(
        mutations.approveRegistrationRequest(
          requestId,
          undefined,
          'overlord-discord',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await persistedState()).toEqual(before);
    }
  });

  it.each(['fill', 'create', 'existing identity'])(
    'rolls back identity, %s, request, both audits and revision after a late approval failure',
    async (allocation) => {
      const game = await mutations.createGameFromDiscordInit({
        ...initialization,
        playerCount: allocation === 'create' ? undefined : 3,
      });
      if (allocation === 'existing identity') {
        await fixture.db.user.create({
          data: {
            email: 'player@example.com',
            displayName: 'Original name',
            identities: {
              create: { provider: 'discord', providerId: 'player-discord' },
            },
          },
        });
      }
      const request = await pendingRequest(game.id);
      await fixture.db
        .$executeRawUnsafe(`CREATE TRIGGER fail_approval AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'ROSTER_UPDATED'
      AND (SELECT turnRevision FROM Game WHERE id = NEW.gameId) = 1
      AND (SELECT COUNT(*) FROM RegistrationRequest WHERE gameId = NEW.gameId AND status = 'APPROVED') = 1
      AND (SELECT COUNT(*) FROM GamePlayer WHERE gameId = NEW.gameId AND userId = NEW.actorId) = 1
      AND (SELECT COUNT(*) FROM AuthIdentity WHERE userId = NEW.actorId) = 1
      AND (SELECT COUNT(*) FROM AuditEvent WHERE gameId = NEW.gameId AND eventType = 'REGISTRATION_APPROVED') = 1
      BEGIN SELECT RAISE(ABORT, 'injected failure after approval'); END`);
      const before = await persistedState();
      await expect(
        mutations.approveRegistrationRequest(
          request.id,
          'approval-message',
          'overlord-discord',
        ),
      ).rejects.toThrow();
      expect(await persistedState(fixture.connect())).toEqual(before);
      await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_approval');
      await mutations.approveRegistrationRequest(
        request.id,
        'approval-message',
        'overlord-discord',
      );
      expect(
        await fixture.db.game.findUniqueOrThrow({ where: { id: game.id } }),
      ).toMatchObject({ turnRevision: 1 });
    },
  );

  it.each([undefined, 3])(
    'creates a seat when capacity is %s and preserves the message ID when none is supplied',
    async (playerCount) => {
      const game = await mutations.createGameFromDiscordInit({
        ...initialization,
        playerCount,
      });
      await fixture.db.gamePlayer.deleteMany({
        where: { gameId: game.id, userId: null },
      });
      const request = await pendingRequest(game.id);
      const before = await persistedState();
      expect(
        await mutations.approveRegistrationRequest(
          request.id,
          undefined,
          'overlord-discord',
        ),
      ).toMatchObject({
        player: { turnOrder: 2, displayName: 'Player' },
      });
      const after = await persistedState();
      expect(after.seats).toHaveLength(2);
      expect(after.seats.find((seat) => seat.turnOrder === 1)).toEqual(
        before.seats[0],
      );
      expect(after.games[0].turnRevision).toBe(1);
      expect(after.requests[0]).toMatchObject({
        status: 'APPROVED',
        discordMessageId: 'original-message',
      });
      expect(after.history).toEqual(before.history);
      expect(after.states).toEqual(before.states);
    },
  );

  it('does not invent an active turn when approving registration in an uninitialized campaign', async () => {
    const organizer = await fixture.db.user.create({
      data: {
        email: 'owner@example.com',
        displayName: 'Overlord',
        identities: {
          create: { provider: 'discord', providerId: 'overlord-discord' },
        },
      },
    });
    const game = await fixture.db.game.create({
      data: {
        gameNumber: 15,
        name: 'Ashes',
        slug: 'ashes',
        organizerId: organizer.id,
      },
    });
    const request = await pendingRequest(game.id);
    await mutations.approveRegistrationRequest(
      request.id,
      undefined,
      'overlord-discord',
    );
    expect(await fixture.db.turnState.count()).toBe(0);
    expect(await fixture.db.turnRecord.count()).toBe(0);
    expect(await fixture.db.notificationDelivery.count()).toBe(0);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: game.id } }),
    ).toMatchObject({ turnRevision: 1 });
    expect(await fixture.db.gamePlayer.findFirstOrThrow()).toMatchObject({
      turnOrder: 1,
      role: 'PLAYER',
    });
  });

  it.each(['full roster', 'extra open seat', 'sparse full seat order'])(
    'rejects capacity overflow with %s without consuming the request or identity',
    async (shape) => {
      const game = await mutations.createGameFromDiscordInit({
        ...initialization,
        playerCount: 1,
      });
      if (shape === 'extra open seat') {
        await fixture.db.gamePlayer.create({
          data: { gameId: game.id, turnOrder: 2 },
        });
      }
      if (shape === 'sparse full seat order') {
        await fixture.db.game.update({
          where: { id: game.id },
          data: { playerCount: 3 },
        });
        await fixture.db.gamePlayer.updateMany({
          where: { gameId: game.id },
          data: { turnOrder: 3 },
        });
      }
      const request = await pendingRequest(game.id);
      const before = await persistedState();
      await expect(
        mutations.approveRegistrationRequest(
          request.id,
          undefined,
          'overlord-discord',
        ),
      ).rejects.toThrow('This game is already at its seat limit.');
      expect(await persistedState(fixture.connect())).toEqual(before);
    },
  );

  it('rejects a pending request for an existing member without changing their identity or revision', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id, 'overlord-discord');
    const before = await persistedState();
    await expect(
      mutations.approveRegistrationRequest(
        request.id,
        undefined,
        'overlord-discord',
      ),
    ).rejects.toThrow('Player is already registered in this game.');
    expect(await persistedState()).toEqual(before);
  });

  it('rolls back initialization including a new identity when the final audit fails', async () => {
    await fixture.db
      .$executeRawUnsafe(`CREATE TRIGGER fail_init AFTER INSERT ON AuditEvent
      WHEN NEW.eventType = 'GAME_CREATED'
      AND (SELECT COUNT(*) FROM GamePlayer WHERE gameId = NEW.gameId) = 3
      AND (SELECT COUNT(*) FROM TurnRecord WHERE gameId = NEW.gameId AND nextReminderAt IS NOT NULL) = 1
      AND (SELECT COUNT(*) FROM TurnState WHERE gameId = NEW.gameId) = 1
      AND (SELECT COUNT(*) FROM AuthIdentity WHERE userId = NEW.actorId) = 1
      BEGIN SELECT RAISE(ABORT, 'injected failure after initialization'); END`);
    const before = await persistedState();
    await expect(
      mutations.createGameFromDiscordInit(initialization),
    ).rejects.toThrow();
    expect(await persistedState(fixture.connect())).toEqual(before);
    expect(notifyGameInitialized).not.toHaveBeenCalled();
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_init');
    await mutations.createGameFromDiscordInit(initialization);
    expect(await fixture.db.game.count()).toBe(1);
  });

  it('fills the first open seat and consumes approval with one revision without resetting timing', async () => {
    const game = await mutations.createGameFromDiscordInit(initialization);
    const request = await pendingRequest(game.id);
    const record = await fixture.db.turnRecord.findFirstOrThrow();
    const lastReminderAt = new Date('2026-09-01T10:00:00.000Z');
    await fixture.db.turnRecord.update({
      where: { id: record.id },
      data: {
        reminderCount: 2,
        lastReminderAt,
        nextReminderAt: new Date('2026-09-01T14:00:00.000Z'),
      },
    });
    for (const status of ['PENDING', 'PROCESSING', 'DELIVERED'] as const) {
      await fixture.db.notificationDelivery.create({
        data: {
          event: 'TURN_NUDGE',
          gameId: game.id,
          gameSlug: game.slug,
          turnRecordId: record.id,
          status,
          payload: '{}',
          processingStartedAt: status === 'PROCESSING' ? lastReminderAt : null,
        },
      });
    }
    const before = await persistedState();
    const openSeat = before.seats.find((seat) => seat.turnOrder === 2)!;
    const result = await mutations.approveRegistrationRequest(
      request.id,
      'approval-message',
      'overlord-discord',
    );
    const after = await persistedState();
    const player = after.users.find((user) => user.displayName === 'Player')!;
    expect(result).toEqual({
      gameId: game.id,
      gameNumber: 15,
      slug: 'ashes',
      name: 'Ashes',
      player: {
        id: openSeat.id,
        userId: player.id,
        displayName: 'Player',
        turnOrder: 2,
        discordId: 'player-discord',
      },
    });
    expect(after.games[0].turnRevision).toBe(1);
    expect(after.seats).toHaveLength(3);
    expect(after.seats.find((seat) => seat.id === openSeat.id)).toMatchObject({
      userId: player.id,
      role: 'PLAYER',
    });
    expect(after.requests[0]).toMatchObject({
      status: 'APPROVED',
      discordMessageId: 'approval-message',
      respondedAt: expect.any(Date),
    });
    expect(
      after.identities.find((identity) => identity.userId === player.id),
    ).toMatchObject({ provider: 'discord', providerId: 'player-discord' });
    expect(after.states).toEqual(before.states);
    expect(after.history).toEqual(before.history);
    expect(after.reminders).toEqual(before.reminders);
    const approved = after.audits.find(
      (audit) => audit.eventType === 'REGISTRATION_APPROVED',
    )!;
    const roster = after.audits.find(
      (audit) => audit.eventType === 'ROSTER_UPDATED',
    )!;
    expect(approved.actorId).toBe(player.id);
    expect(roster.actorId).toBe(player.id);
    expect(JSON.parse(approved.payload)).toEqual({
      requestId: request.id,
      playerDiscordId: 'player-discord',
      playerUsername: 'player-name',
      playerEntryId: openSeat.id,
      turnOrder: 2,
    });
    expect(JSON.parse(roster.payload)).toEqual({
      source: 'discord-register-approved',
      playerDiscordId: 'player-discord',
      playerUsername: 'player-name',
      playerEntryId: openSeat.id,
      turnOrder: 2,
    });
  });

  it('initializes the Overlord, stable roster, active turn, reminder, audit and revision zero together', async () => {
    const result = await mutations.createGameFromDiscordInit(initialization);
    const game = await fixture.db.game.findUniqueOrThrow({
      where: { id: result.id },
      include: {
        organizer: { include: { identities: true } },
        players: { orderBy: { turnOrder: 'asc' } },
        turnState: true,
        turnRecords: true,
        auditEvents: true,
      },
    });
    expect(result).toEqual({
      id: game.id,
      gameNumber: 15,
      slug: 'ashes',
      name: 'Ashes',
      organizerId: game.organizerId,
      discordThreadId: 'thread',
    });
    expect(game.turnRevision).toBe(0);
    expect(game.organizer.identities).toMatchObject([
      { provider: 'discord', providerId: 'overlord-discord' },
    ]);
    expect(game.players).toMatchObject([
      { userId: game.organizerId, role: 'ORGANIZER', turnOrder: 1 },
      { userId: null, role: 'PLAYER', turnOrder: 2 },
      { userId: null, role: 'PLAYER', turnOrder: 3 },
    ]);
    expect(game.turnState).toMatchObject({
      activePlayerId: game.organizerId,
      activePlayerEntryId: game.players[0].id,
      roundNumber: 1,
    });
    expect(game.turnRecords).toHaveLength(1);
    expect(game.turnRecords[0]).toMatchObject({
      gamePlayerId: game.players[0].id,
      userId: game.organizerId,
      seatNumber: 1,
      playerDisplayName: 'Overlord',
      roundNumber: 1,
      endedAt: null,
      reminderCount: 0,
    });
    expect(
      game.turnRecords[0].nextReminderAt!.getTime() -
        game.turnRecords[0].startedAt.getTime(),
    ).toBe(8 * 60 * 60 * 1000);
    expect(game.auditEvents).toMatchObject([
      { actorId: game.organizerId, eventType: 'GAME_CREATED' },
    ]);
    expect(JSON.parse(game.auditEvents[0].payload)).toMatchObject({
      source: 'discord-init',
      gameNumber: 15,
      organizerUsername: 'overlord',
    });
    expect(notifyGameInitialized).toHaveBeenCalledWith(
      expect.objectContaining({
        organizer: {
          id: game.organizerId,
          displayName: 'Overlord',
          discordId: 'overlord-discord',
        },
      }),
    );
  });
});
