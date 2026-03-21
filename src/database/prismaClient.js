// src/database/prismaClient.js
// Exports a singleton PrismaClient instance.
// Single instantiation avoids exhausting the DB connection pool during
// hot-reloads in development (nodemon) and keeps connection state predictable.
//
// Prisma 7 uses the new TypeScript query engine which requires a driver adapter.
// @prisma/adapter-pg wraps node-postgres (pg) for traditional PostgreSQL setups.

'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// Reuse existing instance between HMR cycles in development.
const globalForPrisma = globalThis;

if (!globalForPrisma.__prisma) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  globalForPrisma.__prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'warn', 'error']
      : ['warn', 'error'],
  });
}

const prisma = globalForPrisma.__prisma;

module.exports = prisma;
