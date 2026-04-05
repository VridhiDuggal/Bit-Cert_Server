'use strict';

const prisma = require('../database/prismaClient');

async function createRecipient(org_id, { email, name }) {
  const existing = await prisma.recipient.findUnique({ where: { email } });

  if (existing) {
    return existing;
  }

  return prisma.recipient.create({
    data: { email, name, invited_by_org_id: org_id },
  });
}

async function getRecipientById(recipient_id) {
  const recipient = await prisma.recipient.findUnique({ where: { recipient_id } });

  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }

  return recipient;
}

module.exports = { createRecipient, getRecipientById };
