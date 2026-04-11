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

  const token = jwt.sign(
    { sub: org.org_id, org_id: org.org_id, role: 'org', org_name: org.org_name, email: org.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' }
  );

  const expiresAt = (() => {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (payload.exp) return payload.exp * 1000;
      }
    } catch {}
    return Date.now() + 24 * 60 * 60 * 1000;
  })();

  return { org: safeOrg, token, expiresAt };
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

async function getOrgRecipients(org_id, page, limit, search, status) {
  const skip = (page - 1) * limit;
  const now  = new Date();

  const andClauses = [{ invited_by_org_id: org_id }];
  if (search) {
    andClauses.push({
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { name:  { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (status === 'active')    andClauses.push({ status: 'active' });
  if (status === 'suspended') andClauses.push({ status: 'suspended' });

  const where = { AND: andClauses };

  const [rows, total] = await Promise.all([
    prisma.recipient.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
      select: {
        recipient_id:  true,
        email:         true,
        name:          true,
        status:        true,
        notes:         true,
        created_at:    true,
        last_login_at: true,
        password_hash: true,
        certificates: {
          where:   { org_id },
          orderBy: { issued_at: 'desc' },
          take: 1,
          select:  { issued_at: true },
        },
        _count: {
          select: { certificates: { where: { org_id } } },
        },
      },
    }),
    prisma.recipient.count({ where }),
  ]);

  // Batch-fetch the latest invite token per email for this org
  const emails = rows.filter(r => !r.password_hash).map(r => r.email);
  const inviteTokenMap = {};
  if (emails.length > 0) {
    const tokens = await prisma.inviteToken.findMany({
      where:   { org_id, recipient_email: { in: emails } },
      orderBy: { created_at: 'desc' },
      select:  { recipient_email: true, used_at: true, expires_at: true },
    });
    for (const t of tokens) {
      if (!inviteTokenMap[t.recipient_email]) inviteTokenMap[t.recipient_email] = t;
    }
  }

  const data = rows
    .filter(r => {
      if (status !== 'invite_pending') return true;
      return !r.password_hash;
    })
    .map(r => {
      let invite_status = 'accepted';
      if (!r.password_hash) {
        const token = inviteTokenMap[r.email];
        if (token && !token.used_at && token.expires_at > now) invite_status = 'pending';
        else invite_status = 'expired';
      }
      return {
        recipient_id:      r.recipient_id,
        email:             r.email,
        name:              r.name,
        status:            r.status,
        notes:             r.notes,
        created_at:        r.created_at,
        last_login_at:     r.last_login_at,
        cert_count:        r._count.certificates,
        certificate_count: r._count.certificates,
        invite_status,
        invite_accepted:   r.password_hash !== null,
        latest_cert_date:  r.certificates?.[0]?.issued_at ?? null,
      };
    });

  const total_filtered = status === 'invite_pending' ? data.length : total;

  return { data, total: total_filtered, page, limit };
}

async function getOrgRecipientDetail(org_id, recipient_id) {
  const now = new Date();

  const r = await prisma.recipient.findUnique({
    where:  { recipient_id },
    include: {
      certificates: {
        where:   { org_id },
        orderBy: { issued_at: 'desc' },
        select:  {
          certificate_id: true,
          cert_hash:      true,
          course:         true,
          issue_date:     true,
          issued_at:      true,
          is_revoked:     true,
          file_path:      true,
        },
      },
    },
  });

  if (!r) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }
  if (r.invited_by_org_id !== org_id) {
    throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  }

  let invite_status = 'accepted';
  if (!r.password_hash) {
    const latestToken = await prisma.inviteToken.findFirst({
      where:   { org_id, recipient_email: r.email },
      orderBy: { created_at: 'desc' },
      select:  { used_at: true, expires_at: true },
    });
    if (latestToken && !latestToken.used_at && latestToken.expires_at > now) invite_status = 'pending';
    else invite_status = 'expired';
  }

  const { password_hash, ...safe } = r;
  return { ...safe, invite_status };
}

async function updateOrgRecipient(org_id, recipient_id, data) {
  const existing = await prisma.recipient.findUnique({ where: { recipient_id } });

  if (!existing) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }
  if (existing.invited_by_org_id !== org_id) {
    throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  }

  const updated = await prisma.recipient.update({
    where: { recipient_id },
    data,
  });

  if (data.status && data.status !== existing.status) {
    const action = data.status === 'suspended' ? 'RECIPIENT_SUSPEND' : 'RECIPIENT_UNSUSPEND';
    await logAuditEvent({ org_id, action, target: existing.email });
  }

  const { password_hash, ...safe } = updated;
  return safe;
}

async function getOrgCertificates(org_id, page, limit, { search, status, from_date, to_date, tags, expiry_status } = {}) {
  const skip = (page - 1) * limit;
  const now  = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

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
  if (tags && tags.length) {
    for (const tag of tags) {
      andClauses.push({ tags: { has: tag } });
    }
  }
  if (expiry_status === 'active') {
    andClauses.push({ expiry_date: { gt: in30 } });
  } else if (expiry_status === 'expiring_soon') {
    andClauses.push({ expiry_date: { gte: now, lte: in30 } });
  } else if (expiry_status === 'expired') {
    andClauses.push({ expiry_date: { lt: now } });
  }

  const where = { org_id, ...(andClauses.length ? { AND: andClauses } : {}) };

  const [certs, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      orderBy: { issued_at: 'desc' },
      skip,
      take: limit,
      include: {
        recipient: { select: { name: true, email: true } },
        _count:    { select: { verificationLogs: true } },
      },
    }),
    prisma.certificate.count({ where }),
  ]);

  const data = certs.map(c => ({
    certificate_id:     c.certificate_id,
    cert_hash:          c.cert_hash,
    course:             c.course,
    description:        c.description,
    tags:               c.tags,
    expiry_date:        c.expiry_date,
    issued_at:          c.issued_at,
    issue_date:         c.issue_date,
    is_revoked:         c.is_revoked,
    blockchain_tx_id:   c.blockchain_tx_id,
    recipient_name:     c.recipient.name,
    recipient_email:    c.recipient.email,
    verification_count: c._count.verificationLogs,
  }));

  return { data, total, page, limit };
}

