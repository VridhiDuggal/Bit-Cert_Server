// src/app.js
// Express application factory.
// Responsible for middleware wiring, route mounting, and error handling.
// Server binding (listen) lives in index.js to keep this module testable.

'use strict';

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieSession = require('cookie-session');
const { StatusCodes } = require('http-status-codes');

const errorHandler  = require('./middleware/errorHandler');
const testRoutes    = require('./routes/test.routes');
const cryptoRoutes  = require('./routes/crypto.routes');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
// Restrict origins to the local frontend dev server in development;
// substitute real domain(s) via CORS_ORIGIN env var in production.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,       // required for cookie-session to work cross-origin
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── Session ───────────────────────────────────────────────────────────────────
// cookie-session stores session data client-side (signed + encrypted cookie).
// SESSION_SECRET must be at least 32 random bytes in production.
app.use(
  cookieSession({
    name:     'bit-cert.session',
    secret:   process.env.SESSION_SECRET,
    maxAge:   24 * 60 * 60 * 1000, // 24 h
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  })
);

// ── Health check ──────────────────────────────────────────────────────────────
// Lightweight endpoint used by Docker health checks and load balancers.
app.get('/health', (req, res) => {
  res.status(StatusCodes.OK).json({
    success: true,
    status:  'ok',
    env:     process.env.NODE_ENV,
    ts:      new Date().toISOString(),
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
// Mount versioned route groups here as the project grows.
// Example: app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api', testRoutes);
app.use('/api', cryptoRoutes);

// ── 404 fallback ──────────────────────────────────────────────────────────────
// Catches any request that did not match a registered route.
app.use((req, res) => {
  res.status(StatusCodes.NOT_FOUND).json({
    success: false,
    statusCode: StatusCodes.NOT_FOUND,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Must be the LAST middleware registered.
// Express 5 auto-forwards async route errors here; no try/catch needed in routes.
app.use(errorHandler);

module.exports = app;
