'use strict';

const jwt             = require('jsonwebtoken');
const { StatusCodes } = require('http-status-codes');
const prisma          = require('../database/prismaClient');

async function requireRecipientAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Missing or malformed Authorization header.',
      });
    }

    const token = authHeader.slice(7);

    let payload;
    try {
      payload = jwt.verify(token, process.env.RECIPIENT_JWT_SECRET);
    } catch {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Token is invalid or expired.',
      });
    }

    if (payload.role !== 'recipient') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const recipient = await prisma.recipient.findUnique({
      where:  { recipient_id: payload.recipient_id },
      select: { recipient_id: true, email: true, name: true },
    });

    if (!recipient) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Recipient not found.',
      });
    }

    req.recipient = recipient;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireRecipientAuth };
