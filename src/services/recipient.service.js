'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const prisma = require('../database/prismaClient');
const { logAuditEvent } = require('./auditLog.service');

const BCRYPT_ROUNDS = 12;

async function loginRecipient({ email, password }) {
  const recipient = await prisma.recipient.findUnique({ where: { email } });

  if (!recipient || !recipient.password_hash) {
    throw Object.assign(new Error('Invalid email or password.'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(password, recipient.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Invalid email or password.'), { statusCode: 401 });
  }

  const token = jwt.sign(
    { sub: recipient.recipient_id, recipient_id: recipient.recipient_id, role: 'recipient', email: recipient.email, name: recipient.name },
    process.env.RECIPIENT_JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' }
  );

  return {
    token,
    recipient: { recipient_id: recipient.recipient_id, name: recipient.name, email: recipient.email },
  };
}

async function createRecipient(org_id, { email, name }) {
  const existing = await prisma.recipient.findUnique({ where: { email } });

  if (existing) {
    return existing;
  }

  const recipient = await prisma.recipient.create({
    data: { email, name, invited_by_org_id: org_id },
  });

  await logAuditEvent({ org_id, action: 'RECIPIENT_CREATE', target: email });

  return recipient;
}

async function getRecipientById(recipient_id) {
  const recipient = await prisma.recipient.findUnique({ where: { recipient_id } });

  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }

  return recipient;
}

async function getRecipientCertificates(recipient_id, { search, status, from_date, to_date } = {}) {
  const andClauses = [];
  if (search) {
    andClauses.push({
      OR: [
        { course:         { contains: search, mode: 'insensitive' } },
        { recipient_name: { contains: search, mode: 'insensitive' } },
        { organisation:   { org_name: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }
  if (status === 'active')  andClauses.push({ is_revoked: false });
  if (status === 'revoked') andClauses.push({ is_revoked: true });
  if (from_date) andClauses.push({ issued_at: { gte: new Date(from_date) } });
  if (to_date)   andClauses.push({ issued_at: { lte: new Date(to_date) } });

  const where = { recipient_id, ...(andClauses.length ? { AND: andClauses } : {}) };

  const certs = await prisma.certificate.findMany({
    where,
    include: {
      organisation: {
        select: {
          org_name: true,
          msp_id:   true,
        },
      },
    },
    orderBy: { issued_at: 'desc' },
  });

  return certs.map(c => ({
    certificate_id:   c.certificate_id,
    cert_hash:        c.cert_hash,
    course:           c.course,
    issued_at:        c.issued_at,
    is_revoked:       c.is_revoked,
    blockchain_tx_id: c.blockchain_tx_id,
    org_name:         c.organisation.org_name,
    msp_id:           c.organisation.msp_id,
    qr_url:           `${process.env.VERIFICATION_BASE_URL}/api/verify/${c.cert_hash}`,
  }));
}

async function getCertificateQR(recipient_id, certificate_id) {
  const cert = await prisma.certificate.findUnique({ where: { certificate_id } });

  if (!cert) {
    throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  }

  if (cert.recipient_id !== recipient_id) {
    throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  }

  return {
    cert_hash: cert.cert_hash,
    qr_url:    `${process.env.VERIFICATION_BASE_URL}/api/verify/${cert.cert_hash}`,
  };
}

async function getMyCertificateById(recipient_id, certificate_id) {
  const cert = await prisma.certificate.findUnique({
    where:   { certificate_id },
    include: { organisation: { select: { org_name: true, msp_id: true } } },
  });

  if (!cert) {
    throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  }

  if (cert.recipient_id !== recipient_id) {
    throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  }

  return {
    certificate_id:   cert.certificate_id,
    cert_hash:        cert.cert_hash,
    recipient_name:   cert.recipient_name,
    course:           cert.course,
    description:      cert.description,
    issue_date:       cert.issue_date,
    issued_by:        cert.issued_by,
    issued_at:        cert.issued_at,
    is_revoked:       cert.is_revoked,
    blockchain_tx_id: cert.blockchain_tx_id,
    file_path:        cert.file_path,
    org_name:         cert.organisation.org_name,
    msp_id:           cert.organisation.msp_id,
    verification_url: `${process.env.VERIFICATION_BASE_URL}/api/verify/${cert.cert_hash}`,
  };
}

async function getRecipientProfile(recipient_id) {
  const recipient = await prisma.recipient.findUnique({ where: { recipient_id } });

  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }

  return {
    recipient_id: recipient.recipient_id,
    name:         recipient.name,
    email:        recipient.email,
    created_at:   recipient.created_at,
  };
}

module.exports = { loginRecipient, createRecipient, getRecipientById, getRecipientCertificates, getCertificateQR, getMyCertificateById, getRecipientProfile };
