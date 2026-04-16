'use strict';

const crypto   = require('crypto');
const prisma   = require('../database/prismaClient');
const { hashData, signData, verifySignature } = require('./cryptoService');
const { submitTransaction, evaluateTransaction } = require('./fabricService');
const { generateQRCode } = require('../utils/qr.util');
const { createRecipient } = require('./recipient.service');
const { logAuditEvent }  = require('./auditLog.service');
const { generateCertificatePDF } = require('./pdf.service');
const { decrypt } = require('../utils/encryption.util');
const { sendCertificateIssuedEmail } = require('./mail.service');
const { createNotification } = require('./notification.service');

async function issueCertificate({ org, recipient_id, recipient_email, recipient_name, course, description, issue_date, tags, expiry_date }) {
  let resolvedRecipientId = recipient_id;

  if (recipient_email) {
    const recipient = await createRecipient(org.org_id, { email: recipient_email, name: recipient_name });
    resolvedRecipientId = recipient.recipient_id;
  }

  console.info(`[CERT] Issuance started — org: ${org.msp_id}, recipient: ${resolvedRecipientId}`);

  const [recipient, orgRecord] = await Promise.all([
    prisma.recipient.findUnique({ where: { recipient_id: resolvedRecipientId } }),
    prisma.organisation.findUnique({
      where:  { org_id: org.org_id },
      select: { private_key: true, org_name: true },
    }),
  ]);

  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }
  if (!orgRecord) {
    throw Object.assign(new Error('Organisation not found.'), { statusCode: 404 });
  }

  const payload   = { msp_id: org.msp_id, recipient_name, course, issue_date };
  const nonce     = crypto.randomBytes(16).toString('hex');
  const cert_hash = hashData({ ...payload, nonce });

  const existingCert = await prisma.certificate.findUnique({ where: { cert_hash } });
  if (existingCert) {
    return {
      certificate_id:   existingCert.certificate_id,
      cert_hash:        existingCert.cert_hash,
      blockchain_tx_id: existingCert.blockchain_tx_id,
      file_path:        existingCert.file_path,
      qr_code:          null,
    };
  }

  const signature = signData(cert_hash, decrypt(orgRecord.private_key));

  let blockchain_tx_id;
  try {
    await submitTransaction('StoreCertificate', cert_hash, signature, org.msp_id, `uploads/${cert_hash}.pdf`);
    blockchain_tx_id = `tx_${cert_hash.slice(0, 16)}`;
  } catch (fabricErr) {
    console.error(`[CERT] Blockchain storage failed:`, fabricErr.message);
    throw Object.assign(
      new Error(`Blockchain storage failed: ${fabricErr.message}`),
      { statusCode: 503 }
    );
  }

  let certificate;
  try {
    certificate = await prisma.certificate.create({
      data: {
        org_id:          org.org_id,
        recipient_id:    resolvedRecipientId,
        cert_hash,
        nonce,
        ecdsa_signature: signature,
        blockchain_tx_id,
        file_path:       `uploads/${cert_hash}.pdf`,
        recipient_name,
        course,
        description:     description ?? null,
        tags:            tags ?? [],
        expiry_date:     expiry_date ? new Date(expiry_date) : null,
        issue_date:      new Date(issue_date),
        issued_by:       orgRecord.org_name,
      },
    });
  } catch (dbErr) {
    console.error(`[CERT] DB write failed after blockchain commit — cert_hash: ${cert_hash}, org: ${org.msp_id}. Manual reconciliation required.`);
    throw Object.assign(
      new Error('Certificate stored on blockchain but database write failed. Contact support with cert_hash: ' + cert_hash),
      { statusCode: 500 }
    );
  }

  const verificationUrl = `${process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173'}/verify/${cert_hash}`;
  const qr_code = await generateQRCode(verificationUrl);

  setImmediate(async () => {
    try {
      const pdfPath = await generateCertificatePDF({
        recipient_name,
        course,
        description,
        issue_date,
        org_name: orgRecord.org_name,
        cert_hash,
        certificate_id: certificate.certificate_id,
      });
      await prisma.certificate.update({ where: { cert_hash }, data: { file_path: pdfPath } });
    } catch (pdfErr) {
      console.error(`[CERT] PDF generation failed for ${cert_hash}:`, pdfErr.message);
    }
    try {
      await logAuditEvent({ org_id: org.org_id, action: 'ISSUE', target: cert_hash, metadata: { recipient_email: recipient_email ?? recipient?.email, course } });
    } catch (auditErr) {
      console.error(`[CERT] Audit log failed for ${cert_hash}:`, auditErr.message);
    }
  });

  createNotification({
    recipient_id: resolvedRecipientId,
    type: 'CERTIFICATE_ISSUED',
    title: 'New certificate issued',
    body: `${orgRecord.org_name} has issued you a certificate for ${course}.`,
    cert_hash,
  }).catch(() => {});

  const recipientRecord = await prisma.recipient.findUnique({ where: { recipient_id: resolvedRecipientId }, select: { email: true } });
  if (recipientRecord?.email) {
    sendCertificateIssuedEmail(recipientRecord.email, recipient_name, orgRecord.org_name, cert_hash, verificationUrl).catch(() => {});
  }

  console.info(`[CERT] Issued successfully — cert_id: ${certificate.certificate_id}, hash: ${cert_hash}`);

  return {
    certificate_id:   certificate.certificate_id,
    cert_hash:        certificate.cert_hash,
    blockchain_tx_id: certificate.blockchain_tx_id,
    file_path:        `uploads/${cert_hash}.pdf`,
    qr_code,
  };
}

