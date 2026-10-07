CREATE TABLE "VictoryRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT,
    "gameNumber" INTEGER NOT NULL,
    "gameName" TEXT NOT NULL,
    "victorId" TEXT,
    "victorDisplayName" TEXT NOT NULL,
    "designatedById" TEXT,
    "designatedByDisplayName" TEXT NOT NULL,
    "designatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VictoryRecord_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VictoryRecord_victorId_fkey" FOREIGN KEY ("victorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VictoryRecord_designatedById_fkey" FOREIGN KEY ("designatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VictoryRecord_gameId_key" ON "VictoryRecord"("gameId");
CREATE INDEX "VictoryRecord_designatedAt_idx" ON "VictoryRecord"("designatedAt");
