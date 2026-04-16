'use strict';

const Joi             = require('joi');
const bcrypt          = require('bcryptjs');
const { StatusCodes } = require('http-status-codes');
const { createRecipient, loginRecipient, getRecipientOrgs, getRecipientCertificates, getCertificateQR, getMyCertificateById, getRecipientProfile, getRecipientDashboardStats, getVerificationHistory, updateRecipientProfile, changeRecipientPassword } = require('../services/recipient.service');
const { validateInviteToken, markTokenUsed, previewInvite } = require('../services/invite.service');
const { logAuditEvent } = require('../services/auditLog.service');
const prisma = require('../database/prismaClient');

const createSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  name:  Joi.string().max(120).required(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

async function createRecipientController(req, res, next) {
  try {
    const { error, value } = createSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const recipient = await createRecipient(req.org.org_id, value);

    return res.status(StatusCodes.CREATED).json({
      success:      true,
      recipient_id: recipient.recipient_id,
      email:        recipient.email,
      name:         recipient.name,
    });
  } catch (err) {
    next(err);
  }
}

async function loginRecipientController(req, res, next) {
  try {
    const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await loginRecipient(value);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

const certFilterSchema = Joi.object({
  page:      Joi.number().integer().min(1).default(1),
  limit:     Joi.number().integer().min(1).max(50).default(12),
  search:    Joi.string().optional(),
  status:    Joi.string().valid('active', 'revoked').optional(),
  from_date: Joi.date().optional(),
  to_date:   Joi.date().optional(),
  org_id:    Joi.string().uuid().optional(),
});

async function getMyCertificatesController(req, res, next) {
  try {
    const { error, value } = certFilterSchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await getRecipientCertificates(req.recipient.recipient_id, value);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getCertificateQRController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const result = await getCertificateQR(req.recipient.recipient_id, certificate_id);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

const acceptInviteSchema = Joi.object({
  token:    Joi.string().required(),
  name:     Joi.string().max(120).optional(),
  password: Joi.string().min(8).optional(),
});

async function acceptInviteController(req, res, next) {
  try {
    const { error, value } = acceptInviteSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const invite = await validateInviteToken(value.token);

    const existing = await prisma.recipient.findUnique({ where: { email: invite.recipient_email } });

    const accountStatus = !existing ? 'new' : (!existing.password_hash ? 'shell' : 'registered');

    let recipient;

    if (accountStatus === 'registered') {
      await prisma.orgRecipient.upsert({
        where:  { org_id_recipient_id: { org_id: invite.org_id, recipient_id: existing.recipient_id } },
        create: { org_id: invite.org_id, recipient_id: existing.recipient_id },
        update: {},
      });
      await markTokenUsed(invite.token_hash);
      await logAuditEvent({ org_id: invite.org_id, action: 'RECIPIENT_CREATE', target: invite.recipient_email, metadata: { accountStatus: 'registered' } });
      return res.status(StatusCodes.OK).json({ success: true, accountStatus: 'registered', message: 'Invite accepted. Log in to see your new certificate.' });
    }

    if (accountStatus === 'shell') {
      if (!value.password) {
        return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ success: false, message: 'Validation failed.', errors: ['password is required.'] });
      }
      const password_hash = await bcrypt.hash(value.password, 12);
      const updateData = { password_hash };
      if (value.name && !existing.name) updateData.name = value.name;
      recipient = await prisma.recipient.update({ where: { recipient_id: existing.recipient_id }, data: updateData });
    } else {
      if (!value.name || !value.password) {
        const errors = [];
        if (!value.name)     errors.push('name is required.');
        if (!value.password) errors.push('password is required.');
        return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ success: false, message: 'Validation failed.', errors });
      }
      const password_hash = await bcrypt.hash(value.password, 12);
      recipient = await prisma.recipient.create({
        data: {
          email:             invite.recipient_email,
          name:              value.name,
          password_hash,
          invited_by_org_id: invite.org_id,
        },
      });
    }

    await prisma.orgRecipient.upsert({
      where:  { org_id_recipient_id: { org_id: invite.org_id, recipient_id: recipient.recipient_id } },
      create: { org_id: invite.org_id, recipient_id: recipient.recipient_id },
      update: {},
    });

    await markTokenUsed(invite.token_hash);
    await logAuditEvent({ org_id: invite.org_id, action: 'RECIPIENT_CREATE', target: invite.recipient_email, metadata: { accountStatus } });

    return res.status(StatusCodes.OK).json({ success: true, accountStatus, message: 'Account activated. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

async function getMyCertificateByIdController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const cert = await getMyCertificateById(req.recipient.recipient_id, certificate_id);
    return res.status(StatusCodes.OK).json({ success: true, certificate: cert });
  } catch (err) {
    next(err);
  }
}

async function getRecipientProfileController(req, res, next) {
  try {
    const profile = await getRecipientProfile(req.recipient.recipient_id);
    return res.status(StatusCodes.OK).json({ success: true, profile });
  } catch (err) {
    next(err);
  }
}

async function getDashboardStats(req, res, next) {
  try {
    const stats = await getRecipientDashboardStats({ recipient_id: req.recipient.recipient_id });
    return res.status(StatusCodes.OK).json({ success: true, ...stats });
  } catch (err) {
    next(err);
  }
}

async function getVerificationHistoryController(req, res, next) {
  try {
    const result = await getVerificationHistory({ certificate_id: req.params.id, recipient_id: req.recipient.recipient_id });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(120).required(),
});

async function updateProfileController(req, res, next) {
  try {
    const { error, value } = updateProfileSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ success: false, message: 'Validation failed.', errors: error.details.map(d => d.message) });
    }
    const recipient = await updateRecipientProfile({ recipient_id: req.recipient.recipient_id, name: value.name });
    return res.status(StatusCodes.OK).json({ success: true, recipient });
  } catch (err) {
    next(err);
  }
}

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password:     Joi.string().min(10).required(),
});

async function changePasswordController(req, res, next) {
  try {
    const { error, value } = changePasswordSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ success: false, message: 'Validation failed.', errors: error.details.map(d => d.message) });
    }
    const result = await changeRecipientPassword({ recipient_id: req.recipient.recipient_id, current_password: value.current_password, new_password: value.new_password });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getRecipientOrgsController(req, res, next) {
  try {
    const orgs = await getRecipientOrgs(req.recipient.recipient_id);
    return res.status(StatusCodes.OK).json({ success: true, orgs });
  } catch (err) {
    next(err);
  }
}

async function downloadCertificateController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const cert = await prisma.certificate.findUnique({ where: { certificate_id } });

    if (!cert) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'Certificate not found.' });
    }
    if (cert.recipient_id !== req.recipient.recipient_id) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'Certificate not found.' });
    }

    const fs   = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '..', '..', cert.file_path);

    if (!fs.existsSync(filePath)) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: 'Certificate file not yet available.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.cert_hash.slice(0, 8)}.pdf"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
}

async function previewInviteController(req, res, next) {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(StatusCodes.BAD_REQUEST).json({ success: false, message: 'token query param is required.' });
    }
    const result = await previewInvite({ token });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { createRecipientController, loginRecipientController, getMyCertificatesController, getCertificateQRController, acceptInviteController, getMyCertificateByIdController, getRecipientProfileController, getDashboardStats, getVerificationHistoryController, updateProfileController, changePasswordController, previewInviteController, getRecipientOrgsController, downloadCertificateController };
