PRAGMA foreign_keys=OFF;

DROP TABLE "DesktopAuthHandoff";

CREATE TABLE "CompanionHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollSecretHash" TEXT NOT NULL,
    "pasteSecretHash" TEXT,
    "approvedUserId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanionHandoff_approvedUserId_fkey" FOREIGN KEY ("approvedUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "DeviceSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "refreshSecretHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CompanionHandoff_expiresAt_idx" ON "CompanionHandoff"("expiresAt");
CREATE INDEX "CompanionHandoff_consumedAt_idx" ON "CompanionHandoff"("consumedAt");
CREATE INDEX "DeviceSession_userId_revokedAt_idx" ON "DeviceSession"("userId", "revokedAt");
CREATE INDEX "DeviceSession_expiresAt_idx" ON "DeviceSession"("expiresAt");

PRAGMA foreign_keys=ON;
