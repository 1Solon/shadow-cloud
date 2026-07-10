-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FileVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentHash" TEXT,
    "idempotencyKey" TEXT,
    "clientOriginalName" TEXT,
    "clientFileSize" INTEGER,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" DATETIME,
    "replacedById" TEXT,
    CONSTRAINT "FileVersion_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FileVersion_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FileVersion" ("clientFileSize", "clientOriginalName", "contentHash", "gameId", "id", "idempotencyKey", "originalName", "storagePath", "uploadedAt", "uploadedById", "versionNumber") SELECT "clientFileSize", "clientOriginalName", "contentHash", "gameId", "id", "idempotencyKey", "originalName", "storagePath", "uploadedAt", "uploadedById", "versionNumber" FROM "FileVersion";
DROP TABLE "FileVersion";
ALTER TABLE "new_FileVersion" RENAME TO "FileVersion";
CREATE UNIQUE INDEX "FileVersion_gameId_versionNumber_key" ON "FileVersion"("gameId", "versionNumber");
CREATE UNIQUE INDEX "FileVersion_gameId_uploadedById_idempotencyKey_key" ON "FileVersion"("gameId", "uploadedById", "idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
