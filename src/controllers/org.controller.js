'use strict';

const Joi             = require('joi');
const bcrypt          = require('bcryptjs');
const { StatusCodes } = require('http-status-codes');
const { onboardOrg, loginOrg, getOrgRecipients, getOrgRecipientDetail, updateOrgRecipient, getOrgCertificates, getOrgStats, getOrgAuditLogs, exportOrgAuditLogs, getCertificateById, getOrgProfile, updateOrgProfile, getRecentActivity, getIssuanceChart } = require('../services/org.service');
const { revokeCertificate, getVerificationHistory, resendCertificateEmail } = require('../services/certificate.service');
const { issueCertificate } = require('../services/certificate.service');
const { generateInviteToken } = require('../services/invite.service');
const { sendInviteEmail } = require('../services/mail.service');
const prisma = require('../database/prismaClient');

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

    const result = await onboardOrg(value);
    return res.status(StatusCodes.CREATED).json({ success: true, ...result });
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
  status: Joi.string().valid('active', 'suspended', 'invite_pending').optional(),
});

const certQuerySchema = Joi.object({
  page:          Joi.number().min(1).default(1),
  limit:         Joi.number().min(1).max(100).default(10),
  search:        Joi.string().optional(),
  status:        Joi.string().valid('active', 'revoked').optional(),
  from_date:     Joi.date().optional(),
  to_date:       Joi.date().optional(),
  tags:          Joi.string().optional(),
  expiry_status: Joi.string().valid('active', 'expired', 'expiring_soon').optional(),
});

const issueSchema = Joi.object({
  recipient_id:    Joi.string().uuid().optional(),
  recipient_email: Joi.string().email().lowercase().optional(),
  recipient_name:  Joi.string().trim().max(200).required(),
  course:          Joi.string().trim().max(200).required(),
  description:     Joi.string().trim().optional(),
  issue_date:      Joi.string().isoDate().required(),
  expiry_date:     Joi.string().isoDate().optional().custom((v, helpers) => {
    if (new Date(v) <= new Date()) return helpers.error('any.invalid');
    return v;
  }, 'future date'),
  tags:            Joi.array().items(Joi.string().trim().max(30)).max(5).optional(),
  template_id:     Joi.string().optional(),
}).or('recipient_id', 'recipient_email');

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

    const result = await getOrgRecipients(req.org.org_id, value.page, value.limit, value.search, value.status);
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
      search:        value.search,
      status:        value.status,
      from_date:     value.from_date,
      to_date:       value.to_date,
      tags:          value.tags ? value.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      expiry_status: value.expiry_status,
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

const revokeSchema = Joi.object({
  password: Joi.string().required(),
});

async function revokeCertificateController(req, res, next) {
  try {
    const { hash: cert_hash } = req.params;

    const { error, value } = revokeSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const orgRecord = await prisma.organisation.findUnique({
      where:  { org_id: req.org.org_id },
      select: { password_hash: true },
    });

    const valid = await bcrypt.compare(value.password, orgRecord.password_hash);
    if (!valid) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Incorrect password.',
      });
    }

    const result = await revokeCertificate(req.org.org_id, cert_hash);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

const auditQuerySchema = Joi.object({
  page:      Joi.number().min(1).default(1),
  limit:     Joi.number().min(1).max(100).default(15),
  action:    Joi.string().optional(),
  target:    Joi.string().optional(),
  date_from: Joi.date().optional(),
  date_to:   Joi.date().optional(),
});

