'use strict';

const prisma   = require('../database/prismaClient');
const { hashData, signData, verifySignature } = require('./cryptoService');
const { submitTransaction, evaluateTransaction } = require('./fabricService');
const { generateQRCode } = require('../utils/qr.util');
const { createRecipient } = require('./recipient.service');
const { logAuditEvent }  = require('./auditLog.service');
const { generateCertificatePDF } = require('./pdf.service');
const { decrypt } = require('../utils/encryption.util');

async function issueCertificate({ org, recipient_id, recipient_email, recipient_name, course, description, issue_date }) {
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
  const cert_hash = hashData(payload);
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
        ecdsa_signature: signature,
        blockchain_tx_id,
        file_path:       `uploads/${cert_hash}.pdf`,
        recipient_name,
        course,
        description:     description ?? null,
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

  const file_path = await generateCertificatePDF({
    recipient_name,
    course,
    description,
    issue_date,
    org_name: orgRecord.org_name,
    cert_hash,
  });

  await prisma.certificate.update({ where: { cert_hash }, data: { file_path } });

  const verificationUrl = `${process.env.VERIFICATION_BASE_URL ?? 'http://localhost:8000'}/api/verify/${cert_hash}`;
  const qr_code = await generateQRCode(verificationUrl);

  await logAuditEvent({ org_id: org.org_id, action: 'ISSUE', target: cert_hash, metadata: { recipient_email, course } });

  console.info(`[CERT] Issued successfully — cert_id: ${certificate.certificate_id}, hash: ${cert_hash}`);

  return {
    certificate_id:   certificate.certificate_id,
    cert_hash:        certificate.cert_hash,
    blockchain_tx_id: certificate.blockchain_tx_id,
    file_path,
    qr_code,
  };
}

async function verifyCertificate(cert_hash, verifier_ip) {
  const dbCert = await prisma.certificate.findUnique({
    where:   { cert_hash },
    include: { organisation: { select: { org_name: true } } },
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
    issued_at:  dbCert?.issued_at ?? null,
    is_revoked: chainCert.isRevoked,
  };
}

async function revokeCertificate(org_id, cert_hash) {
  const cert = await prisma.certificate.findUnique({ where: { cert_hash } });

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

  return { success: true, cert_hash };
}

module.exports = { issueCertificate, verifyCertificate, revokeCertificate };
