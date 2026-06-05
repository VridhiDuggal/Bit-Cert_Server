'use strict';

require('dotenv').config();

const prisma = require('../src/database/prismaClient');
const { connectGateway, submitTransaction, evaluateTransaction, disconnectGateway } = require('../src/services/fabricService');

async function syncOrgsToChain() {
  let fabricAvailable = true;

  try {
    await connectGateway();
  } catch (err) {
    console.warn(`[syncOrgsToChain] Fabric unreachable — skipping sync. (${err.message})`);
    fabricAvailable = false;
  }

  if (!fabricAvailable) {
    await prisma.$disconnect();
    return;
  }

  const orgs = await prisma.organisation.findMany({
    where: { status: 'active' },
    select: { org_name: true, msp_id: true, public_key: true },
  });

  console.log(`[syncOrgsToChain] Found ${orgs.length} active organisation(s) to sync.`);

  for (const org of orgs) {
    try {
      let alreadyRegistered = false;
      try {
        const existing = await evaluateTransaction('GetOrgPublicKey', org.msp_id);
        if (existing) alreadyRegistered = true;
      } catch {
        alreadyRegistered = false;
      }

      if (alreadyRegistered) {
        console.log(`[syncOrgsToChain] Already on chain — skipping: ${org.org_name} (${org.msp_id})`);
        continue;
      }

      await submitTransaction('RegisterOrg', org.msp_id, org.public_key);
      console.log(`[syncOrgsToChain] Registered: ${org.org_name} (${org.msp_id})`);
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('already registered')) {
        console.log(`[syncOrgsToChain] Already registered on chain — skipping: ${org.org_name} (${org.msp_id})`);
      } else {
        console.warn(`[syncOrgsToChain] Failed to sync ${org.org_name} (${org.msp_id}): ${err.message}`);
      }
    }
  }

  await disconnectGateway();
  await prisma.$disconnect();

  console.log('[syncOrgsToChain] Sync complete.');
}

syncOrgsToChain().catch(err => {
  console.error(`[syncOrgsToChain] Fatal error: ${err.message}`);
  process.exit(1);
});
