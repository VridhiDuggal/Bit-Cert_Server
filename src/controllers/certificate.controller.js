'use strict';

const Joi        = require('joi');
const { StatusCodes } = require('http-status-codes');
const { issueCertificate, verifyCertificate } = require('../services/certificate.service');

const issueSchema = Joi.object({
  recipient_id:    Joi.string().uuid(),
  recipient_email: Joi.string().email().lowercase(),
  recipient_name:  Joi.string().max(200).required(),
  course:          Joi.string().max(200).required(),
  issue_date:      Joi.string().isoDate().required(),
}).xor('recipient_id', 'recipient_email');

const hashParamSchema = Joi.object({
  cert_hash: Joi.string().hex().length(64).required(),
});

async function issueCertificateController(req, res) {
  const { error, value } = issueSchema.validate(req.body);
  if (error) {
    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ message: error.details[0].message });
  }

  try {
    const result = await issueCertificate({ org: req.org, ...value });
    return res.status(StatusCodes.CREATED).json(result);
  } catch (err) {
    const status = err.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;
    return res.status(status).json({ message: err.message });
  }
}

async function verifyCertificateController(req, res) {
  const { error, value } = hashParamSchema.validate(req.params);
  if (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({ message: error.details[0].message });
  }

  try {
    const result = await verifyCertificate(value.cert_hash);
    return res.status(StatusCodes.OK).json(result);
  } catch (err) {
    const status = err.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;
    return res.status(status).json({ message: err.message });
  }
}

module.exports = { issueCertificateController, verifyCertificateController };
