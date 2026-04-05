/*
  Warnings:

  - You are about to drop the column `enrolled_at` on the `Recipient` table. All the data in the column will be lost.
  - Added the required column `name` to the `Recipient` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Recipient" DROP COLUMN "enrolled_at",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "did" DROP NOT NULL;
