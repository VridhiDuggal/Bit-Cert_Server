// src/index.js
// Process entry point.
// Order matters: load env → validate → connect DB → start server.

'use strict';

// ── 1. Load environment variables from .env ───────────────────────────────────
require('dotenv').config();

// ── 2. Validate environment variables (fail-fast on missing/wrong values) ─────
const { validateEnv } = require('./config/env');
const env = validateEnv();

// ── 3. Third-party / internal imports (after env is guaranteed valid) ─────────
const app    = require('./app');
const prisma = require('./database/prismaClient');

const PORT = env.PORT;

// ── 4. Database connection ────────────────────────────────────────────────────
async function connectDatabase() {
  await prisma.$connect();
  console.info('[DB] PostgreSQL connected via Prisma.');
}

// ── 5. Server startup ─────────────────────────────────────────────────────────
async function startServer() {
  await connectDatabase();

  const server = app.listen(PORT, () => {
    console.info('─'.repeat(50));
    console.info(`[SERVER] Bit-Cert API running`);
    console.info(`[SERVER] Environment : ${env.NODE_ENV}`);
    console.info(`[SERVER] Port        : ${PORT}`);
    console.info(`[SERVER] Health      : http://localhost:${PORT}/health`);
    console.info('─'.repeat(50));
  });

  // ── 6. Graceful shutdown ──────────────────────────────────────────────────
  // Allows in-flight requests to finish before the process exits.
  async function shutdown(signal) {
    console.info(`\n[SERVER] ${signal} received. Shutting down gracefully…`);

    server.close(async () => {
      console.info('[SERVER] HTTP server closed.');
      await prisma.$disconnect();
      console.info('[DB] Prisma disconnected.');
      process.exit(0);
    });

    // Force-kill after 10 s if graceful close stalls.
    setTimeout(() => {
      console.error('[SERVER] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Catch unhandled promise rejections so they don't silently swallow errors.
  process.on('unhandledRejection', (reason) => {
    console.error('[PROCESS] Unhandled rejection:', reason);
  });
}

startServer().catch((err) => {
  console.error('[SERVER] Failed to start:', err);
  process.exit(1);
});
