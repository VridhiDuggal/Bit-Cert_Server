-- Step 7: Organisation auth fields
-- Drop old fabric_cert column (not used in MVP)
ALTER TABLE "Organisation" DROP COLUMN IF EXISTS "fabric_cert";

-- Add private_key and password_hash
ALTER TABLE "Organisation" ADD COLUMN "private_key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Organisation" ADD COLUMN "password_hash" TEXT NOT NULL DEFAULT '';

-- Remove placeholder defaults after adding (columns already exist, strip defaults)
ALTER TABLE "Organisation" ALTER COLUMN "private_key" DROP DEFAULT;
ALTER TABLE "Organisation" ALTER COLUMN "password_hash" DROP DEFAULT;

-- Add default value for status
ALTER TABLE "Organisation" ALTER COLUMN "status" SET DEFAULT 'active';

-- Add unique constraint on email
CREATE UNIQUE INDEX IF NOT EXISTS "Organisation_email_key" ON "Organisation"("email");
