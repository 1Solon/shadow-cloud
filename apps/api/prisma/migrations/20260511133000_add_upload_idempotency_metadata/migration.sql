ALTER TABLE "FileVersion" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "FileVersion" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "FileVersion" ADD COLUMN "clientOriginalName" TEXT;
ALTER TABLE "FileVersion" ADD COLUMN "clientFileSize" INTEGER;

CREATE UNIQUE INDEX "FileVersion_gameId_uploadedById_idempotencyKey_key"
ON "FileVersion"("gameId", "uploadedById", "idempotencyKey");
