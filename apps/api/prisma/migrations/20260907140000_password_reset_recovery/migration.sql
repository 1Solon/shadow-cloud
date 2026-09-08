CREATE TABLE "PasswordReset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "gameId" TEXT NOT NULL,
  "fileVersionId" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "outputId" TEXT NOT NULL,
  "outputRevision" INTEGER NOT NULL,
  "saveRevision" INTEGER NOT NULL,
  "turnRecordId" TEXT,
  "actorId" TEXT NOT NULL,
  "regimeId" TEXT NOT NULL,
  "regimeName" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" DATETIME,
  "cleanedAt" DATETIME
);
CREATE INDEX "PasswordReset_gameId_state_idx" ON "PasswordReset"("gameId", "state");
CREATE TABLE "SaveCleanup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storagePath" TEXT NOT NULL,
  "dueAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SaveCleanup_storagePath_key" ON "SaveCleanup"("storagePath");
