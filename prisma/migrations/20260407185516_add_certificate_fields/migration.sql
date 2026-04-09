/*
  Warnings:

  - Added the required column `course` to the `Certificate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `issue_date` to the `Certificate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `recipient_name` to the `Certificate` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "course" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "issue_date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "issued_by" TEXT,
ADD COLUMN     "recipient_name" TEXT NOT NULL;
