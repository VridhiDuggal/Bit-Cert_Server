'use strict';

const crypto = require('crypto');
const prisma  = require('../database/prismaClient');
const { logAuditEvent } = require('./auditLog.service');

const INVITE_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000;

function toBase64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmacSign(data) {
  return crypto.createHmac('sha256', process.env.INVITE_SECRET).update(data).digest();
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function generateInviteToken(org_id, recipient_email) {
  const raw = crypto.randomBytes(32);
  const sig  = hmacSign(raw);
  const token = toBase64url(raw) + '.' + toBase64url(sig);
  const token_hash = sha256Hex(token);
  const expires_at = new Date(Date.now() + INVITE_EXPIRES_MS);

  await prisma.inviteToken.create({
    data: { org_id, recipient_email, token_hash, expires_at },
  });

  await logAuditEvent({ org_id, action: 'INVITE', target: recipient_email });

  return token;
}

async function validateInviteToken(token) {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw Object.assign(new Error('Invalid invite token.'), { statusCode: 400 });
  }

  const [rawB64, sigB64] = parts;

  let rawBuf;
  try {
    rawBuf = Buffer.from(rawB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    throw Object.assign(new Error('Invalid invite token.'), { statusCode: 400 });
  }

  const expectedSig = hmacSign(rawBuf);
  const receivedSig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  if (
    expectedSig.length !== receivedSig.length ||
    !crypto.timingSafeEqual(expectedSig, receivedSig)
  ) {
    throw Object.assign(new Error('Invalid invite token.'), { statusCode: 400 });
  }

  const token_hash = sha256Hex(token);

  const invite = await prisma.inviteToken.findUnique({ where: { token_hash } });

  if (!invite) {
    throw Object.assign(new Error('Invite token not found.'), { statusCode: 404 });
  }

  if (invite.used_at) {
    throw Object.assign(new Error('Invite token has already been used.'), { statusCode: 410 });
  }

  if (new Date() > invite.expires_at) {
    throw Object.assign(new Error('Invite token has expired.'), { statusCode: 410 });
  }

  return invite;
}

async function markTokenUsed(token_hash) {
  await prisma.inviteToken.update({
    where: { token_hash },
    data:  { used_at: new Date() },
  });
}

async function previewInvite({ token }) {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw Object.assign(new Error('Invalid invite token.'), { statusCode: 400 });
  }

  const [rawB64, sigB64] = parts;

  let rawBuf;
  try {
    rawBuf = Buffer.from(rawB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    throw Object.assign(new Error('Invalid invite token.'), { statusCode: 400 });
  }

  const expectedSig = hmacSign(rawBuf);
  const receivedSig = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  if (
    expectedSig.length !== receivedSig.length ||
    !crypto.timingSafeEqual(expectedSig, receivedSig)
  ) {
    throw Object.assign(new Error('Invalid invite token.'), { statusCode: 400 });
  }

  const token_hash = sha256Hex(token);
  const invite = await prisma.inviteToken.findUnique({ where: { token_hash } });

  if (!invite) throw Object.assign(new Error('Invite token not found.'), { statusCode: 400 });
  if (invite.used_at) throw Object.assign(new Error('Invite has already been accepted.'), { statusCode: 400 });
  if (new Date() > invite.expires_at) throw Object.assign(new Error('Invite token has expired.'), { statusCode: 400 });

  const org = await prisma.organisation.findUnique({
    where:  { org_id: invite.org_id },
    select: { org_name: true },
  });

  return {
    org_name:        org?.org_name ?? null,
    recipient_email: invite.recipient_email,
    expires_at:      invite.expires_at,
  };
}

module.exports = { generateInviteToken, validateInviteToken, markTokenUsed, previewInvite };
