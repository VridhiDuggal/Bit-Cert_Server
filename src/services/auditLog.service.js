'use strict';

const prisma = require('../database/prismaClient');

async function logAuditEvent({ org_id, action, target, metadata = null }) {
  return prisma.auditLog.create({
    data: { org_id, action, target, metadata },
  });
}

module.exports = { logAuditEvent };
