'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../database/prismaClient');
const { sendPasswordResetEmail } = require('./mail.service');

const RESET_EXPIRES_MS = 60 * 60 * 1000;

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function generateResetToken(email) {
  const org       = await prisma.organisation.findUnique({ where: { email } });
  const recipient = !org ? await prisma.recipient.findUnique({ where: { email } }) : null;

  if (!org && !recipient) {
    return;
  }

  const user_type  = org ? 'org' : 'recipient';
  const raw        = crypto.randomBytes(32).toString('hex');
  const token_hash = sha256Hex(raw);
  const expires_at = new Date(Date.now() + RESET_EXPIRES_MS);

  await prisma.passwordResetToken.create({
    data: { email, user_type, token_hash, expires_at },
  });

  const base = process.env.APP_BASE_URL ?? process.env.VERIFICATION_BASE_URL ?? 'http://localhost:5173';
  const resetLink = `${base}/reset-password?token=${raw}`;

  await sendPasswordResetEmail(email, resetLink);
}

async function resetPassword(token, newPassword) {
  const token_hash = sha256Hex(token);

  const record = await prisma.passwordResetToken.findUnique({ where: { token_hash } });

  if (!record) {
    throw Object.assign(new Error('Invalid or expired reset token.'), { statusCode: 400 });
  }

  if (record.used_at) {
    throw Object.assign(new Error('Reset token has already been used.'), { statusCode: 410 });
  }

  if (new Date() > record.expires_at) {
    throw Object.assign(new Error('Reset token has expired.'), { statusCode: 410 });
  }

  const password_hash = await bcrypt.hash(newPassword, 12);

  if (record.user_type === 'org') {
    await prisma.organisation.update({ where: { email: record.email }, data: { password_hash } });
  } else {
    await prisma.recipient.update({ where: { email: record.email }, data: { password_hash } });
  }

  await prisma.passwordResetToken.update({ where: { token_hash }, data: { used_at: new Date() } });
}

module.exports = { generateResetToken, resetPassword };
