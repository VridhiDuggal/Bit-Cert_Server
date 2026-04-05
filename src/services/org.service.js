'use strict';

const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const prisma    = require('../database/prismaClient');
const { generateKeyPair }       = require('./cryptoService');
const { submitTransaction, evaluateTransaction } = require('./fabricService');

const BCRYPT_ROUNDS = 12;

async function onboardOrg({ org_name, msp_id, email, password }) {
  console.info(`[ORG] Onboarding started — msp_id: ${msp_id}, email: ${email}`);

  const existing = await prisma.organisation.findFirst({
    where: { OR: [{ email }, { msp_id }] },
  });

  if (existing) {
    const field = existing.email === email ? 'email' : 'msp_id';
    const err   = new Error(`An organisation with this ${field} already exists.`);
    err.statusCode = 409;
    throw err;
  }

  const { publicKey, privateKey } = generateKeyPair();
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const org = await prisma.organisation.create({
    data: { org_name, msp_id, email, public_key: publicKey, private_key: privateKey, password_hash },
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
      throw new Error(`Organisation ${msp_id} is already registered on the blockchain.`);
    }

    await submitTransaction('RegisterOrg', msp_id, publicKey);
  } catch (fabricErr) {
    console.error(`[ORG] Blockchain registration failed for ${msp_id} — rolling back DB:`, fabricErr.message);
    await prisma.organisation.delete({ where: { org_id: org.org_id } });
    const err = new Error(`Blockchain registration failed: ${fabricErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  console.info(`[ORG] Onboarding success — org_id: ${org.org_id}, msp_id: ${msp_id}`);

  const { private_key, password_hash: _ph, ...safeOrg } = org;
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
    { sub: org.org_id, org_id: org.org_id, msp_id: org.msp_id, org_name: org.org_name, email: org.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' }
  );

  return {
    token,
    org: { org_id: org.org_id, msp_id: org.msp_id, org_name: org.org_name, email: org.email },
  };
}

module.exports = { onboardOrg, loginOrg };
