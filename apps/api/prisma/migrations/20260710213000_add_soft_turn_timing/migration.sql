-- AlterTable
ALTER TABLE "Game" ADD COLUMN "turnTargetHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Game" ADD COLUMN "turnReminderGraceHours" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "Game" ADD COLUMN "turnReminderRepeatHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Game" ADD COLUMN "turnRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TurnRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "gamePlayerId" TEXT,
    "userId" TEXT,
    "seatNumber" INTEGER,
    "playerDisplayName" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "completionReason" TEXT,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" DATETIME,
    "nextReminderAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TurnRecord_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TurnRecord_gamePlayerId_fkey" FOREIGN KEY ("gamePlayerId") REFERENCES "GamePlayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TurnRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gameId" TEXT NOT NULL,
    "gameSlug" TEXT NOT NULL,
    "turnRecordId" TEXT,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" DATETIME,
    "deliveredAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationDelivery_turnRecordId_fkey" FOREIGN KEY ("turnRecordId") REFERENCES "TurnRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE INDEX "NotificationDelivery_turnRecordId_idx"
ON "NotificationDelivery"("turnRecordId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TurnRecord_gameId_endedAt_startedAt_idx"
ON "TurnRecord"("gameId", "endedAt", "startedAt");
CREATE INDEX "TurnRecord_endedAt_nextReminderAt_idx"
ON "TurnRecord"("endedAt", "nextReminderAt");

CREATE UNIQUE INDEX "TurnRecord_one_open_per_game"
ON "TurnRecord"("gameId")
WHERE "endedAt" IS NULL;

INSERT INTO "TurnRecord" (
  "id", "gameId", "roundNumber", "gamePlayerId", "userId",
  "seatNumber", "playerDisplayName", "startedAt", "nextReminderAt",
  "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))), ts."gameId", ts."roundNumber",
  gp."id", ts."activePlayerId", gp."turnOrder", u."displayName",
  ts."updatedAt",
  datetime(ts."updatedAt", '+' || (g."turnTargetHours" + g."turnReminderGraceHours") || ' hours'),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TurnState" ts
JOIN "Game" g ON g."id" = ts."gameId"
JOIN "User" u ON u."id" = ts."activePlayerId"
LEFT JOIN "GamePlayer" gp ON gp."id" = COALESCE(
  ts."activePlayerEntryId",
  (SELECT candidate."id" FROM "GamePlayer" candidate
   WHERE candidate."gameId" = ts."gameId"
     AND candidate."userId" = ts."activePlayerId"
   ORDER BY candidate."turnOrder" ASC LIMIT 1)
);
