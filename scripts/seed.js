'use strict';

require('dotenv').config();

const prisma = require('../src/database/prismaClient');
const { connectGateway, submitTransaction, disconnectGateway } = require('../src/services/fabricService');

async function seed() {
  await connectGateway();

  const orgs = await prisma.organisation.findMany({
    select: { org_name: true, msp_id: true, public_key: true },
  });

  console.log(`Seeding ${orgs.length} organisation(s)...`);

  for (const org of orgs) {
    try {
      await submitTransaction('RegisterOrg', org.msp_id, org.public_key);
      console.log(`Registered: ${org.org_name} (${org.msp_id})`);
    } catch (err) {
      console.error(`Failed: ${org.org_name} (${org.msp_id}) — ${err.message}`);
    }
  }

  await disconnectGateway();
  await prisma.$disconnect();
}

seed().catch(err => {
  console.error(`Seed error: ${err.message}`);
  process.exit(1);
});
