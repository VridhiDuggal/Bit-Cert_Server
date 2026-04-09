'use strict';

const QRCode = require('qrcode');

async function generateQRCode(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'H', width: 300 });
}

module.exports = { generateQRCode };
