'use strict';

const prisma   = require('../database/prismaClient');
const { hashData, signData, verifySignature } = require('./cryptoService');
const { submitTransaction, evaluateTransaction } = require('./fabricService');
const { generateQRCode } = require('../utils/qr.util');
const { createRecipient } = require('./recipient.service');

async function issueCertificate({ org, recipient_id, recipient_email, recipient_name, course, issue_date }) {
  let resolvedRecipientId = recipient_id;

  if (recipient_email) {
    const recipient = await createRecipient(org.org_id, { email: recipient_email, name: recipient_name });
    resolvedRecipientId = recipient.recipient_id;
  }

  console.info(`[CERT] Issuance started — org: ${org.msp_id}, recipient: ${resolvedRecipientId}`);

  const recipient = await prisma.recipient.findUnique({ where: { recipient_id: resolvedRecipientId } });
  if (!recipient) {
    throw Object.assign(new Error('Recipient not found.'), { statusCode: 404 });
  }

  const orgRecord = await prisma.organisation.findUnique({
    where:  { org_id: org.org_id },
    select: { private_key: true },
  });
  if (!orgRecord) {
    throw Object.assign(new Error('Organisation not found.'), { statusCode: 404 });
  }

  const payload   = { msp_id: org.msp_id, recipient_name, course, issue_date };
  const cert_hash = hashData(payload);
  const file_path = `uploads/${cert_hash}.pdf`;
  const signature = signData(cert_hash, orgRecord.private_key);

  let blockchain_tx_id;
  try {
    await submitTransaction('StoreCertificate', cert_hash, signature, org.msp_id, file_path);
    blockchain_tx_id = `tx_${cert_hash.slice(0, 16)}`;
  } catch (fabricErr) {
    console.error(`[CERT] Blockchain storage failed:`, fabricErr.message);
    throw Object.assign(
      new Error(`Blockchain storage failed: ${fabricErr.message}`),
      { statusCode: 502 }
    );
  }

  const certificate = await prisma.certificate.create({
    data: {
      org_id:          org.org_id,
      recipient_id:    resolvedRecipientId,
      cert_hash,
      ecdsa_signature: signature,
      blockchain_tx_id,
      file_path,
    },
  });

  const qr_code = await generateQRCode({
    cert_hash,
    issuer_msp_id:    org.msp_id,
    verification_url: `${process.env.VERIFICATION_BASE_URL ?? 'http://localhost:8000'}/api/verify/${cert_hash}`,
  });

  console.info(`[CERT] Issued successfully — cert_id: ${certificate.certificate_id}, hash: ${cert_hash}`);

  return {
    certificate_id:   certificate.certificate_id,
    cert_hash:        certificate.cert_hash,
    blockchain_tx_id: certificate.blockchain_tx_id,
    file_path:        certificate.file_path,
    qr_code,
  };
}

async function verifyCertificate(cert_hash) {
  const dbCert = await prisma.certificate.findUnique({
    where:   { cert_hash },
    include: { organisation: { select: { org_name: true } } },
  });

  let chainCert;
  try {
    chainCert = await evaluateTransaction('GetCertificate', cert_hash);
  } catch {
    return { valid: false, reason: 'Certificate not found on blockchain.' };
  }

  if (!chainCert) {
    return { valid: false, reason: 'Certificate not found on blockchain.' };
  }

  if (chainCert.isRevoked) {
    return { valid: false, reason: 'Certificate has been revoked.' };
  }

  let publicKey;
  try {
    publicKey = await evaluateTransaction('GetOrgPublicKey', chainCert.orgMSPID);
  } catch {
    return { valid: false, reason: `Issuing organisation (${chainCert.orgMSPID}) not found on blockchain.` };
  }

  const isValid = verifySignature(cert_hash, chainCert.signature, publicKey);

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

module.exports = { issueCertificate, verifyCertificate };
