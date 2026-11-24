-- AlterTable
ALTER TABLE "PasswordReset" ADD COLUMN "reason" TEXT;
ALTER TABLE "PasswordReset" ADD COLUMN "undoReason" TEXT;
ALTER TABLE "PasswordReset" ADD COLUMN "undoRevision" INTEGER;
