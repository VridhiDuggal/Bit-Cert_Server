-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'revoked');

-- CreateTable
CREATE TABLE "Organisation" (
    "org_id" UUID NOT NULL,
    "msp_id" TEXT NOT NULL,
    "org_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "fabric_cert" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OrgStatus" NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "recipient_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "invited_by_org_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("recipient_id")
);

-- CreateTable
CREATE TABLE "InviteToken" (
    "invite_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("invite_id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "certificate_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "cert_hash" CHAR(64) NOT NULL,
    "ecdsa_signature" TEXT NOT NULL,
    "blockchain_tx_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("certificate_id")
);

-- CreateTable
CREATE TABLE "VerificationLog" (
    "log_id" UUID NOT NULL,
    "certificate_id" UUID NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifier_ip" TEXT NOT NULL,
    "result" BOOLEAN NOT NULL,

    CONSTRAINT "VerificationLog_pkey" PRIMARY KEY ("log_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_msp_id_key" ON "Organisation"("msp_id");

-- CreateIndex
CREATE INDEX "Organisation_email_idx" ON "Organisation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_email_key" ON "Recipient"("email");

-- CreateIndex
CREATE INDEX "Recipient_invited_by_org_id_idx" ON "Recipient"("invited_by_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "InviteToken_token_hash_key" ON "InviteToken"("token_hash");

-- CreateIndex
CREATE INDEX "InviteToken_org_id_idx" ON "InviteToken"("org_id");

-- CreateIndex
CREATE INDEX "InviteToken_recipient_email_idx" ON "InviteToken"("recipient_email");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_cert_hash_key" ON "Certificate"("cert_hash");

-- CreateIndex
CREATE INDEX "Certificate_org_id_idx" ON "Certificate"("org_id");

-- CreateIndex
CREATE INDEX "Certificate_recipient_id_idx" ON "Certificate"("recipient_id");

-- CreateIndex
CREATE INDEX "Certificate_blockchain_tx_id_idx" ON "Certificate"("blockchain_tx_id");

-- CreateIndex
CREATE INDEX "VerificationLog_certificate_id_idx" ON "VerificationLog"("certificate_id");

-- CreateIndex
CREATE INDEX "VerificationLog_verified_at_idx" ON "VerificationLog"("verified_at");

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_invited_by_org_id_fkey" FOREIGN KEY ("invited_by_org_id") REFERENCES "Organisation"("org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organisation"("org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organisation"("org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "Recipient"("recipient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationLog" ADD CONSTRAINT "VerificationLog_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "Certificate"("certificate_id") ON DELETE RESTRICT ON UPDATE CASCADE;