async function getOrgAuditLogsController(req, res, next) {
  try {
    const { error, value } = auditQuerySchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const result = await getOrgAuditLogs(req.org.org_id, value.page, value.limit, {
      action:    value.action,
      target:    value.target,
      date_from: value.date_from,
      date_to:   value.date_to,
    });
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function exportOrgAuditLogsController(req, res, next) {
  try {
    const filterSchema = Joi.object({
      action:    Joi.string().optional(),
      target:    Joi.string().optional(),
      date_from: Joi.date().optional(),
      date_to:   Joi.date().optional(),
    });
    const { error, value } = filterSchema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false, message: 'Validation failed.', errors: error.details.map(d => d.message),
      });
    }

    const csv = await exportOrgAuditLogs(req.org.org_id, value);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${req.org.org_id}-${date}.csv"`);
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

const inviteSchema = Joi.object({
  email:   Joi.string().email().lowercase().optional(),
  invites: Joi.array().items(Joi.object({ email: Joi.string().email().lowercase().required() })).optional(),
}).or('email', 'invites');

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

    if (value.invites) {
      const sent = [];
      const failed = [];
      const base = process.env.APP_BASE_URL ?? process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';
      for (const { email } of value.invites) {
        try {
          const token = await generateInviteToken(req.org.org_id, email);
          const inviteLink = `${base}/accept-invite?token=${token}`;
          await sendInviteEmail(email, inviteLink, req.org.org_name);
          sent.push(email);
        } catch (e) {
          failed.push({ email, reason: e.message });
        }
      }
      return res.status(StatusCodes.OK).json({ success: true, sent: sent.length, failed });
    }

    try {
      const token = await generateInviteToken(req.org.org_id, value.email);
      const base = process.env.APP_BASE_URL ?? process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';
      const inviteLink = `${base}/accept-invite?token=${token}`;
      await sendInviteEmail(value.email, inviteLink, req.org.org_name);
      return res.status(StatusCodes.OK).json({ success: true, token });
    } catch (e) {
      if (e.code === 'RECIPIENT_ALREADY_ONBOARDED') {
        return res.status(StatusCodes.CONFLICT).json({ success: false, message: e.message });
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
}

async function getOrgRecipientDetailController(req, res, next) {
  try {
    const { id: recipient_id } = req.params;
    const recipient = await getOrgRecipientDetail(req.org.org_id, recipient_id);
    return res.status(StatusCodes.OK).json({ success: true, recipient });
  } catch (err) {
    next(err);
  }
}

const updateRecipientSchema = Joi.object({
  notes:  Joi.string().max(500).allow('').optional(),
  status: Joi.string().valid('active', 'suspended').optional(),
}).min(1);

async function updateOrgRecipientController(req, res, next) {
  try {
    const { id: recipient_id } = req.params;
    const { error, value } = updateRecipientSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }
    const recipient = await updateOrgRecipient(req.org.org_id, recipient_id, value);
    return res.status(StatusCodes.OK).json({ success: true, recipient });
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
  org_name:    Joi.string().trim().max(120).optional(),
  logo_url:    Joi.string().uri().optional().allow(''),
  website:     Joi.string().uri().optional().allow(''),
  description: Joi.string().max(500).optional().allow(''),
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

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword:     Joi.string().min(10).required(),
});

async function changePasswordController(req, res, next) {
  try {
    const { error, value } = changePasswordSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    const orgRecord = await prisma.organisation.findUnique({
      where:  { org_id: req.org.org_id },
      select: { password_hash: true },
    });

    const valid = await bcrypt.compare(value.currentPassword, orgRecord.password_hash);
    if (!valid) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Current password is incorrect.',
      });
    }

    const newHash = await bcrypt.hash(value.newPassword, 12);
    await prisma.organisation.update({
      where: { org_id: req.org.org_id },
      data:  { password_hash: newHash },
    });

    return res.status(StatusCodes.OK).json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
}

async function getDashboardActivityController(req, res, next) {
  try {
    const activity = await getRecentActivity(req.org.org_id);
    return res.status(StatusCodes.OK).json({ success: true, activity });
  } catch (err) {
    next(err);
  }
}

async function getDashboardChartController(req, res, next) {
  try {
    const chart = await getIssuanceChart(req.org.org_id);
    return res.status(StatusCodes.OK).json({ success: true, chart });
  } catch (err) {
    next(err);
  }
}

async function issueCertificateController(req, res, next) {
  try {
    const { error, value } = issueSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }
    const result = await issueCertificate({ org: req.org, ...value });
    return res.status(StatusCodes.CREATED).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function getVerificationHistoryController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const schema = Joi.object({ page: Joi.number().min(1).default(1), limit: Joi.number().min(1).max(100).default(20) });
    const { error, value } = schema.validate(req.query, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ success: false, message: 'Validation failed.', errors: error.details.map(d => d.message) });
    }
    const result = await getVerificationHistory(req.org.org_id, certificate_id, value.page, value.limit);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function resendCertificateController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const result = await resendCertificateEmail(req.org.org_id, certificate_id);
    return res.status(StatusCodes.OK).json(result);
  } catch (err) {
    next(err);
  }
}

async function downloadOrgCertificateController(req, res, next) {
  try {
    const { id: certificate_id } = req.params;
    const cert = await prisma.certificate.findUnique({ where: { certificate_id } });

    if (!cert || cert.org_id !== req.org.org_id) {
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

module.exports = { onboardOrgController, loginOrgController, getOrgRecipientsController, getOrgRecipientDetailController, updateOrgRecipientController, getOrgCertificatesController, getOrgStatsController, revokeCertificateController, getOrgAuditLogsController, exportOrgAuditLogsController, inviteRecipientController, getCertificateByIdController, getOrgProfileController, updateOrgProfileController, changePasswordController, getDashboardActivityController, getDashboardChartController, issueCertificateController, getVerificationHistoryController, resendCertificateController, downloadOrgCertificateController };
