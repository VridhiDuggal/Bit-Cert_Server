'use strict';

const { generateKeyPair, hashData, signData, verifySignature } = require('../services/cryptoService');

async function generateKeysController(req, res) {
  try {
    const { publicKey, privateKey } = generateKeyPair();
    res.json({ success: true, publicKey, privateKey });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

async function signController(req, res) {
  try {
    const { data, privateKey } = req.body;
    const hash = hashData(data);
    const signature = signData(hash, privateKey);
    res.json({ success: true, hash, signature });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

async function verifyController(req, res) {
  try {
    const { hash, signature, publicKey } = req.body;
    const valid = verifySignature(hash, signature, publicKey);
    res.json({ success: true, valid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = { generateKeysController, signController, verifyController };
