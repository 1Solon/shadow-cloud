import {
  AuditEventType,
  NotificationDeliveryEvent,
  NotificationDeliveryStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { InactivityWarningNotificationPayload } from '../bot-notifications.service';
import {
  type CampaignStorage,
  cleanUpErasedCampaign,
  eraseCampaign,
} from './campaign-deletion';
import { getDiscordIdentity } from './discord-user.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

export const INACTIVITY_WARNING_AFTER_MS = 30 * DAY_MS;
export const INACTIVITY_DELETION_AFTER_WARNING_MS = 30 * DAY_MS;
export const FINAL_INACTIVITY_WARNING_BEFORE_MS = 2 * DAY_MS;

export const ACTIVITY_EVENT_TYPES: AuditEventType[] = [
  AuditEventType.ROSTER_UPDATED,
  AuditEventType.REGISTRATION_APPROVED,
  AuditEventType.PLAYER_RESIGNED,
  AuditEventType.PLAYER_REPLACED,
  AuditEventType.TURN_SKIPPED,
  AuditEventType.TURN_ADVANCED,
  AuditEventType.TURN_REASSIGNED,
  AuditEventType.FILE_UPLOADED,
  AuditEventType.FILE_REPLACED,
  AuditEventType.SAVE_REJECTED,
  AuditEventType.VICTORY_UNDONE,
];

/** A dormant campaign is never deleted sooner than 2 days after its final warning. */
export function inactivityDeletionDueAt(
  inactivityWarnedAt: Date,
  finalInactivityWarnedAt: Date | null = null,
) {
  return new Date(
    Math.max(
      inactivityWarnedAt.getTime() + INACTIVITY_DELETION_AFTER_WARNING_MS,
      (finalInactivityWarnedAt?.getTime() ?? 0) +
        FINAL_INACTIVITY_WARNING_BEFORE_MS,
    ),
  );
}

/**
 * When a dormant campaign will be deleted, or null when it is not dormant:
 * never warned, spared by activity since its warning, or concluded.
 */
export async function dormantCampaignDeletionDueAt(
  database: Prisma.TransactionClient,
  game: {
    id: string;
    inactivityWarnedAt: Date | null;
    finalInactivityWarnedAt: Date | null;
    victoryRecord: { id: string } | null;
  },
) {
  const warnedAt = game.inactivityWarnedAt;
  if (!warnedAt || game.victoryRecord) return null;

  const activity = await database.auditEvent.findFirst({
    where: {
      gameId: game.id,
      eventType: { in: ACTIVITY_EVENT_TYPES },
      createdAt: { gt: warnedAt },
    },
    select: { id: true },
  });
  return activity
    ? null
    : inactivityDeletionDueAt(warnedAt, game.finalInactivityWarnedAt);
}

async function lastActivityByGame(database: PrismaClient) {
  const latest = await database.auditEvent.groupBy({
    by: ['gameId'],
    where: { eventType: { in: ACTIVITY_EVENT_TYPES } },
    _max: { createdAt: true },
  });
  return new Map(
    latest.map((entry) => [entry.gameId, entry._max.createdAt ?? null]),
  );
}

/**
 * Whether a dormant campaign's latest warning has reached its thread. A
 * warning that failed, was cancelled, or was never queued must be given again.
 */
async function latestWarningPosting(
  database: PrismaClient,
  game: { id: string; discordThreadId: string | null },
) {
  if (!game.discordThreadId) return 'posted';

  const delivery = await database.notificationDelivery.findFirst({
    where: {
      gameId: game.id,
      event: NotificationDeliveryEvent.INACTIVITY_WARNING,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true },
  });
  switch (delivery?.status) {
    case NotificationDeliveryStatus.DELIVERED:
      return 'posted';
    case NotificationDeliveryStatus.PENDING:
    case NotificationDeliveryStatus.PROCESSING:
      return 'pending';
    default:
      return 'lost';
  }
}

/** Activity ends dormancy quietly, so warnings not yet posted are dropped. */
async function cancelUnpostedWarnings(database: PrismaClient, gameId: string) {
  await database.notificationDelivery.updateMany({
    where: {
      gameId,
      event: NotificationDeliveryEvent.INACTIVITY_WARNING,
      status: NotificationDeliveryStatus.PENDING,
    },
    data: { status: NotificationDeliveryStatus.CANCELLED },
  });
}

/**
 * Record a warning and queue its notice together. The claim only succeeds
 * while the campaign's warnings are as this sweep read them.
 */
async function warnCampaign(
  database: PrismaClient,
  claim: Prisma.GameWhereInput & { id: string },
  warned: Pick<
    Prisma.GameUpdateManyMutationInput,
    'inactivityWarnedAt' | 'finalInactivityWarnedAt'
  >,
) {
  await database.$transaction(async (transaction) => {
    const claimed = await transaction.game.updateMany({
      where: claim,
      data: warned,
    });
    if (claimed.count === 0) return;

    const game = await transaction.game.findUniqueOrThrow({
      where: { id: claim.id },
      include: {
        players: {
          where: { userId: { not: null } },
          orderBy: { turnOrder: 'asc' },
          include: { user: { include: { identities: true } } },
        },
      },
    });
    if (!game.discordThreadId || !game.inactivityWarnedAt) return;

    const payload: InactivityWarningNotificationPayload = {
      game: {
        id: game.id,
        gameNumber: game.gameNumber,
        slug: game.slug,
        name: game.name,
        discordThreadId: game.discordThreadId,
      },
      warning: {
        final: game.finalInactivityWarnedAt !== null,
        deletionDueAt: inactivityDeletionDueAt(
          game.inactivityWarnedAt,
          game.finalInactivityWarnedAt,
        ).toISOString(),
      },
      players: game.players.flatMap((seat) =>
        seat.user
          ? [
              {
                displayName: seat.user.displayName,
                discordId: getDiscordIdentity(seat.user),
              },
            ]
          : [],
      ),
    };
    await transaction.notificationDelivery.create({
      data: {
        event: NotificationDeliveryEvent.INACTIVITY_WARNING,
        gameId: game.id,
        gameSlug: game.slug,
        payload: JSON.stringify(payload),
      },
    });
  });
}

/**
 * Delete one dormant campaign whose final warning has run its course, unless
 * activity or a victory has since spared it. Nothing of the campaign remains.
 */
export async function deleteDormantCampaign(
  database: PrismaClient,
  storage: CampaignStorage,
  gameId: string,
  now = new Date(),
) {
  const deleted = await database.$transaction(async (transaction) => {
    const game = await transaction.game.findUnique({
      where: { id: gameId },
      include: {
        victoryRecord: { select: { id: true } },
        fileVersions: { select: { storagePath: true } },
      },
    });
    if (!game?.finalInactivityWarnedAt) return false;
    const dueAt = await dormantCampaignDeletionDueAt(transaction, game);
    if (!dueAt || dueAt.getTime() > now.getTime()) return false;

    await eraseCampaign(transaction, game, null);
    return true;
  });

  if (!deleted) return false;
  await cleanUpErasedCampaign(database, storage, gameId);
  return true;
}

/**
 * Warn, finally warn, or delete every campaign whose activity has lapsed.
 * Each step waits for the previous warning to be posted, and a warning that
 * could not be posted is given again, restarting its clock. Concluded
 * campaigns are left to victory deletion.
 */
export async function sweepCampaignInactivity(
  database: PrismaClient,
  storage: CampaignStorage,
  now = new Date(),
) {
  const [games, lastActivity] = await Promise.all([
    database.game.findMany({
      where: { victoryRecord: null },
      select: {
        id: true,
        createdAt: true,
        discordThreadId: true,
        inactivityWarnedAt: true,
        finalInactivityWarnedAt: true,
      },
    }),
    lastActivityByGame(database),
  ]);
  const failed: Array<{ id: string; error: unknown }> = [];

  for (const game of games) {
    const activityAt = lastActivity.get(game.id) ?? game.createdAt;
    const warnedAt = game.inactivityWarnedAt;
    const finalWarnedAt = game.finalInactivityWarnedAt;
    const warnAgain = () =>
      warnCampaign(
        database,
        { id: game.id, inactivityWarnedAt: warnedAt },
        { inactivityWarnedAt: now, finalInactivityWarnedAt: null },
      );
    const warnFinally = () =>
      warnCampaign(
        database,
        {
          id: game.id,
          inactivityWarnedAt: warnedAt,
          finalInactivityWarnedAt: finalWarnedAt,
        },
        { finalInactivityWarnedAt: now },
      );
    try {
      if (!warnedAt || warnedAt.getTime() < activityAt.getTime()) {
        if (warnedAt) await cancelUnpostedWarnings(database, game.id);
        if (
          activityAt.getTime() + INACTIVITY_WARNING_AFTER_MS <=
          now.getTime()
        ) {
          await warnAgain();
        }
        continue;
      }

      const posting = await latestWarningPosting(database, game);
      if (posting === 'pending') continue;
      if (posting === 'lost') {
        await (finalWarnedAt ? warnFinally() : warnAgain());
      } else if (!finalWarnedAt) {
        if (
          inactivityDeletionDueAt(warnedAt).getTime() -
            FINAL_INACTIVITY_WARNING_BEFORE_MS <=
          now.getTime()
        ) {
          await warnFinally();
        }
      } else if (
        inactivityDeletionDueAt(warnedAt, finalWarnedAt).getTime() <=
        now.getTime()
      ) {
        await deleteDormantCampaign(database, storage, game.id, now);
      }
    } catch (error) {
      failed.push({ id: game.id, error });
    }
  }

  return failed;
}
