-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';
