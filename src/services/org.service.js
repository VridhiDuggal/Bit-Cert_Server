'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const prisma    = require('../database/prismaClient');
const { generateKeyPair }       = require('./cryptoService');
const { submitTransaction, evaluateTransaction } = require('./fabricService');
const { encrypt } = require('../utils/encryption.util');

const BCRYPT_ROUNDS = 12;

function deriveMspId(org_name) {
  return org_name
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') + 'MSP';
}

async function onboardOrg({ org_name, email, password }) {
  const msp_id = deriveMspId(org_name);

  const existing = await prisma.organisation.findFirst({
    where: { OR: [{ email }, { msp_id }] },
  });

  if (existing) {
    const err = new Error('An organisation with this email already exists.');
    err.statusCode = 409;
    throw err;
  }

  const { publicKey, privateKey } = generateKeyPair();
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const encryptedPrivateKey = encrypt(privateKey);

  const org = await prisma.organisation.create({
    data: { org_name, msp_id, email, public_key: publicKey, private_key: encryptedPrivateKey, password_hash },
  });

  try {
    let alreadyRegistered = false;
    try {
      const existing_key = await evaluateTransaction('GetOrgPublicKey', msp_id);
      if (existing_key) alreadyRegistered = true;
    } catch {
      alreadyRegistered = false;
    }

    if (alreadyRegistered) {
      throw new Error(`Organisation is already registered on the blockchain.`);
    }

    await submitTransaction('RegisterOrg', msp_id, publicKey);
  } catch (fabricErr) {
    await prisma.organisation.delete({ where: { org_id: org.org_id } });
    const err = new Error('Blockchain registration failed. Please try again.');
    err.statusCode = 503;
    throw err;
  }

  const { private_key, password_hash: _ph, msp_id: _msp, public_key: _pk, ...safeOrg } = org;
  return safeOrg;
}

async function loginOrg({ email, password }) {
  const org = await prisma.organisation.findUnique({ where: { email } });

  if (!org) {
    const err = new Error('Invalid email or password.');
    err.statusCode = 401;
    throw err;
  }

  if (org.status === 'revoked') {
    const err = new Error('This organisation has been revoked.');
    err.statusCode = 403;
    throw err;
  }

  const valid = await bcrypt.compare(password, org.password_hash);
  if (!valid) {
    const err = new Error('Invalid email or password.');
    err.statusCode = 401;
    throw err;
  }

  const token = jwt.sign(
    { sub: org.org_id, org_id: org.org_id, role: 'org', org_name: org.org_name, email: org.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' }
  );

  return {
    token,
    org: { org_id: org.org_id, org_name: org.org_name, email: org.email },
  };
}

async function getOrgRecipients(org_id, page, limit, search) {
  const skip = (page - 1) * limit;

  const where = {
    invited_by_org_id: org_id,
    ...(search ? {
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { name:  { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.recipient.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
      select: {
        recipient_id: true,
        email:        true,
        name:         true,
        created_at:   true,
      },
    }),
    prisma.recipient.count({ where }),
  ]);

  return { data, total, page, limit };
}

async function getOrgCertificates(org_id, page, limit, { search, status, from_date, to_date } = {}) {
  const skip = (page - 1) * limit;

  const andClauses = [];
  if (search) {
    andClauses.push({
      OR: [
        { recipient_name: { contains: search, mode: 'insensitive' } },
        { course:         { contains: search, mode: 'insensitive' } },
        { recipient: { email: { contains: search, mode: 'insensitive' } } },
      ],
    });
  }
  if (status === 'active')  andClauses.push({ is_revoked: false });
  if (status === 'revoked') andClauses.push({ is_revoked: true });
  if (from_date) andClauses.push({ issued_at: { gte: new Date(from_date) } });
  if (to_date)   andClauses.push({ issued_at: { lte: new Date(to_date) } });

  const where = { org_id, ...(andClauses.length ? { AND: andClauses } : {}) };

  const [certs, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      orderBy: { issued_at: 'desc' },
      skip,
      take: limit,
      include: {
        recipient: {
          select: { name: true, email: true },
        },
      },
    }),
    prisma.certificate.count({ where }),
  ]);

  const data = certs.map(c => ({
    certificate_id:   c.certificate_id,
    cert_hash:        c.cert_hash,
    course:           c.course,
    issued_at:        c.issued_at,
    is_revoked:       c.is_revoked,
    blockchain_tx_id: c.blockchain_tx_id,
    recipient_name:   c.recipient.name,
    recipient_email:  c.recipient.email,
  }));

  return { data, total, page, limit };
}

async function getOrgStats(org_id) {
  const [total_certificates, total_recipients, revoked_certificates] = await Promise.all([
    prisma.certificate.count({ where: { org_id } }),
    prisma.recipient.count({ where: { invited_by_org_id: org_id } }),
    prisma.certificate.count({ where: { org_id, is_revoked: true } }),
  ]);

  return {
    total_certificates,
    total_recipients,
    revoked_certificates,
    active_certificates: total_certificates - revoked_certificates,
  };
}

async function getOrgAuditLogs(org_id, page, limit) {
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where:   { org_id },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where: { org_id } }),
  ]);

  return { data, total, page, limit };
}

async function getCertificateById(org_id, certificate_id) {
  const cert = await prisma.certificate.findUnique({
    where:   { certificate_id },
    include: { recipient: { select: { name: true, email: true } } },
  });

  if (!cert) {
    throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  }

  if (cert.org_id !== org_id) {
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
    recipient:        cert.recipient,
  };
}

async function getOrgProfile(org_id) {
  const org = await prisma.organisation.findUnique({ where: { org_id } });

  if (!org) {
    throw Object.assign(new Error('Organisation not found.'), { statusCode: 404 });
  }

  const { private_key, password_hash, ...profile } = org;
  return profile;
}

async function updateOrgProfile(org_id, { org_name }) {
  const org = await prisma.organisation.update({
    where: { org_id },
    data:  { org_name },
  });

  const { private_key, password_hash, ...profile } = org;
  return profile;
}

module.exports = { onboardOrg, loginOrg, getOrgRecipients, getOrgCertificates, getOrgStats, getOrgAuditLogs, getCertificateById, getOrgProfile, updateOrgProfile };