async function getOrgStats(org_id) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total_certificates, total_recipients, revoked_certificates, pendingInvites, monthlyVerifications] = await Promise.all([
    prisma.certificate.count({ where: { org_id } }),
    prisma.recipient.count({ where: { invited_by_org_id: org_id } }),
    prisma.certificate.count({ where: { org_id, is_revoked: true } }),
    prisma.inviteToken.count({
      where: {
        org_id,
        used_at:    null,
        expires_at: { gt: now },
      },
    }),
    prisma.verificationLog.count({
      where: {
        verified_at: { gte: startOfMonth },
        certificate: { org_id },
      },
    }),
  ]);

  return {
    total_certificates,
    total_recipients,
    revoked_certificates,
    active_certificates: total_certificates - revoked_certificates,
    pendingInvites,
    monthlyVerifications,
  };
}

function buildActivityDescription(action, target, metadata) {
  if (action === 'ISSUE')            return `Certificate issued to ${metadata?.recipient_email ?? target}`;
  if (action === 'REVOKE')           return `Certificate revoked (${target})`;
  if (action === 'INVITE')           return `Invite sent to ${target}`;
  if (action === 'RECIPIENT_CREATE') return `Recipient registered: ${target}`;
  return `${action}: ${target}`;
}

async function getRecentActivity(org_id) {
  const logs = await prisma.auditLog.findMany({
    where:   { org_id },
    orderBy: { created_at: 'desc' },
    take: 10,
  });

  return logs.map(l => ({
    log_id:      l.log_id,
    action:      l.action,
    target:      l.target,
    metadata:    l.metadata,
    created_at:  l.created_at,
    description: buildActivityDescription(l.action, l.target, l.metadata),
  }));
}

