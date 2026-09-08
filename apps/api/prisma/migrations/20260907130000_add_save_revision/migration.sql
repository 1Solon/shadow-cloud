ALTER TABLE "Game" ADD COLUMN "saveRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FileVersion" ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 0;
-- Legacy hashes were supplied by clients and cannot be treated as verified.
UPDATE "FileVersion" SET "contentHash" = NULL;
