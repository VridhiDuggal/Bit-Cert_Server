'use strict';

const Joi             = require('joi');
const { StatusCodes } = require('http-status-codes');
const { onboardOrg, loginOrg, getOrgRecipients, getOrgCertificates, getOrgStats, getOrgAuditLogs, getCertificateById, getOrgProfile, updateOrgProfile } = require('../services/org.service');
const { revokeCertificate } = require('../services/certificate.service');
const { generateInviteToken } = require('../services/invite.service');
const { sendInviteEmail } = require('../services/mail.service');

const onboardSchema = Joi.object({
  org_name: Joi.string().trim().max(120).required(),
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().min(10).required(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

async function onboardOrgController(req, res, next) {
  try {
    const { error, value } = onboardSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const org = await onboardOrg(value);
    return res.status(StatusCodes.CREATED).json({ success: true, ...org });
  } catch (err) {
    next(err);
  }
}

async function loginOrgController(req, res, next) {
  try {
    const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await loginOrg(value);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

const paginationSchema = Joi.object({
  page:  Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(10),
});

const recipientsQuerySchema = Joi.object({
  page:   Joi.number().min(1).default(1),
  limit:  Joi.number().min(1).max(100).default(10),
  search: Joi.string().optional(),
});

const certQuerySchema = Joi.object({
  page:      Joi.number().min(1).default(1),
  limit:     Joi.number().min(1).max(100).default(10),
  search:    Joi.string().optional(),
  status:    Joi.string().valid('active', 'revoked').optional(),
  from_date: Joi.date().optional(),
  to_date:   Joi.date().optional(),
});

async function getOrgRecipientsController(req, res, next) {
  try {
    const { error, value } = recipientsQuerySchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await getOrgRecipients(req.org.org_id, value.page, value.limit, value.search);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getOrgCertificatesController(req, res, next) {
  try {
    const { error, value } = certQuerySchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await getOrgCertificates(req.org.org_id, value.page, value.limit, {
      search:    value.search,
      status:    value.status,
      from_date: value.from_date,
      to_date:   value.to_date,
    });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getOrgStatsController(req, res, next) {
  try {
    const stats = await getOrgStats(req.org.org_id);
    return res.status(StatusCodes.OK).json({ success: true, ...stats });
  } catch (err) {
    next(err);
  }
}

async function revokeCertificateController(req, res, next) {
  try {
    const { hash: cert_hash } = req.params;
    const result = await revokeCertificate(req.org.org_id, cert_hash);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getOrgAuditLogsController(req, res, next) {
  try {
    const { error, value } = paginationSchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await getOrgAuditLogs(req.org.org_id, value.page, value.limit);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

const inviteSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

async function inviteRecipientController(req, res, next) {
  try {
    const { error, value } = inviteSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const token = await generateInviteToken(req.org.org_id, value.email);
    const base = process.env.APP_BASE_URL ?? process.env.VERIFICATION_BASE_URL ?? 'http://localhost:5173';
    const inviteLink = `${base}/accept-invite?token=${token}`;
    await sendInviteEmail(value.email, inviteLink, req.org.org_name);
    return res.status(StatusCodes.OK).json({ success: true, token });
  } catch (err) {
    next(err);
  }
}

async function getCertificateByIdController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const cert = await getCertificateById(req.org.org_id, certificate_id);
    return res.status(StatusCodes.OK).json({ success: true, certificate: cert });
  } catch (err) {
    next(err);
  }
}

async function getOrgProfileController(req, res, next) {
  try {
    const profile = await getOrgProfile(req.org.org_id);
    return res.status(StatusCodes.OK).json({ success: true, profile });
  } catch (err) {
    next(err);
  }
}

const updateProfileSchema = Joi.object({
  org_name: Joi.string().trim().max(120).required(),
});

async function updateOrgProfileController(req, res, next) {
  try {
    const { error, value } = updateProfileSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const profile = await updateOrgProfile(req.org.org_id, value);
    return res.status(StatusCodes.OK).json({ success: true, profile });
  } catch (err) {
    next(err);
  }
}

module.exports = { onboardOrgController, loginOrgController, getOrgRecipientsController, getOrgCertificatesController, getOrgStatsController, revokeCertificateController, getOrgAuditLogsController, inviteRecipientController, getCertificateByIdController, getOrgProfileController, updateOrgProfileController };
