// src/middleware/errorHandler.js
// Global Express error-handling middleware (4-argument signature required by Express).
// Must be registered LAST in app.js, after all routes.

'use strict';

const { StatusCodes } = require('http-status-codes');

/**
 * Structured error response shape:
 * { success: false, statusCode, message, ...(stack in dev) }
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isDev = process.env.NODE_ENV === 'development';

  // Honour statusCode set on the error object, otherwise 500.
  const statusCode = err.statusCode ?? err.status ?? StatusCodes.INTERNAL_SERVER_ERROR;

  // Avoid leaking internal details outside development.
  const message =
    statusCode < 500 || isDev
      ? err.message
      : 'An unexpected error occurred. Please try again later.';

  const body = {
    success: false,
    statusCode,
    message,
    ...(isDev && err.stack && { stack: err.stack }),
  };

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
