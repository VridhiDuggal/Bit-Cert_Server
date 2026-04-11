-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "expiry_date" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "template_id" TEXT;
