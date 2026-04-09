// src/config/env.js
// Centralised environment validation using envalid.
// Import and call validateEnv() once at process boot (index.js).
// All other modules should consume process.env directly after validation.

'use strict';

const { cleanEnv, str, port, url } = require('envalid');

/**
 * Validates process.env against the expected schema.
 * Throws on the first missing / malformed variable so the process
 * fails fast rather than silently misbehaving at runtime.
 */
function validateEnv() {
  return cleanEnv(process.env, {
    // ── Server ────────────────────────────────────────────────────────────
    NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
    PORT:     port({ default: 5000 }),

    // ── Database ──────────────────────────────────────────────────────────
    DATABASE_URL:      url(),
    POSTGRES_USER:     str(),
    POSTGRES_PASSWORD: str(),
    POSTGRES_DB:       str(),

    // ── Auth ──────────────────────────────────────────────────────────────
    JWT_SECRET:           str(),
    RECIPIENT_JWT_SECRET: str(),
    SESSION_SECRET:       str(),

    // ── Email ─────────────────────────────────────────────────────────────
    SMTP_HOST:   str(),
    SMTP_PORT:   str({ default: '587' }),
    SMTP_USER:   str(),
    SMTP_PASS:   str(),
    SMTP_FROM:   str(),

    // ── Invite ────────────────────────────────────────────────────────────
    INVITE_SECRET: str(),

    PRIVATE_KEY_SECRET: str(),

    // ── App ───────────────────────────────────────────────────────────────
    VERIFICATION_BASE_URL: url({ default: 'http://localhost:8000' }),

    // ── Hyperledger Fabric ────────────────────────────────────────────────
    FABRIC_CHANNEL_NAME:       str(),
    FABRIC_CHAINCODE_NAME:     str(),
    FABRIC_MSP_ID:             str(),
    FABRIC_WALLET_PATH:        str({ default: 'src/wallet' }),
    FABRIC_CONNECTION_PROFILE: str({ default: 'connection-org1.json' }),
  });
}

module.exports = {
  validateEnv,
  fabric: {
    channelName:       process.env.FABRIC_CHANNEL_NAME,
    chaincodeName:     process.env.FABRIC_CHAINCODE_NAME,
    mspId:             process.env.FABRIC_MSP_ID,
    walletPath:        process.env.FABRIC_WALLET_PATH,
    connectionProfile: process.env.FABRIC_CONNECTION_PROFILE,
  },
};
