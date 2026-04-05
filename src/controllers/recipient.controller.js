'use strict';

const Joi             = require('joi');
const { StatusCodes } = require('http-status-codes');
const { createRecipient } = require('../services/recipient.service');

const createSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  name:  Joi.string().max(120).required(),
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

module.exports = { createRecipientController };
