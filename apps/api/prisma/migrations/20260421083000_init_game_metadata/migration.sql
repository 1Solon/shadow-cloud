-- AlterTable
ALTER TABLE "Game" ADD COLUMN "playerCount" INTEGER;
ALTER TABLE "Game" ADD COLUMN "hasAiPlayers" BOOLEAN;
ALTER TABLE "Game" ADD COLUMN "dlcMode" TEXT;
ALTER TABLE "Game" ADD COLUMN "gameMode" TEXT;
ALTER TABLE "Game" ADD COLUMN "techLevel" INTEGER;
ALTER TABLE "Game" ADD COLUMN "zoneCount" TEXT;
ALTER TABLE "Game" ADD COLUMN "armyCount" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Game_gameNumber_key" ON "Game"("gameNumber");