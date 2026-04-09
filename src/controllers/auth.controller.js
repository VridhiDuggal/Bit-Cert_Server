'use strict';

const Joi             = require('joi');
const { StatusCodes } = require('http-status-codes');
const { generateResetToken, resetPassword } = require('../services/auth.service');

const forgotSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

const resetSchema = Joi.object({
  token:    Joi.string().required(),
  password: Joi.string().min(8).required(),
});

async function forgotPasswordController(req, res, next) {
  try {
    const { error, value } = forgotSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    await generateResetToken(value.email);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'If an account with that email exists, a reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

async function resetPasswordController(req, res, next) {
  try {
    const { error, value } = resetSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }

    await resetPassword(value.token, value.password);
    return res.status(StatusCodes.OK).json({ success: true, message: 'Password reset successfully.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { forgotPasswordController, resetPasswordController };
