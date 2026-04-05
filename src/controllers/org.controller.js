'use strict';

const Joi             = require('joi');
const { StatusCodes } = require('http-status-codes');
const { onboardOrg, loginOrg } = require('../services/org.service');

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

module.exports = { onboardOrgController, loginOrgController };