async function getVerificationHistory(org_id, certificate_id, page, limit) {
  const cert = await prisma.certificate.findUnique({ where: { certificate_id } });
  if (!cert) throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  if (cert.org_id !== org_id) throw Object.assign(new Error('Access denied.'), { statusCode: 403 });

  const skip = (page - 1) * limit;
  const [logs, total] = await Promise.all([
    prisma.verificationLog.findMany({
      where:   { certificate_id },
      orderBy: { verified_at: 'desc' },
      skip,
      take: limit,
      select: { log_id: true, verified_at: true, verifier_ip: true, result: true },
    }),
    prisma.verificationLog.count({ where: { certificate_id } }),
  ]);

  return { logs, total, page, limit };
}

async function resendCertificateEmail(org_id, certificate_id) {
  const cert = await prisma.certificate.findUnique({
    where:   { certificate_id },
    include: { recipient: { select: { email: true } }, organisation: { select: { org_name: true } } },
  });
  if (!cert) throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  if (cert.org_id !== org_id) throw Object.assign(new Error('Access denied.'), { statusCode: 403 });

  const verificationUrl = `${process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173'}/verify/${cert.cert_hash}`;
  await sendCertificateIssuedEmail(cert.recipient.email, cert.recipient_name, cert.organisation.org_name, cert.cert_hash, verificationUrl);

  await logAuditEvent({ org_id, action: 'RESEND', target: cert.cert_hash, metadata: { recipient_email: cert.recipient.email } });

  return { success: true, message: 'Certificate email resent.' };
}

