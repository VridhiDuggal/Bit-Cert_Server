'use strict';

const Joi        = require('joi');
const { StatusCodes } = require('http-status-codes');
const { issueCertificate, verifyCertificate } = require('../services/certificate.service');

const issueSchema = Joi.object({
  recipient_id:    Joi.string().uuid(),
  recipient_email: Joi.string().email().lowercase(),
  recipient_name:  Joi.string().max(200).required(),
  course:          Joi.string().max(200).required(),
  description:     Joi.string().max(1000).optional(),
  issue_date:      Joi.string().isoDate().required(),
}).xor('recipient_id', 'recipient_email');

const hashParamSchema = Joi.object({
  cert_hash: Joi.string().hex().length(64).required(),
});

async function issueCertificateController(req, res, next) {
  const { error, value } = issueSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
      success: false,
      message: 'Validation failed.',
      errors:  error.details.map(d => d.message),
    });
  }

  try {
    const result = await issueCertificate({ org: req.org, ...value });
    return res.status(StatusCodes.CREATED).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

async function verifyCertificateController(req, res, next) {
  const { error, value } = hashParamSchema.validate(req.params);
  if (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: 'Validation failed.',
      errors:  error.details.map(d => d.message),
    });
  }

  try {
    const result = await verifyCertificate(value.cert_hash, req.ip);
    return res.status(StatusCodes.OK).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { issueCertificateController, verifyCertificateController };
