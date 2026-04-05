'use strict';

const QRCode = require('qrcode');

async function generateQRCode(payload) {
  const data = JSON.stringify(payload);
  return QRCode.toDataURL(data, { errorCorrectionLevel: 'H', width: 300 });
}

module.exports = { generateQRCode };
