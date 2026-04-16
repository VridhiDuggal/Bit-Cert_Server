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

  await prisma.recipient.update({ where: { recipient_id: recipient.recipient_id }, data: { last_login_at: new Date() } });

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
  let recipient = await prisma.recipient.findUnique({ where: { email } });
  let isNew = false;

  if (!recipient) {
    recipient = await prisma.recipient.create({
      data: { email, name, invited_by_org_id: org_id },
    });
    isNew = true;
  }

  await prisma.orgRecipient.upsert({
    where:  { org_id_recipient_id: { org_id, recipient_id: recipient.recipient_id } },
    create: { org_id, recipient_id: recipient.recipient_id },
    update: {},
  });

  if (isNew) {
    await logAuditEvent({ org_id, action: 'RECIPIENT_CREATE', target: email });
  }

  return recipient;
}

async function getRecipientById(recipient_id) {
  const recipient = await prisma.recipient.findUnique({ where: { recipient_id } });

  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }

  return recipient;
}

async function getRecipientOrgs(recipient_id) {
  const rows = await prisma.orgRecipient.findMany({
    where:   { recipient_id },
    include: {
      organisation: {
        select: { org_id: true, org_name: true, logo_url: true },
      },
    },
  });

  const orgIds = rows.map(r => r.org_id);

  const certCounts = await prisma.certificate.groupBy({
    by:    ['org_id'],
    where: { recipient_id, org_id: { in: orgIds } },
    _count: { certificate_id: true },
  });

  const countMap = {};
  for (const c of certCounts) countMap[c.org_id] = c._count.certificate_id;

  return rows.map(r => ({
    org_id:     r.organisation.org_id,
    org_name:   r.organisation.org_name,
    logo_url:   r.organisation.logo_url,
    cert_count: countMap[r.org_id] ?? 0,
    joined_at:  r.joined_at,
  }));
}

async function getRecipientCertificates(recipient_id, { page = 1, limit = 12, search, status, from_date, to_date, org_id } = {}) {
  const andClauses = [];
  if (org_id) andClauses.push({ org_id });
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

  const skip = (page - 1) * limit;

  const [total, certs] = await prisma.$transaction([
    prisma.certificate.count({ where }),
    prisma.certificate.findMany({
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
      skip,
      take: limit,
    }),
  ]);

  const certificates = certs.map(c => ({
    certificate_id:   c.certificate_id,
    cert_hash:        c.cert_hash,
    course:           c.course,
    issued_at:        c.issued_at,
    is_revoked:       c.is_revoked,
    blockchain_tx_id: c.blockchain_tx_id,
    org_name:         c.organisation.org_name,
    msp_id:           c.organisation.msp_id,
    issue_date:       c.issue_date,
    expiry_date:      c.expiry_date ?? null,
    is_expired:       c.expiry_date ? new Date(c.expiry_date) < new Date() : false,
    file_path:        c.file_path,
    qr_url:           `${process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173'}/verify/${c.cert_hash}`,
  }));

  return { certificates, total };
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
    qr_url:    `${process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173'}/verify/${cert.cert_hash}`,
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
    verification_url: `${process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173'}/verify/${cert.cert_hash}`,
  };
}

async function getRecipientProfile(recipient_id) {
  const [recipient, orgLinks] = await Promise.all([
    prisma.recipient.findUnique({
      where:  { recipient_id },
      select: {
        recipient_id:  true,
        name:          true,
        email:         true,
        did:           true,
        status:        true,
        created_at:    true,
        last_login_at: true,
        organisation:  { select: { org_name: true } },
      },
    }),
    prisma.orgRecipient.findMany({
      where:  { recipient_id },
      select: { organisation: { select: { org_id: true, org_name: true } } },
    }),
  ]);

  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }

  return {
    recipient_id:        recipient.recipient_id,
    name:                recipient.name,
    email:               recipient.email,
    did:                 recipient.did,
    status:              recipient.status,
    created_at:          recipient.created_at,
    last_login_at:       recipient.last_login_at,
    invited_by_org_name: recipient.organisation?.org_name ?? null,
    organisations:       orgLinks.map(l => ({ org_id: l.organisation.org_id, org_name: l.organisation.org_name })),
  };
}

async function getRecipientDashboardStats({ recipient_id }) {
  const [total_certificates, active_certificates, orgsResult, total_verifications] = await Promise.all([
    prisma.certificate.count({ where: { recipient_id } }),
    prisma.certificate.count({ where: { recipient_id, is_revoked: false } }),
    prisma.certificate.groupBy({ by: ['org_id'], where: { recipient_id } }),
    prisma.verificationLog.count({ where: { certificate: { recipient_id } } }),
  ]);

  return {
    total_certificates,
    active_certificates,
    orgs_count: orgsResult.length,
    total_verifications,
  };
}

async function getVerificationHistory({ certificate_id, recipient_id }) {
  const cert = await prisma.certificate.findUnique({ where: { certificate_id } });
  if (!cert) throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  if (cert.recipient_id !== recipient_id) throw Object.assign(new Error('Access denied.'), { statusCode: 403 });

  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);

  const [total_verifications, lastLog, recentLogs] = await Promise.all([
    prisma.verificationLog.count({ where: { certificate_id } }),
    prisma.verificationLog.findFirst({ where: { certificate_id }, orderBy: { verified_at: 'desc' }, select: { verified_at: true } }),
    prisma.verificationLog.findMany({ where: { certificate_id, verified_at: { gte: fourWeeksAgo } }, select: { verified_at: true } }),
  ]);

  const now = new Date();
  const weekCounts = [0, 0, 0, 0];
  for (const log of recentLogs) {
    const msAgo = now - new Date(log.verified_at);
    const weekIndex = Math.min(3, Math.floor(msAgo / (7 * 24 * 60 * 60 * 1000)));
    weekCounts[weekIndex]++;
  }

  const weekly_counts = [
    { week: 'This Week',  count: weekCounts[0] },
    { week: 'Week 2',     count: weekCounts[1] },
    { week: 'Week 3',     count: weekCounts[2] },
    { week: 'Week 4',     count: weekCounts[3] },
  ];

  return { total_verifications, last_verified_at: lastLog?.verified_at ?? null, weekly_counts };
}

async function updateRecipientProfile({ recipient_id, name }) {
  const updated = await prisma.recipient.update({
    where: { recipient_id },
    data:  { name },
    select: { recipient_id: true, name: true, email: true, created_at: true, last_login_at: true },
  });
  return updated;
}

async function changeRecipientPassword({ recipient_id, current_password, new_password }) {
  const recipient = await prisma.recipient.findUnique({ where: { recipient_id } });
  if (!recipient) throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });

  const valid = await bcrypt.compare(current_password, recipient.password_hash ?? '');
  if (!valid) throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 401 });

  const password_hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
  await prisma.recipient.update({ where: { recipient_id }, data: { password_hash } });

  return { message: 'Password updated successfully' };
}

module.exports = { loginRecipient, createRecipient, getRecipientById, getRecipientOrgs, getRecipientCertificates, getCertificateQR, getMyCertificateById, getRecipientProfile, getRecipientDashboardStats, getVerificationHistory, updateRecipientProfile, changeRecipientPassword };