async function getIssuanceChart(org_id) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }

  const results = await Promise.all(
    months.map(({ year, month }) => {
      const from = new Date(year, month, 1);
      const to   = new Date(year, month + 1, 1);
      return prisma.certificate.count({
        where: { org_id, issued_at: { gte: from, lt: to } },
      });
    })
  );

  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return months.map(({ month }, i) => ({
    month: MONTH_LABELS[month],
    count: results[i],
  }));
}

async function getOrgAuditLogs(org_id, page, limit, { action, date_from, date_to, target } = {}) {
  const skip = (page - 1) * limit;
  const andClauses = [{ org_id }];
  if (action)    andClauses.push({ action });
  if (target)    andClauses.push({ target: { contains: target, mode: 'insensitive' } });
  if (date_from) andClauses.push({ created_at: { gte: new Date(date_from) } });
  if (date_to)   andClauses.push({ created_at: { lte: new Date(date_to) } });

  const where = { AND: andClauses };

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page, limit };
}

async function exportOrgAuditLogs(org_id, { action, date_from, date_to, target } = {}) {
  const andClauses = [{ org_id }];
  if (action)    andClauses.push({ action });
  if (target)    andClauses.push({ target: { contains: target, mode: 'insensitive' } });
  if (date_from) andClauses.push({ created_at: { gte: new Date(date_from) } });
  if (date_to)   andClauses.push({ created_at: { lte: new Date(date_to) } });

  const where = { AND: andClauses };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { created_at: 'desc' },
  });

  const escapeCSV = v => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines = [['Date', 'Action', 'Target', 'Details'].map(escapeCSV).join(',')];
  for (const r of rows) {
    lines.push([
      escapeCSV(new Date(r.created_at).toLocaleString()),
      escapeCSV(r.action),
      escapeCSV(r.target),
      escapeCSV(r.metadata ? JSON.stringify(r.metadata) : ''),
    ].join(','));
  }
  return lines.join('\n');
}

async function getVerificationHistoryByCertId(certificate_id) {
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

  return {
    total_verifications,
    last_verified_at: lastLog?.verified_at ?? null,
    weekly_counts: [
      { week: 'This Week', count: weekCounts[0] },
      { week: 'Week 2',    count: weekCounts[1] },
      { week: 'Week 3',    count: weekCounts[2] },
      { week: 'Week 4',    count: weekCounts[3] },
    ],
  };
}

async function getCertificateById(org_id, certificate_id) {
  const cert = await prisma.certificate.findUnique({
    where:   { certificate_id },
    include: {
      recipient: { select: { name: true, email: true } },
    },
  });

  if (!cert) {
    throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  }

  if (cert.org_id !== org_id) {
    throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  }

  const verification_history = await getVerificationHistoryByCertId(certificate_id);

  return {
    certificate_id:       cert.certificate_id,
    cert_hash:            cert.cert_hash,
    recipient_name:       cert.recipient_name,
    course:               cert.course,
    description:          cert.description,
    tags:                 cert.tags,
    expiry_date:          cert.expiry_date,
    issue_date:           cert.issue_date,
    issued_by:            cert.issued_by,
    issued_at:            cert.issued_at,
    is_revoked:           cert.is_revoked,
    blockchain_tx_id:     cert.blockchain_tx_id,
    file_path:            cert.file_path,
    recipient:            cert.recipient,
    verification_count:   verification_history.total_verifications,
    verification_history,
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

async function updateOrgProfile(org_id, data) {
  const updateData = {};
  if (data.org_name !== undefined)   updateData.org_name    = data.org_name;
  if (data.logo_url !== undefined)   updateData.logo_url    = data.logo_url;
  if (data.website !== undefined)    updateData.website     = data.website;
  if (data.description !== undefined) updateData.description = data.description;

  const org = await prisma.organisation.update({
    where: { org_id },
    data:  updateData,
  });

  const { private_key, password_hash, ...profile } = org;
  return profile;
}

module.exports = { onboardOrg, loginOrg, getOrgRecipients, getOrgRecipientDetail, updateOrgRecipient, getOrgCertificates, getOrgStats, getOrgAuditLogs, exportOrgAuditLogs, getCertificateById, getOrgProfile, updateOrgProfile, getRecentActivity, getIssuanceChart };
