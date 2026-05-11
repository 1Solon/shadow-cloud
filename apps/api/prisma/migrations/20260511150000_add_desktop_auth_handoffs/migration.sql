CREATE TABLE "DesktopAuthHandoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollSecretHash" TEXT NOT NULL,
    "approvedUserId" TEXT,
    "approvedUserEmail" TEXT,
    "approvedUserDisplayName" TEXT,
    "approvedUserAvatarUrl" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "approvedAt" DATETIME,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "DesktopAuthHandoff_expiresAt_idx" ON "DesktopAuthHandoff"("expiresAt");
CREATE INDEX "DesktopAuthHandoff_consumedAt_idx" ON "DesktopAuthHandoff"("consumedAt");
