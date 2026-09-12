CREATE TABLE "CompanionSubmission" (
    "accountId" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("accountId", "operationKey")
);
