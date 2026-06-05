'use strict';

const Joi             = require('joi');
const { StatusCodes } = require('http-status-codes');
const { sendOtp, verifyOtp, resetPassword } = require('../services/auth.service');

const emailSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
});

const verifyOtpSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  otp:   Joi.string().length(6).pattern(/^\d{6}$/).required(),
});

const resetSchema = Joi.object({
  token:    Joi.string().required(),
  password: Joi.string().min(8).required(),
});

async function forgotPasswordController(req, res, next) {
  try {
    const { error, value } = emailSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }
    await sendOtp(value.email);
    return res.status(StatusCodes.OK).json({ success: true, message: 'OTP sent to your email address.' });
  } catch (err) {
    next(err);
  }
}

async function verifyOtpController(req, res, next) {
  try {
    const { error, value } = verifyOtpSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({
        success: false,
        message: 'Validation failed.',
        errors:  error.details.map(d => d.message),
      });
    }
    const reset_token = await verifyOtp(value.email, value.otp);
    return res.status(StatusCodes.OK).json({ success: true, reset_token });
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

module.exports = { forgotPasswordController, verifyOtpController, resetPasswordController };

