'use strict';

const nodemailer = require('nodemailer');
const ejs        = require('ejs');
const path       = require('path');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool: true,
  tls: { rejectUnauthorized: false },
});

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'email');

async function renderTemplate(templateName, data) {
  const filePath = path.join(TEMPLATES_DIR, templateName);
  return ejs.renderFile(filePath, data);
}

async function sendInviteEmail(recipientEmail, inviteLink, orgName) {
  const html = await renderTemplate('invite.ejs', { inviteLink, orgName });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: recipientEmail,
    subject: `You've been invited by ${orgName} — Bit-Cert`,
    text: `${orgName} has invited you to Bit-Cert. Accept your invitation here: ${inviteLink}`,
    html,
  });
}

async function sendCertificateIssuedEmail(recipientEmail, recipientName, orgName, certHash, verificationUrl) {
  const html = await renderTemplate('certificate.ejs', { recipientName, orgName, verificationUrl });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: recipientEmail,
    subject: `Your certificate from ${orgName} is ready — Bit-Cert`,
    text: `Hi ${recipientName}, your certificate issued by ${orgName} is ready. Verify it here: ${verificationUrl}`,
    html,
  });
}

async function sendPasswordResetEmail(email, resetLink) {
  const html = await renderTemplate('password-reset.ejs', { resetLink });
  await transporter.sendMail({
    from:    process.env.SMTP_FROM,
    to:      email,
    subject: 'Reset your Bit-Cert password',
    text:    `Click the link to reset your password (expires in 1 hour): ${resetLink}`,
    html,
  });
}

module.exports = { sendInviteEmail, sendCertificateIssuedEmail, sendPasswordResetEmail };
