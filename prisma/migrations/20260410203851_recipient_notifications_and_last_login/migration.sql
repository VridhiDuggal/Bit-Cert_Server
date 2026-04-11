/*
  Warnings:

  - You are about to drop the column `message` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `org_id` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `read_at` on the `Notification` table. All the data in the column will be lost.
  - Added the required column `body` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `recipient_id` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('CERTIFICATE_ISSUED', 'CERTIFICATE_REVOKED', 'WELCOME');

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_org_id_fkey";

-- DropIndex
DROP INDEX "Notification_org_id_idx";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "message",
DROP COLUMN "metadata",
DROP COLUMN "org_id",
DROP COLUMN "read_at",
ADD COLUMN     "body" TEXT NOT NULL,
ADD COLUMN     "cert_hash" TEXT,
ADD COLUMN     "is_read" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recipient_id" UUID NOT NULL,
DROP COLUMN "type",
ADD COLUMN     "type" "NotificationType" NOT NULL;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "last_login_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_recipient_id_idx" ON "Notification"("recipient_id");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "Recipient"("recipient_id") ON DELETE CASCADE ON UPDATE CASCADE;
