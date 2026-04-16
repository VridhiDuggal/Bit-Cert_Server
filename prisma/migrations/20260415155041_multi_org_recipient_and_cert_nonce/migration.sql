-- DropForeignKey
ALTER TABLE "Recipient" DROP CONSTRAINT "Recipient_invited_by_org_id_fkey";

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "nonce" TEXT;

-- AlterTable
ALTER TABLE "Recipient" ALTER COLUMN "invited_by_org_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "OrgRecipient" (
    "org_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgRecipient_pkey" PRIMARY KEY ("org_id","recipient_id")
);

-- CreateIndex
CREATE INDEX "OrgRecipient_org_id_idx" ON "OrgRecipient"("org_id");

-- CreateIndex
CREATE INDEX "OrgRecipient_recipient_id_idx" ON "OrgRecipient"("recipient_id");

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_invited_by_org_id_fkey" FOREIGN KEY ("invited_by_org_id") REFERENCES "Organisation"("org_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRecipient" ADD CONSTRAINT "OrgRecipient_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organisation"("org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgRecipient" ADD CONSTRAINT "OrgRecipient_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "Recipient"("recipient_id") ON DELETE RESTRICT ON UPDATE CASCADE;
