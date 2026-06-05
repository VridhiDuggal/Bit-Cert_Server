'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../database/prismaClient');
const { sendOtpEmail } = require('./mail.service');

const OTP_EXPIRES_MS   = Number(process.env.OTP_EXPIRY_MINUTES ?? 10) * 60 * 1000;
const RESET_EXPIRES_MS = Number(process.env.RESET_TOKEN_EXPIRY_MINUTES ?? 15) * 60 * 1000;
const OTP_HASH_SECRET  = process.env.OTP_SECRET || process.env.JWT_SECRET || process.env.SESSION_SECRET;

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function otpDigest(email, otp) {
  return crypto.createHmac('sha256', OTP_HASH_SECRET).update(`${email}:${otp}`).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

async function sendOtp(email) {
  const org       = await prisma.organisation.findUnique({ where: { email } });
  const recipient = !org ? await prisma.recipient.findUnique({ where: { email } }) : null;

  if (!org && !recipient) {
    throw Object.assign(
      new Error('Account not found. Please log in or create an account first.'),
      { statusCode: 404 }
    );
  }

  await prisma.passwordResetToken.updateMany({
    where: { email, user_type: { in: ['otp_org', 'otp_recipient'] }, used_at: null },
    data:  { used_at: new Date() },
  });

  const user_type  = org ? 'otp_org' : 'otp_recipient';
  const otp        = generateOtp();
  const token_hash = otpDigest(email, otp);
  const expires_at = new Date(Date.now() + OTP_EXPIRES_MS);

  await prisma.passwordResetToken.create({
    data: { email, user_type, token_hash, expires_at },
  });

  await sendOtpEmail(email, otp);
}

async function verifyOtp(email, otp) {
  const token_hash = otpDigest(email, otp);

  const record = await prisma.passwordResetToken.findFirst({
    where: {
      email,
      user_type: { in: ['otp_org', 'otp_recipient'] },
      token_hash,
      used_at: null,
    },
    orderBy: { created_at: 'desc' },
  });

  if (!record) {
    throw Object.assign(new Error('Incorrect OTP. Please try again.'), { statusCode: 400 });
  }

  if (new Date() > record.expires_at) {
    throw Object.assign(new Error('OTP has expired. Please request a new one.'), { statusCode: 410 });
  }

  await prisma.passwordResetToken.update({
    where: { token_id: record.token_id },
    data:  { used_at: new Date() },
  });

  const raw        = crypto.randomBytes(32).toString('hex');
  const reset_hash = sha256(raw);
  const reset_type = record.user_type === 'otp_org' ? 'reset_org' : 'reset_recipient';

  await prisma.passwordResetToken.updateMany({
    where: { email, user_type: { in: ['reset_org', 'reset_recipient'] }, used_at: null },
    data:  { used_at: new Date() },
  });

  await prisma.passwordResetToken.create({
    data: { email, user_type: reset_type, token_hash: reset_hash, expires_at: new Date(Date.now() + RESET_EXPIRES_MS) },
  });

  return raw;
}

async function resetPassword(token, newPassword) {
  const token_hash = sha256(token);

  const record = await prisma.passwordResetToken.findFirst({
    where: {
      user_type: { in: ['reset_org', 'reset_recipient'] },
      token_hash,
      used_at: null,
    },
  });

  if (!record) {
    throw Object.assign(new Error('Invalid or expired reset token.'), { statusCode: 400 });
  }

  if (new Date() > record.expires_at) {
    throw Object.assign(new Error('Reset token has expired.'), { statusCode: 410 });
  }

  const password_hash = await bcrypt.hash(newPassword, 12);

  if (record.user_type === 'reset_org') {
    await prisma.organisation.update({ where: { email: record.email }, data: { password_hash } });
  } else {
    await prisma.recipient.update({ where: { email: record.email }, data: { password_hash } });
  }

  await prisma.passwordResetToken.update({
    where: { token_id: record.token_id },
    data:  { used_at: new Date() },
  });
}

module.exports = { sendOtp, verifyOtp, resetPassword };

