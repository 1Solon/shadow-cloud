-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gameId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" DATETIME,
    "deliveredAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_NotificationDelivery" (
    "attempts",
    "createdAt",
    "deliveredAt",
    "event",
    "gameId",
    "gameSlug",
    "id",
    "lastError",
    "nextAttemptAt",
    "payload",
    "processingStartedAt",
    "status",
    "updatedAt"
) SELECT
    "attempts",
    "createdAt",
    "deliveredAt",
    "event",
    "gameId",
    "gameSlug",
    "id",
    "lastError",
    "nextAttemptAt",
    "payload",
    "processingStartedAt",
    "status",
    "updatedAt"
FROM "NotificationDelivery";
DROP TABLE "NotificationDelivery";
ALTER TABLE "new_NotificationDelivery" RENAME TO "NotificationDelivery";
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_createdAt_idx"
ON "NotificationDelivery"("status", "nextAttemptAt", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;