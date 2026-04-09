'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY_LEN   = 32;
const IV_LEN    = 16;

function getKey() {
  const secret = process.env.PRIVATE_KEY_SECRET;
  if (!secret) {
    throw Object.assign(new Error('PRIVATE_KEY_SECRET is not configured.'), { statusCode: 500 });
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  const key = getKey();
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext) {
  const key = getKey();
  const [ivHex, encHex] = ciphertext.split(':');
  if (!ivHex || !encHex) {
    throw Object.assign(new Error('Invalid ciphertext format.'), { statusCode: 500 });
  }
  const iv        = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher  = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
