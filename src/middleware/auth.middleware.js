'use strict';

const jwt             = require('jsonwebtoken');
const { StatusCodes } = require('http-status-codes');
const prisma          = require('../database/prismaClient');

async function requireAuth(req, res, next) {
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
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Token is invalid or expired.',
      });
    }

    const org = await prisma.organisation.findUnique({
      where:  { org_id: payload.org_id },
      select: { org_id: true, msp_id: true, org_name: true, email: true, status: true },
    });

    if (!org || org.status === 'revoked') {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Organisation not found or has been revoked.',
      });
    }

    req.org = org;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
