-- This migration was revised: the FK from InviteToken to Recipient is not valid
-- because InviteTokens are created before Recipients exist.
-- Delete any orphaned InviteToken rows (cleanup from previous partial run)
DELETE FROM "InviteToken" WHERE "recipient_email" NOT IN (SELECT "email" FROM "Recipient");

-- Drop the FK if it was applied
ALTER TABLE "InviteToken" DROP CONSTRAINT IF EXISTS "InviteToken_recipient_email_fkey";
