import type { Prisma, PrismaClient } from '../../database';
import type { FileStorageService } from '../file-storage.service';

export function saveStagingLease(
  db: PrismaClient,
  storage: Pick<FileStorageService, 'removeFileOrThrow'>,
) {
  let stagedPath: string | undefined;
  return {
    prepare: async (storagePath: string) => {
      await db.saveCleanup.create({
        data: { storagePath, dueAt: new Date(Date.now() + 3_600_000) },
      });
      stagedPath = storagePath;
    },
    discard: async () => {
      if (!stagedPath) return;
      // If the database is unavailable, the original lease still expires.
      await db.saveCleanup
        .upsert({
          where: { storagePath: stagedPath },
          create: { storagePath: stagedPath },
          update: { dueAt: new Date() },
        })
        .catch(() => undefined);
      await cleanupSaveRecovery(db, storage).catch(() => undefined);
    },
  };
}

export async function closeSaveRecovery(
  tx: Prisma.TransactionClient,
  gameId: string,
) {
  const active = await tx.passwordReset.findMany({
    where: { gameId, state: 'ACTIVE' },
  });
  for (const reset of active) {
    await tx.passwordReset.update({
      where: { id: reset.id },
      data: { state: 'CLOSED', closedAt: new Date() },
    });
    await tx.saveCleanup.upsert({
      where: { storagePath: reset.sourcePath },
      create: { storagePath: reset.sourcePath },
      update: { dueAt: new Date() },
    });
  }
}

export async function cleanupSaveRecovery(
  db: PrismaClient,
  storage: Pick<FileStorageService, 'removeFileOrThrow'>,
) {
  // Also catches non-file turn transitions, campaign deletion and process restarts.
  const active = await db.passwordReset.findMany({
    where: { state: 'ACTIVE' },
  });
  for (const reset of active) {
    await db.$transaction(async (tx) => {
      await tx.passwordReset.updateMany({
        where: { id: reset.id, state: 'ACTIVE' },
        data: { state: 'ACTIVE' },
      });
      const current = await tx.passwordReset.findUnique({
        where: { id: reset.id },
      });
      if (current?.state !== 'ACTIVE') return;
      const game = await tx.game.findUnique({ where: { id: reset.gameId } });
      const turn = await tx.turnRecord.findFirst({
        where: { gameId: reset.gameId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (
        !game ||
        game.saveRevision !== reset.saveRevision ||
        (turn?.id ?? null) !== reset.turnRecordId
      ) {
        await closeSaveRecovery(tx, reset.gameId);
      }
    });
  }
  const pending = await db.saveCleanup.findMany({
    where: { dueAt: { lte: new Date() } },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
  for (const item of pending) {
    try {
      await db.$transaction(async (tx) => {
        // Lock before checking references. Publication must consume its staging
        // lease in the same transaction, so a reclaimed path cannot be published.
        const claimed = await tx.saveCleanup.updateMany({
          where: { id: item.id, dueAt: { lte: new Date() } },
          data: { dueAt: new Date(Date.now() + 30_000) },
        });
        if (!claimed.count) return;
        if (
          (await tx.fileVersion.findFirst({
            where: { storagePath: item.storagePath },
          })) ||
          (await tx.passwordReset.findFirst({
            where: { sourcePath: item.storagePath, state: 'ACTIVE' },
          }))
        )
          return;
        try {
          await storage.removeFileOrThrow(item.storagePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await tx.passwordReset.updateMany({
          where: { sourcePath: item.storagePath, state: 'CLOSED' },
          data: { state: 'CLEANED', cleanedAt: new Date() },
        });
        await tx.saveCleanup.delete({ where: { id: item.id } });
      });
    } catch {
      // Durable row remains retryable; never turn committed publication into failure.
      // Move failures behind older pending work so one bad disk path cannot starve it.
      await db.saveCleanup
        .updateMany({ where: { id: item.id }, data: { dueAt: new Date() } })
        .catch(() => undefined);
    }
  }
}