async function verifyCertificate(cert_hash, verifier_ip) {
  const dbCert = await prisma.certificate.findUnique({
    where:   { cert_hash },
    include: {
      organisation: { select: { org_name: true } },
      recipient:    { select: { email: true } },
    },
  });

  let chainCert;
  try {
    chainCert = await evaluateTransaction('GetCertificate', cert_hash);
  } catch {
    if (dbCert) {
      await prisma.verificationLog.create({ data: { certificate_id: dbCert.certificate_id, verifier_ip, result: false } });
    }
    return { valid: false, reason: 'Certificate not found on blockchain.' };
  }

  if (!chainCert) {
    if (dbCert) {
      await prisma.verificationLog.create({ data: { certificate_id: dbCert.certificate_id, verifier_ip, result: false } });
    }
    return { valid: false, reason: 'Certificate not found on blockchain.' };
  }

  if (chainCert.isRevoked) {
    if (dbCert) {
      await prisma.verificationLog.create({ data: { certificate_id: dbCert.certificate_id, verifier_ip, result: false } });
    }
    return { valid: false, reason: 'Certificate has been revoked.' };
  }

  let publicKey;
  try {
    publicKey = await evaluateTransaction('GetOrgPublicKey', chainCert.orgMSPID);
  } catch {
    if (dbCert) {
      await prisma.verificationLog.create({ data: { certificate_id: dbCert.certificate_id, verifier_ip, result: false } });
    }
    return { valid: false, reason: `Issuing organisation (${chainCert.orgMSPID}) not found on blockchain.` };
  }

  const isValid = verifySignature(cert_hash, chainCert.signature, publicKey);

  if (dbCert) {
    await prisma.verificationLog.create({ data: { certificate_id: dbCert.certificate_id, verifier_ip, result: isValid } });
  }

  if (!isValid) {
    return { valid: false, reason: 'Signature verification failed.' };
  }

  return {
    valid:      true,
    cert_hash,
    issuer: {
      msp_id:   chainCert.orgMSPID,
      org_name: dbCert?.organisation?.org_name ?? null,
    },
    org_name:         dbCert?.organisation?.org_name ?? null,
    certificate_id:   dbCert?.certificate_id ?? null,
    recipient_name:   dbCert?.recipient_name ?? null,
    recipient_email:  dbCert?.recipient?.email ?? null,
    course:           dbCert?.course ?? null,
    issued_at:        dbCert?.issued_at ?? null,
    expiry_date:      dbCert?.expiry_date ?? null,
    is_revoked:       chainCert.isRevoked,
    status:           chainCert.isRevoked ? 'REVOKED' : 'ACTIVE',
    blockchain_tx_id: dbCert?.blockchain_tx_id ?? null,
    ...(dbCert ? await (async () => {
      const [verification_count, lastLog] = await Promise.all([
        prisma.verificationLog.count({ where: { certificate_id: dbCert.certificate_id } }),
        prisma.verificationLog.findFirst({ where: { certificate_id: dbCert.certificate_id }, orderBy: { verified_at: 'desc' }, select: { verified_at: true } }),
      ]);
      return { verification_count, last_verified_at: lastLog?.verified_at ?? null };
    })() : { verification_count: 0, last_verified_at: null }),
  };
}

async function revokeCertificate(org_id, cert_hash) {
  const cert = await prisma.certificate.findUnique({
    where: { cert_hash },
    include: { organisation: { select: { org_name: true } } },
  });

  if (!cert) {
    throw Object.assign(new Error('Certificate not found.'), { statusCode: 404 });
  }

  if (cert.org_id !== org_id) {
    throw Object.assign(new Error('Access denied.'), { statusCode: 403 });
  }

  if (cert.is_revoked) {
    throw Object.assign(new Error('Certificate is already revoked.'), { statusCode: 409 });
  }

  try {
    await submitTransaction('RevokeCertificate', cert_hash);
  } catch (fabricErr) {
    throw Object.assign(
      new Error(`Blockchain revocation failed: ${fabricErr.message}`),
      { statusCode: 503 }
    );
  }

  try {
    await prisma.certificate.update({ where: { cert_hash }, data: { is_revoked: true } });
  } catch (dbErr) {
    console.error(`[CERT] DB update failed after blockchain revoke — cert_hash: ${cert_hash}. Manual reconciliation required.`);
    throw Object.assign(
      new Error('Certificate revoked on blockchain but database update failed. Contact support with cert_hash: ' + cert_hash),
      { statusCode: 500 }
    );
  }

  await logAuditEvent({ org_id, action: 'REVOKE', target: cert_hash });

  createNotification({
    recipient_id: cert.recipient_id,
    type: 'CERTIFICATE_REVOKED',
    title: 'Certificate revoked',
    body: `Your certificate for ${cert.course} issued by ${cert.organisation.org_name} has been revoked.`,
    cert_hash,
  }).catch(() => {});

  return { success: true, cert_hash };
}

module.exports = { issueCertificate, verifyCertificate, revokeCertificate, getVerificationHistory, resendCertificateEmail };
