'use strict';

const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs   = require('fs');

const config = require('../config/env');

const CHANNEL_NAME   = config.fabric.channelName;
const CHAINCODE_NAME = config.fabric.chaincodeName;
const IDENTITY_LABEL = config.fabric.mspId;

// Resolve paths
const WALLET_PATH = path.resolve(config.fabric.walletPath);
const CONNECTION_PROFILE_PATH = path.resolve(config.fabric.connectionProfile);

let _gateway = null;
let _contract = null;

async function connectGateway() {
  if (_gateway && _contract) return _contract;

  console.log('🔌 Connecting to Fabric Gateway...');

  // Check connection profile
  if (!fs.existsSync(CONNECTION_PROFILE_PATH)) {
    throw new Error(`Connection profile not found at: ${CONNECTION_PROFILE_PATH}`);
  }

  const connectionProfile = JSON.parse(
    fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8')
  );

  // Load wallet
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);

  // Check identity
  const identity = await wallet.get(IDENTITY_LABEL);
  if (!identity) {
    throw new Error(
      `Identity "${IDENTITY_LABEL}" not found in wallet at ${WALLET_PATH}. ` +
      `Run wallet setup script first.`
    );
  }

  _gateway = new Gateway();

  await _gateway.connect(connectionProfile, {
    wallet,
    identity: IDENTITY_LABEL,
    discovery: { enabled: true, asLocalhost: true },
  });

  const network = await _gateway.getNetwork(CHANNEL_NAME);
  _contract = network.getContract(CHAINCODE_NAME);

  console.log('✅ Connected to Fabric');

  return _contract;
}

function isStaleConnectionError(msg) {
  return msg.includes('access denied') ||
         msg.includes('UNAVAILABLE') ||
         msg.includes('CANCELLED') ||
         msg.includes('Failed to connect');
}

async function submitTransaction(functionName, ...args) {
  const contract = await connectGateway();

  try {
    const result = await contract.submitTransaction(
      functionName,
      ...args.map(String)
    );

    return result.length ? JSON.parse(result.toString()) : null;

  } catch (err) {
    if (isStaleConnectionError(err.message)) {
      console.warn('⚠️  Stale Fabric connection detected — resetting gateway.');
      await disconnectGateway();
    }
    console.error(`❌ submitTransaction "${functionName}" failed:`, err.message);
    throw new Error(`submitTransaction "${functionName}" failed: ${err.message}`);
  }
}

async function evaluateTransaction(functionName, ...args) {
  const contract = await connectGateway();

  try {
    const result = await contract.evaluateTransaction(
      functionName,
      ...args.map(String)
    );

    if (!result.length) return null;
    const raw = result.toString();
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }

  } catch (err) {
    if (isStaleConnectionError(err.message)) {
      console.warn('⚠️  Stale Fabric connection detected — resetting gateway.');
      await disconnectGateway();
    }
    console.error(`❌ evaluateTransaction "${functionName}" failed:`, err.message);
    throw new Error(`evaluateTransaction "${functionName}" failed: ${err.message}`);
  }
}

async function disconnectGateway() {
  if (_gateway) {
    await _gateway.disconnect();
    _gateway = null;
    _contract = null;
    console.log('🔌 Fabric Gateway disconnected');
  }
}

module.exports = {
  connectGateway,
  submitTransaction,
  evaluateTransaction,
  disconnectGateway
};