import { NotificationDeliveryEvent, type PrismaClient } from '@prisma/client';
import type { CampaignDeletedNotificationPayload } from '../bot-notifications.service';
import type { FileStorageService } from '../file-storage.service';
import { VICTORY_GRACE_PERIOD_MS } from './campaign-conclusion';
import { getDiscordIdentity } from './discord-user.helpers';
import { cleanupSaveRecovery } from './save-recovery';

const DUE_DELETION_BATCH_SIZE = 20;

type CampaignStorage = Pick<
  FileStorageService,
  'removeFileOrThrow' | 'removeGameDirectory'
>;

/**
 * Delete one concluded campaign whose grace period has ended. Only its victory
 * record survives; the final Discord notice is queued in the same transaction.
 */
export async function deleteConcludedCampaign(
  database: PrismaClient,
  storage: CampaignStorage,
  victoryRecordId: string,
  now = new Date(),
) {
  const deletedGameId = await database.$transaction(async (transaction) => {
    const victory = await transaction.victoryRecord.findUnique({
      where: { id: victoryRecordId },
      include: {
        victor: { include: { identities: true } },
        game: { include: { fileVersions: { select: { storagePath: true } } } },
      },
    });
    const game = victory?.game;
    if (
      !victory ||
      !game ||
      victory.designatedAt.getTime() + VICTORY_GRACE_PERIOD_MS > now.getTime()
    ) {
      return null;
    }

    // Password-reset artefacts and the outbox reference the campaign without a
    // foreign key, so they would outlive the cascade unless removed here.
    const resets = await transaction.passwordReset.findMany({
      where: { gameId: game.id },
      select: { sourcePath: true },
    });
    const storagePaths = new Set([
      ...game.fileVersions.map((fileVersion) => fileVersion.storagePath),
      ...resets.map((reset) => reset.sourcePath),
    ]);
    for (const storagePath of storagePaths) {
      await transaction.saveCleanup.upsert({
        where: { storagePath },
        create: { storagePath },
        update: { dueAt: new Date() },
      });
    }
    await transaction.passwordReset.deleteMany({ where: { gameId: game.id } });
    await transaction.notificationDelivery.deleteMany({
      where: { gameId: game.id },
    });
    await transaction.game.delete({ where: { id: game.id } });

    if (game.discordThreadId) {
      const payload: CampaignDeletedNotificationPayload = {
        game: {
          id: game.id,
          gameNumber: game.gameNumber,
          slug: game.slug,
          name: game.name,
          discordThreadId: game.discordThreadId,
        },
        victory: {
          victorDisplayName: victory.victorDisplayName,
          victorDiscordId: victory.victor
            ? getDiscordIdentity(victory.victor)
            : null,
        },
      };
      await transaction.notificationDelivery.create({
        data: {
          event: NotificationDeliveryEvent.CAMPAIGN_DELETED,
          gameId: game.id,
          gameSlug: game.slug,
          payload: JSON.stringify(payload),
        },
      });
    }

    return game.id;
  });

  if (!deletedGameId) return false;

  // Never turn the committed deletion into a failure. Removing the directory
  // also sweeps staged files no row tracks; cleanup then retires its rows.
  await storage.removeGameDirectory(deletedGameId).catch(() => undefined);
  await cleanupSaveRecovery(database, storage).catch(() => undefined);
  return true;
}

export async function deleteDueCampaigns(
  database: PrismaClient,
  storage: CampaignStorage,
  now = new Date(),
) {
  const due = await database.victoryRecord.findMany({
    where: {
      gameId: { not: null },
      designatedAt: { lte: new Date(now.getTime() - VICTORY_GRACE_PERIOD_MS) },
    },
    select: { id: true },
    orderBy: [{ designatedAt: 'asc' }, { id: 'asc' }],
    take: DUE_DELETION_BATCH_SIZE,
  });
  const failed: Array<{ id: string; error: unknown }> = [];

  for (const victory of due) {
    try {
      await deleteConcludedCampaign(database, storage, victory.id, now);
    } catch (error) {
      failed.push({ id: victory.id, error });
    }
  }

  return failed;
}
