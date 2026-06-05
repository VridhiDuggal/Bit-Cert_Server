#!/bin/sh
set -e

# ── Step 1: Wait for Postgres ────────────────────────────────────────────────
echo "[backend] Waiting for postgres..."
until nc -z postgres 5432; do
  sleep 2
done
echo "[backend] Postgres is reachable."

# ── Step 2: Wait for Fabric CLI to finish initializing ───────────────────────
# The fabric-cli writes /fabric-data/initialized only after channel creation,
# chaincode deployment, wallet, and connection profile are all written.
# Checking the TCP port alone is not enough — the peer opens port 7051 long
# before the CLI finishes.
echo "[backend] Waiting for Fabric initialization to complete..."
WAIT_COUNT=0
until [ -f /fabric-data/initialized ]; do
  WAIT_COUNT=$((WAIT_COUNT + 1))
  if [ "$WAIT_COUNT" -gt 72 ]; then
    echo "[backend] ERROR: Timed out after 6 minutes waiting for Fabric CLI to finish. Check fabric-cli logs."
    exit 1
  fi
  echo "[backend] /fabric-data/initialized not found yet — waiting ($WAIT_COUNT/72)..."
  sleep 5
done
echo "[backend] Fabric initialization complete."

# ── Step 3: Run Prisma migrations (idempotent) ────────────────────────────────
echo "[backend] Running Prisma migrations..."
npx prisma migrate deploy
echo "[backend] Migrations complete."

# ── Step 4: Seed if organisations table is empty ──────────────────────────────
echo "[backend] Checking if seed is needed..."
ORG_COUNT=$(node -e "
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
prisma.organisation.count()
  .then(c => { process.stdout.write(String(c)); return prisma.\$disconnect(); })
  .catch(() => { process.stdout.write('0'); process.exit(0); });
")

if [ "$ORG_COUNT" = "0" ]; then
  echo "[backend] Seeding database..."
  node scripts/seed.js || echo "[backend] Seed warning — continuing."
else
  echo "[backend] Database already seeded ($ORG_COUNT org(s) found) — skipping."
fi

# ── Step 5: Sync orgs to chain (idempotent) ───────────────────────────────────
echo "[backend] Syncing organisations to blockchain..."
node scripts/syncOrgsToChain.js || echo "[backend] Sync warning — Fabric may not be ready yet, continuing."

# ── Step 6: Start server ─────────────────────────────────────────────────────
echo "[backend] Starting server..."
exec node src/index.js
