-- CreateTable
CREATE TABLE "PasswordResetApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "fileVersionId" TEXT NOT NULL,
    "contentRevision" INTEGER NOT NULL,
    "saveRevision" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "regimeName" TEXT NOT NULL,
    "gamePlayerId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverRole" TEXT NOT NULL,
    "reason" TEXT,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "PasswordResetApproval_gameId_state_idx" ON "PasswordResetApproval"("gameId", "state");

-- AlterTable
ALTER TABLE "PasswordReset" ADD COLUMN "approvalId" TEXT;
