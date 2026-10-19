-- AlterTable
ALTER TABLE "Game" ADD COLUMN "inactivityWarnedAt" DATETIME;
ALTER TABLE "Game" ADD COLUMN "finalInactivityWarnedAt" DATETIME;

-- CreateIndex
CREATE INDEX "AuditEvent_gameId_eventType_createdAt_idx" ON "AuditEvent"("gameId", "eventType", "createdAt");
