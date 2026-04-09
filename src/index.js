'use strict';

const _exit = process.exit.bind(process);
process.exit = (code) => {
  console.trace(`[DEBUG] process.exit(${code}) called from:`);
  _exit(code);
};

require('dotenv').config();

const { validateEnv } = require('./config/env');
const env = validateEnv();

const app    = require('./app');
const prisma = require('./database/prismaClient');

const PORT = env.PORT;

async function connectDatabase() {
  await prisma.$connect();
  console.info('[DB] PostgreSQL connected via Prisma.');
}

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

  async function shutdown(signal) {
    console.info(`\n[SERVER] ${signal} received. Shutting down gracefully…`);
    server.close(async () => {
      console.info('[SERVER] HTTP server closed.');
      await prisma.$disconnect();
      console.info('[DB] Prisma disconnected.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[SERVER] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    console.error('[PROCESS] Unhandled rejection:', reason);
  });
}

startServer().catch((err) => {
  console.error('[SERVER] Failed to start:', err);
  process.exit(1);
});