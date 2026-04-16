'use strict';

/**
 * backfill-org-recipients.js
 *
 * One-time script: populates the OrgRecipient join table from the legacy
 * invited_by_org_id column on the Recipient model.
 *
 * Safe to run multiple times — uses upsert (createMany with skipDuplicates).
 *
 * Usage:
 *   node scripts/backfill-org-recipients.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const recipients = await prisma.recipient.findMany({
    where:  { invited_by_org_id: { not: null } },
    select: { recipient_id: true, invited_by_org_id: true },
  });

  if (recipients.length === 0) {
    console.log('No recipients with invited_by_org_id found — nothing to backfill.');
    return;
  }

  const rows = recipients.map(r => ({
    org_id:       r.invited_by_org_id,
    recipient_id: r.recipient_id,
  }));

  const result = await prisma.orgRecipient.createMany({
    data:           rows,
    skipDuplicates: true,
  });

  console.log(`Backfill complete — ${result.count} OrgRecipient rows created (${rows.length - result.count} already existed).`);
}

main()
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
