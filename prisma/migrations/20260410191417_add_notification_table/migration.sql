-- AlterTable (columns already applied — skipped)

-- Drop incorrect table if it exists from a partial previous run
DROP TABLE IF EXISTS "Notification";

-- CreateTable
CREATE TABLE "Notification" (
    "notification_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("notification_id")
);

-- CreateIndex
CREATE INDEX "Notification_org_id_idx" ON "Notification"("org_id");

-- CreateIndex
CREATE INDEX "Notification_created_at_idx" ON "Notification"("created_at");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Organisation"("org_id") ON DELETE RESTRICT ON UPDATE CASCADE;
