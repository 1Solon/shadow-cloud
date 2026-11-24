-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TurnState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "activePlayerId" TEXT,
    "activePlayerEntryId" TEXT,
    "roundNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TurnState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TurnState_activePlayerId_fkey" FOREIGN KEY ("activePlayerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TurnState_activePlayerEntryId_fkey" FOREIGN KEY ("activePlayerEntryId") REFERENCES "GamePlayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TurnState" ("activePlayerEntryId", "activePlayerId", "gameId", "id", "roundNumber", "updatedAt") SELECT "activePlayerEntryId", "activePlayerId", "gameId", "id", "roundNumber", "updatedAt" FROM "TurnState";
DROP TABLE "TurnState";
ALTER TABLE "new_TurnState" RENAME TO "TurnState";
CREATE UNIQUE INDEX "TurnState_gameId_key" ON "TurnState"("gameId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

