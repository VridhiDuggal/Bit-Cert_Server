'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');
const { generateQRCode } = require('../utils/qr.util');

async function generateCertificatePDF({ recipient_name, course, description, issue_date, org_name, cert_hash, certificate_id }) {
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `${cert_hash}.pdf`;
  const filePath = path.join(uploadsDir, filename);

  const PRIMARY = '#588157';
  const BORDER_LIGHT = '#c8dfc8';
  const FRONTEND_BASE = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';
  const verificationUrl = `${FRONTEND_BASE}/verify/${cert_hash}`;

  const qrDataUrl = await generateQRCode(verificationUrl);
  const qrBuffer = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

  const doc = new PDFDocument({ margin: 0, size: 'A4', layout: 'landscape' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const W = doc.page.width;
  const H = doc.page.height;

  doc.rect(10, 10, W - 20, H - 20).lineWidth(2.5).strokeColor(PRIMARY).stroke();
  doc.rect(18, 18, W - 36, H - 36).lineWidth(0.6).strokeColor(BORDER_LIGHT).stroke();

  const formatted = new Date(issue_date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  let y = 38;

  doc.fontSize(22).font('Helvetica-Bold').fillColor(PRIMARY)
    .text('Bit-Cert', 0, y, { align: 'center', width: W });
  y += 28;

  doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
    .text('Blockchain-Verified Certificate Authority', 0, y, { align: 'center', width: W });
  y += 18;

  doc.moveTo(W * 0.25, y).lineTo(W * 0.75, y).lineWidth(0.5).strokeColor(BORDER_LIGHT).stroke();
  y += 20;

  doc.fontSize(26).font('Helvetica-Bold').fillColor('#1a202c')
    .text('Certificate of Achievement', 0, y, { align: 'center', width: W });
  y += 34;

  doc.fontSize(11).font('Helvetica-Oblique').fillColor('#6b7280')
    .text('This is to certify that', 0, y, { align: 'center', width: W });
  y += 22;

  doc.fontSize(9).font('Helvetica').fillColor(BORDER_LIGHT);
  const nameApproxWidth = Math.min(recipient_name.length * 13, 320);
  const nameCenterX = W / 2;
  const lineLen = 90;
  const lineGap = 16;
  const lineY = y + 16;
  doc.moveTo(nameCenterX - nameApproxWidth / 2 - lineGap - lineLen, lineY)
    .lineTo(nameCenterX - nameApproxWidth / 2 - lineGap, lineY)
    .lineWidth(0.7).strokeColor(BORDER_LIGHT).stroke();
  doc.moveTo(nameCenterX + nameApproxWidth / 2 + lineGap, lineY)
    .lineTo(nameCenterX + nameApproxWidth / 2 + lineGap + lineLen, lineY)
    .lineWidth(0.7).strokeColor(BORDER_LIGHT).stroke();

  doc.fontSize(26).font('Helvetica').fillColor(PRIMARY)
    .text(recipient_name, 0, y, { align: 'center', width: W });
  y += 36;

  doc.fontSize(11).font('Helvetica-Oblique').fillColor('#6b7280')
    .text('has successfully completed', 0, y, { align: 'center', width: W });
  y += 22;

  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a202c')
    .text(course, 0, y, { align: 'center', width: W });
  y += 26;

  if (description) {
    doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
      .text(description, 80, y, { align: 'center', width: W - 160 });
    y += 18;
  }

  doc.fontSize(11).font('Helvetica').fillColor('#6b7280');
  const offeredLabel = 'offered by ';
  const labelW = doc.widthOfString(offeredLabel);
  const orgNameW = doc.widthOfString(org_name);
  const offeredX = (W - labelW - orgNameW) / 2;
  doc.text(offeredLabel, offeredX, y, { continued: true });
  doc.font('Helvetica-Bold').fillColor(PRIMARY).text(org_name, { continued: false });
  y += 26;

  doc.moveTo(W * 0.1, y).lineTo(W * 0.9, y).lineWidth(0.5).strokeColor(BORDER_LIGHT).stroke();
  y += 16;

  const QR_SIZE = 68;
  const QR_X = W - 108;
  const QR_Y = y - 4;

  const certIdDisplay = certificate_id
    ? `CERT-${certificate_id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
    : `CERT-${cert_hash.slice(0, 8).toUpperCase()}`;
  const hashPreview = `${cert_hash.slice(0, 10)}...`;

  const cols = [
    { x: 72,  label: 'CERTIFICATE ID', value: certIdDisplay },
    { x: 260, label: 'ISSUE DATE',     value: formatted },
    { x: 448, label: 'HASH PREVIEW',   value: hashPreview },
  ];

  cols.forEach(({ x, label, value }) => {
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#6b7280')
      .text(label, x, y, { width: 170, characterSpacing: 0.4 });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a202c')
      .text(value, x, y + 13, { width: 170 });
  });

  doc.image(qrBuffer, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE });
  doc.fontSize(7).font('Helvetica').fillColor('#6b7280')
    .text('Scan to Verify', QR_X, QR_Y + QR_SIZE + 2, { width: QR_SIZE, align: 'center' });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return `uploads/${filename}`;
}

module.exports = { generateCertificatePDF };
