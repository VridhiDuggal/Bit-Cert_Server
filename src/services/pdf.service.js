'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

async function generateCertificatePDF({ recipient_name, course, description, issue_date, org_name, cert_hash, certificate_id, qr_code }) {
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `${cert_hash}.pdf`;
  const filePath = path.join(uploadsDir, filename);

  const GREEN = '#2e5d46';
  const GOLD  = '#d4af37';

  const qrBuffer  = Buffer.from(qr_code.replace(/^data:image\/png;base64,/, ''), 'base64');

  const doc    = new PDFDocument({ margin: 0, size: 'A4', layout: 'landscape' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const W = doc.page.width;
  const H = doc.page.height;

  doc.rect(5, 5, W - 10, H - 10).lineWidth(10).strokeColor(GREEN).stroke();
  doc.rect(28, 28, W - 56, H - 56).lineWidth(1.5).strokeColor(GOLD).stroke();

  doc.save();
  doc.opacity(0.12);
  doc.circle(W / 2, H - 72, 44).fillColor(GOLD).fill();
  doc.restore();

  const formatted = new Date(issue_date).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  let y = 50;

  doc.fontSize(22).font('Helvetica-Bold').fillColor(GREEN)
    .text('Bit-Cert', 0, y, { align: 'center', width: W, characterSpacing: 0.8 });
  y += 26;

  doc.fontSize(8).font('Helvetica').fillColor('#777777')
    .text('BLOCKCHAIN VERIFIED CERTIFICATE AUTHORITY', 0, y, { align: 'center', width: W, characterSpacing: 1.2 });
  y += 30;

  doc.fontSize(34).font('Times-Bold').fillColor('#222222')
    .text('Certificate of Achievement', 0, y, { align: 'center', width: W });
  y += 48;

  doc.fontSize(11).font('Helvetica-Oblique').fillColor('#666666')
    .text('This is to certify that', 0, y, { align: 'center', width: W });
  y += 22;

  doc.fontSize(32).font('Times-Roman').fillColor(GREEN)
    .text(recipient_name, 0, y, { align: 'center', width: W });

  const nameTextWidth = doc.widthOfString(recipient_name);
  const clampedNameW  = Math.min(nameTextWidth, W * 0.55);
  const nameUnderX    = (W - clampedNameW) / 2;
  doc.moveTo(nameUnderX, y + 38)
    .lineTo(nameUnderX + clampedNameW, y + 38)
    .lineWidth(1.5).strokeColor(GOLD).stroke();
  y += 52;

  doc.fontSize(11).font('Helvetica-Oblique').fillColor('#666666')
    .text('in recognition of their accomplishment in', 0, y, { align: 'center', width: W });
  y += 20;

  doc.fontSize(19).font('Helvetica-Bold').fillColor('#222222')
    .text(course, 0, y, { align: 'center', width: W });
  y += 28;

  if (description) {
    doc.fontSize(10).font('Helvetica-Oblique').fillColor('#666666')
      .text(description, 80, y, { align: 'center', width: W - 160 });
    y += 18;
  }

  doc.fontSize(13).font('Helvetica').fillColor(GREEN)
    .text(`Offered by ${org_name}`, 0, y, { align: 'center', width: W });
  y += 38;

  doc.moveTo(W * 0.08, y).lineTo(W * 0.92, y).lineWidth(0.5).strokeColor('#dddddd').stroke();
  y += 22;

  const QR_SIZE = 88;
  const QR_X    = W - 148;
  const QR_Y    = y;

  const certIdDisplay = certificate_id
    ? `CERT-${certificate_id.replace(/-/g, '').slice(0, 8).toUpperCase()}`
    : `CERT-${cert_hash.slice(0, 8).toUpperCase()}`;
  const hashPreview = `${cert_hash.slice(0, 10)}...`;

  const detailsX    = 75;
  const detailLineH = 20;

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
    .text('Certificate ID:  ', detailsX, y, { continued: true })
    .font('Helvetica').fillColor('#333333').text(certIdDisplay);
  y += detailLineH;

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
    .text('Issue Date:  ', detailsX, y, { continued: true })
    .font('Helvetica').fillColor('#333333').text(formatted);
  y += detailLineH;

  doc.fontSize(11).font('Helvetica-Bold').fillColor('#333333')
    .text('Hash:  ', detailsX, y, { continued: true })
    .font('Helvetica').fillColor('#333333').text(hashPreview);

  doc.image(qrBuffer, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE });
  doc.fontSize(9).font('Helvetica').fillColor('#666666')
    .text('Scan to Verify', QR_X, QR_Y + QR_SIZE + 4, { width: QR_SIZE, align: 'center' });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return `uploads/${filename}`;
}

module.exports = { generateCertificatePDF };
