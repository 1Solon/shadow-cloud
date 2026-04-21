-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GamePlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "userId" TEXT,
    "turnOrder" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PLAYER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GamePlayer" ("createdAt", "gameId", "id", "role", "turnOrder", "userId") SELECT "createdAt", "gameId", "id", "role", "turnOrder", "userId" FROM "GamePlayer";
DROP TABLE "GamePlayer";
ALTER TABLE "new_GamePlayer" RENAME TO "GamePlayer";
CREATE UNIQUE INDEX "GamePlayer_gameId_turnOrder_key" ON "GamePlayer"("gameId", "turnOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;