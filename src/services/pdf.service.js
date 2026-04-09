'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

async function generateCertificatePDF({ recipient_name, course, description, issue_date, org_name, cert_hash }) {
  const uploadsDir = path.join(__dirname, '../../uploads');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const filename = `${cert_hash}.pdf`;
  const filePath = path.join(uploadsDir, filename);

  const doc    = new PDFDocument({ margin: 60, size: 'A4' });
  const stream = fs.createWriteStream(filePath);

  doc.pipe(stream);

  doc
    .fontSize(28)
    .font('Helvetica-Bold')
    .text('Certificate of Completion', { align: 'center' });

  doc
    .moveDown(0.4)
    .moveTo(60, doc.y)
    .lineTo(doc.page.width - 60, doc.y)
    .lineWidth(1.5)
    .stroke('#cccccc');

  doc.moveDown(1.5);

  doc
    .fontSize(13)
    .font('Helvetica')
    .fillColor('#555555')
    .text('This is to certify that', { align: 'center' });

  doc.moveDown(0.6);

  doc
    .fontSize(22)
    .font('Helvetica-Bold')
    .fillColor('#111111')
    .text(recipient_name, { align: 'center' });

  doc.moveDown(0.6);

  doc
    .fontSize(13)
    .font('Helvetica')
    .fillColor('#555555')
    .text('has successfully completed', { align: 'center' });

  doc.moveDown(0.6);

  doc
    .fontSize(18)
    .font('Helvetica-Bold')
    .fillColor('#111111')
    .text(course, { align: 'center' });

  if (description) {
    doc.moveDown(0.8);
    doc
      .fontSize(11)
      .font('Helvetica')
      .fillColor('#666666')
      .text(description, { align: 'center' });
  }

  doc.moveDown(1.5);

  doc
    .moveTo(60, doc.y)
    .lineTo(doc.page.width - 60, doc.y)
    .lineWidth(0.5)
    .stroke('#eeeeee');

  doc.moveDown(1);

  const labelX = 80;
  const valueX = 200;
  const rowGap  = 0.5;

  const field = (label, value) => {
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#888888')
      .text(label, labelX, doc.y, { continued: false, width: 110 });

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#222222')
      .text(value, valueX, doc.y - doc.currentLineHeight(), { width: doc.page.width - valueX - 60 });

    doc.moveDown(rowGap);
  };

  field('Issued To:', recipient_name);
  field('Course:', course);
  field('Issue Date:', new Date(issue_date).toDateString());
  field('Issued By:', org_name);

  doc.moveDown(1.5);

  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#aaaaaa')
    .text(`Certificate Hash: ${cert_hash}`, { align: 'center' });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return `uploads/${filename}`;
}

module.exports = { generateCertificatePDF };
