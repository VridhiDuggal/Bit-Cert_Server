'use strict';

const Joi             = require('joi');
const bcrypt          = require('bcryptjs');
const { StatusCodes } = require('http-status-codes');
const { createRecipient, loginRecipient, getRecipientCertificates, getCertificateQR, getMyCertificateById, getRecipientProfile } = require('../services/recipient.service');
const { validateInviteToken, markTokenUsed } = require('../services/invite.service');
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
  search:    Joi.string().optional(),
  status:    Joi.string().valid('active', 'revoked').optional(),
  from_date: Joi.date().optional(),
  to_date:   Joi.date().optional(),
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

    const certificates = await getRecipientCertificates(req.recipient.recipient_id, value);
    return res.status(StatusCodes.OK).json({ success: true, certificates });
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
  name:     Joi.string().max(120).required(),
  password: Joi.string().min(8).required(),
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
    const password_hash = await bcrypt.hash(value.password, 12);

    await prisma.recipient.upsert({
      where:  { email: invite.recipient_email },
      create: {
        email:              invite.recipient_email,
        name:               value.name,
        password_hash,
        invited_by_org_id:  invite.org_id,
      },
      update: {
        name:          value.name,
        password_hash,
      },
    });

    await markTokenUsed(invite.token_hash);

    return res.status(StatusCodes.OK).json({ success: true, message: 'Account activated. You can now log in.' });
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

module.exports = { createRecipientController, loginRecipientController, getMyCertificatesController, getCertificateQRController, acceptInviteController, getMyCertificateByIdController, getRecipientProfileController };
