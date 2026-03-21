'use strict';

const crypto = require('crypto');

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function hashData(data) {
  const input = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(input).digest('hex');
}

function signData(hash, privateKey) {
  const sign = crypto.createSign('SHA256');
  sign.update(hash);
  sign.end();
  return sign.sign(privateKey, 'base64');
}

function verifySignature(hash, signature, publicKey) {
  const verify = crypto.createVerify('SHA256');
  verify.update(hash);
  verify.end();
  return verify.verify(publicKey, signature, 'base64');
}

module.exports = { generateKeyPair, hashData, signData, verifySignature };
