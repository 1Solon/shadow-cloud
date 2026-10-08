import type { Prisma, PrismaClient } from '../../database';

type SaveRetentionEnvironment = {
  SHADOW_CLOUD_SAVE_RETENTION_LIMIT?: string;
};

const DEFAULT_SAVE_RETENTION_LIMIT = 10;
// A save rejection returns the campaign to the save before the latest.
const MINIMUM_SAVE_RETENTION_LIMIT = 2;

export function resolveSaveRetentionLimit(
  environment: SaveRetentionEnvironment = process.env,
) {
  const configured = environment.SHADOW_CLOUD_SAVE_RETENTION_LIMIT;
  if (!configured) return DEFAULT_SAVE_RETENTION_LIMIT;
  const limit = Number(configured);
  if (!Number.isInteger(limit) || limit < MINIMUM_SAVE_RETENTION_LIMIT) {
    throw new Error(
      `SHADOW_CLOUD_SAVE_RETENTION_LIMIT must be a whole number of at least ${MINIMUM_SAVE_RETENTION_LIMIT}, not "${configured}".`,
    );
  }
  return limit;
}

/**
 * Prune a campaign's saves beyond the limit. Each keeps a pruned-save record and
 * queues its file, so the cleanup drain deletes it once nothing references it.
 */
export async function pruneSaves(
  transaction: Prisma.TransactionClient,
  gameId: string,
  limit: number,
) {
  const expired = await transaction.fileVersion.findMany({
    where: { gameId },
    orderBy: { versionNumber: 'desc' },
    skip: limit,
  });
  const prunedAt = new Date();
  for (const save of expired) {
    await transaction.prunedSave.create({
      data: {
        id: save.id,
        gameId,
        versionNumber: save.versionNumber,
        originalName: save.originalName,
        contentHash: save.contentHash,
        uploadedById: save.uploadedById,
        uploadedAt: save.uploadedAt,
        prunedAt,
      },
    });
    await transaction.fileVersion.delete({ where: { id: save.id } });
    await transaction.saveCleanup.upsert({
      where: { storagePath: save.storagePath },
      create: { storagePath: save.storagePath },
      update: { dueAt: prunedAt },
    });
  }
  return expired.length;
}

/**
 * Bring every campaign within the limit, e.g. after the limit is lowered. A
 * campaign that fails is reported and left for its next upload to prune.
 */
export async function pruneRetainedSaves(
  database: PrismaClient,
  limit: number,
) {
  const games = await database.game.findMany({
    select: { id: true, _count: { select: { fileVersions: true } } },
  });
  let saves = 0;
  let campaigns = 0;
  const failed: Array<{ gameId: string; error: unknown }> = [];
  for (const game of games) {
    if (game._count.fileVersions <= limit) continue;
    try {
      const pruned = await database.$transaction((transaction) =>
        pruneSaves(transaction, game.id, limit),
      );
      saves += pruned;
      if (pruned > 0) campaigns += 1;
    } catch (error) {
      failed.push({ gameId: game.id, error });
    }
  }
  return { saves, campaigns, failed };
}
