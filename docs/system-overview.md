# Bit-Cert — System Overview

---

## Section 1 — Project Overview

Bit-Cert is a blockchain-anchored digital certificate platform. Organisations issue verifiable credentials to recipients; anyone can independently verify a certificate's authenticity without contacting the issuing organisation.

### Core Idea

A certificate's hash and ECDSA signature are written to Hyperledger Fabric at issuance. Verification reads directly from the chain — the signature is checked against the issuing organisation's public key also stored on-chain. The off-chain database holds metadata, PDFs, and logs but is never the source of truth for validity.

### Key Actors

| Actor | Description |
|---|---|
| **Organisation** | A credential-issuing body. Onboards once, receives an ECDSA key pair and an on-chain identity. Issues and revokes certificates. |
| **Recipient** | A person who receives a certificate. Created when an org invites or issues to them. Can log in and view their own certificates. |
| **Public Verifier** | Any party with a certificate hash. Can verify authenticity via the public endpoint without any account. |

---

## Section 2 — Data Models

### Organisation

```
org_id        UUID (PK)
msp_id        String (unique) — derived from org_name, e.g. "AcmeCo" → "AcmeCoMSP"
org_name      String
email         String (unique)
public_key    String — ECDSA public key registered on Fabric
private_key   String — stored server-side for signing certificates
password_hash String — bcrypt (12 rounds)
enrolled_at   DateTime
status        Enum: active | revoked
```

**Relationships:** has many Certificates, Recipients, InviteTokens, AuditLogs.

**Purpose:** Represents a credentialing organisation. Both database identity and blockchain identity (`msp_id` + `public_key`) are created at onboarding.

---

### Recipient

```
recipient_id      UUID (PK)
email             String (unique)
name              String
password_hash     String? — set when recipient accepts an invite and creates a password
did               String? — reserved for future decentralised identity support
invited_by_org_id UUID (FK → Organisation)
created_at        DateTime
```

**Relationships:** belongs to one Organisation (inviter), has many Certificates.

**Purpose:** A person who can receive and hold certificates. Created either by direct org action or implicitly during certificate issuance.

---

### Certificate

```
certificate_id   UUID (PK)
org_id           UUID (FK → Organisation)
recipient_id     UUID (FK → Recipient)
cert_hash        Char(64) (unique) — SHA-256 of payload (msp_id + recipient_name + course + issue_date)
ecdsa_signature  String — org's ECDSA signature of cert_hash
blockchain_tx_id String — synthetic transaction ID referencing on-chain write
file_path        String — relative path to generated PDF, e.g. uploads/<hash>.pdf
recipient_name   String — denormalised recipient name at time of issuance
course           String — course or credential title
description      String? — optional additional description
issue_date       DateTime — date the credential was earned
issued_by        String? — org_name at time of issuance
issued_at        DateTime — DB record creation timestamp
is_revoked       Boolean (default false)
```

**Relationships:** belongs to Organisation and Recipient, has many VerificationLogs.

**Purpose:** The core credential record. The `cert_hash` ties the off-chain record to the on-chain entry. The `ecdsa_signature` is what verification checks.

---

### InviteToken

```
invite_id       UUID (PK)
org_id          UUID (FK → Organisation)
recipient_email String
token_hash      Char(64) (unique) — SHA-256 of the full token string
expires_at      DateTime — 7 days from creation
used_at         DateTime? — set when the token is consumed
created_at      DateTime
```

**Purpose:** One-time invite credential sent by email. Token itself is `base64url(32-random-bytes).base64url(HMAC-SHA256)`. Only the SHA-256 hash of the full token is stored — the raw token is never persisted.

---

### AuditLog

```
log_id     UUID (PK)
org_id     UUID (FK → Organisation)
action     String — one of: ISSUE, REVOKE, INVITE, RECIPIENT_CREATE
target     String — cert_hash for ISSUE/REVOKE, recipient email for INVITE/RECIPIENT_CREATE
metadata   JSON? — optional context (e.g. { recipient_email, course } for ISSUE)
created_at DateTime
```

**Purpose:** Immutable append-only audit trail of all sensitive operations performed by or on behalf of an organisation. Used for compliance review via the dashboard.

---

### PasswordResetToken

```
token_id   UUID (PK)
email      String — email of the account requesting a reset
user_type  String — 'org' or 'recipient'
token_hash Char(64) (unique) — SHA-256 of the raw token sent to the user
expires_at DateTime — 1 hour from creation
used_at    DateTime? — set when the token is consumed
created_at DateTime
```

**Purpose:** One-time password-reset credential. The raw 32-byte hex token is sent via email and never stored. Only its SHA-256 hash is stored. Supports both org and recipient accounts via `user_type`.

---

### VerificationLog

```
log_id         UUID (PK)
certificate_id UUID (FK → Certificate)
verified_at    DateTime
verifier_ip    String — requester's IP address
result         Boolean — true if verification passed
```

**Purpose:** Records every public verification attempt against a certificate, including failures. Useful for detecting abuse or tracking certificate reach.

---

## Section 3 — API List

All routes are mounted under `/api`.

### Org APIs

```
POST   /api/org/onboard
POST   /api/org/login
GET    /api/org/recipients               [requireAuth] — supports ?search=
GET    /api/org/certificates             [requireAuth] — supports ?search= &status= &from_date= &to_date=
GET    /api/org/dashboard/stats          [requireAuth]
POST   /api/org/certificate/revoke/:hash  [requireAuth]
GET    /api/org/audit-logs               [requireAuth]
POST   /api/org/invite                   [requireAuth] — send invite email to a recipient
GET    /api/org/certificate/:id          [requireAuth] — full detail for one certificate
POST   /api/org/recipient/create         [requireAuth]
POST   /api/org/certificate/issue        [requireAuth]
GET    /api/org/profile                  [requireAuth]
PATCH  /api/org/profile                  [requireAuth] — update org_name
```

### Recipient APIs

```
POST   /api/recipient/login
POST   /api/recipient/accept-invite       — public; activates account from invite token
GET    /api/recipient/certificates        [requireRecipientAuth] — supports ?search= &status= &from_date= &to_date=
GET    /api/recipient/certificate/:id     [requireRecipientAuth] — full detail for one certificate
GET    /api/recipient/certificate/:id/qr  [requireRecipientAuth]
GET    /api/recipient/profile             [requireRecipientAuth]
```

### Auth APIs (public)

```
POST   /api/auth/forgot-password          — sends reset link to email; silent if address unknown
POST   /api/auth/reset-password           — consumes reset token, updates password
```

### Certificate / Public APIs

```
GET    /api/verify/:cert_hash
```

### Utility / Dev APIs

```
GET    /api/test-fabric
GET    /api/test-fabric-org?msp_id=
POST   /api/crypto/generate-keys
POST   /api/crypto/sign
POST   /api/crypto/verify
```

### Static

```
GET    /uploads/:filename               — PDF file serving (no auth)
GET    /health                          — Health check
```

---

## Section 4 — Application Flows

### 1. Organisation Onboarding

1. `POST /api/org/onboard` — body: `{ org_name, email, password }`
2. `msp_id` derived from `org_name` (PascalCase words + "MSP")
3. Duplicate check on `email` and `msp_id`
4. ECDSA key pair generated; password bcrypt-hashed; private key AES-256-CBC encrypted
5. `Organisation` row created in DB (encrypted private key stored)
6. Fabric: check if `msp_id` already registered via `GetOrgPublicKey`; if not, call `RegisterOrg(msp_id, publicKey)`
7. If Fabric write fails, the DB row is deleted (rollback)
8. Returns org metadata (no secrets)

---

### 2. Organisation Login

1. `POST /api/org/login` — body: `{ email, password }`
2. Fetch org by email; check `status !== revoked`
3. bcrypt password comparison
4. JWT signed with `JWT_SECRET`, payload: `{ sub, org_id, role: 'org', org_name, email }`
5. Returns `{ token, org }`

---

### 3. Invite Flow

1. `POST /api/org/invite` — `requireAuth`, body: `{ email }`
2. `generateInviteToken(org_id, email)` — generates HMAC-signed token, stores SHA-256 hash in `InviteToken`, emits `INVITE` audit log
3. Invite link constructed: `${APP_BASE_URL}/accept-invite?token=<raw_token>`
4. `sendInviteEmail(email, inviteLink, orgName)` sends EJS-templated HTML email via configured SMTP
5. Response returns the raw token (useful for testing; token also sent to recipient via email)
6. Recipient opens link containing the raw token and proceeds to accept-invite

---

### 9. Reset Password Flow

1. `POST /api/auth/forgot-password` — public, body: `{ email }`
2. DB lookup in both `Organisation` and `Recipient` tables by email
3. If not found, request returns success silently (no email enumeration)
4. `crypto.randomBytes(32).toString('hex')` — raw token generated; SHA-256 digest stored in `PasswordResetToken`
5. `sendPasswordResetEmail(email, resetLink)` sends EJS-templated email with 1-hour expiry
6. `POST /api/auth/reset-password` — public, body: `{ token, password (min 8) }`
7. SHA-256 hash of token looked up in `PasswordResetToken`
8. Checks: not found → 400; already used → 410; expired → 410
9. `bcrypt.hash(password, 12)` stored to appropriate table based on `user_type`
10. `used_at` stamped — token is permanently invalidated

---

### 10. Search and Filter

**Org certificate list** (`GET /api/org/certificates`) accepts:
- `search` — case-insensitive substring match on `recipient_name`, `course`, or `recipient.email`
- `status` — `active` (is_revoked=false) or `revoked` (is_revoked=true)
- `from_date` / `to_date` — ISO date range on `issued_at`
- `page` / `limit` — pagination (default 1/10, max limit 100)

**Org recipient list** (`GET /api/org/recipients`) accepts:
- `search` — case-insensitive substring match on `name` or `email`
- `page` / `limit` — pagination

**Recipient certificate list** (`GET /api/recipient/certificates`) accepts:
- `search` — case-insensitive match on `course`, `recipient_name`, or issuing `org_name`
- `status` — `active` or `revoked`
- `from_date` / `to_date` — ISO date range on `issued_at`

All filters are optional; omitting them returns all results for the authenticated user.

---

### 4. Recipient Registration Flow

1. `POST /api/recipient/accept-invite` — public, body: `{ token, name, password (min 8) }`
2. `validateInviteToken(token)`:
   - Splits token, re-derives HMAC, verifies with `timingSafeEqual`
   - Looks up by SHA-256 hash
   - Checks `used_at` (410 if already used) and `expires_at` (410 if expired)
   - Returns `{ org_id, recipient_email, token_hash }`
3. `bcrypt.hash(password, 12)`
4. `prisma.recipient.upsert` — creates Recipient if new, otherwise updates `name` and `password_hash`
5. `markTokenUsed(token_hash)` stamps `used_at`
6. Returns `{ success: true, message: 'Account activated. You can now log in.' }`

---

### 5. Certificate Issuance

1. `POST /api/org/certificate/issue` — `requireAuth`, body: `{ recipient_id | recipient_email, recipient_name, course, description?, issue_date }`
2. If `recipient_email` given, `createRecipient` is called (upsert — returns existing if email already known)
3. Recipient existence confirmed
4. Org's `private_key` fetched from DB and decrypted in memory
5. `cert_hash = SHA-256({ msp_id, recipient_name, course, issue_date })`
6. `signature = ECDSA_sign(cert_hash, decryptedPrivateKey)`
7. Fabric: `StoreCertificate(cert_hash, signature, msp_id, file_path)` — **blockchain writes first**
8. If Fabric fails → abort with 503 (no DB record created)
9. `Certificate` row created in DB
10. If DB fails after blockchain success → log `cert_hash` for reconciliation, return 500
11. PDF generated via PDFKit → saved to `uploads/<hash>.pdf`
12. DB `file_path` updated with actual path
13. QR code generated (encodes `${VERIFICATION_BASE_URL}/api/verify/${cert_hash}`)
14. Audit log: `ISSUE`, target: `cert_hash`, metadata: `{ recipient_email, course }`
15. Returns `{ certificate_id, cert_hash, blockchain_tx_id, file_path, qr_code }`

---

### 6. Certificate Verification (Public)

1. `GET /api/verify/:cert_hash` — no auth required
2. DB lookup by `cert_hash` (for org name and audit data)
3. Fabric: `GetCertificate(cert_hash)` — returns `{ isRevoked, signature, orgMSPID }`
4. Fabric: `GetOrgPublicKey(orgMSPID)` — retrieves issuer's public key
5. `verifySignature(cert_hash, signature, publicKey)` — ECDSA check
6. `VerificationLog` row written at every outcome (pass or fail) if `dbCert` exists
7. Returns `{ valid, cert_hash, issuer, issued_at, is_revoked }` or `{ valid: false, reason }`

---

### 7. Certificate Revocation

1. `POST /api/org/certificate/revoke/:hash` — `requireAuth`
2. Certificate fetched by `cert_hash`; 404 if not found
3. Ownership check: `cert.org_id !== req.org.org_id` → 403
4. Already revoked check → 409
5. Fabric: `RevokeCertificate(cert_hash)` — **blockchain writes first**
6. If Fabric fails → abort with 503
7. DB: `is_revoked = true`
8. If DB fails after blockchain success → log `cert_hash` for reconciliation, return 500
9. Audit log: `REVOKE`, target: `cert_hash`
10. Returns `{ success: true, cert_hash }`

---

### 8. Recipient Certificate Access

1. `POST /api/recipient/login` — body: `{ email, password }`
   - bcrypt comparison against `password_hash`
   - JWT signed with `RECIPIENT_JWT_SECRET`, payload: `{ sub, recipient_id, role: 'recipient', email, name }`
2. `GET /api/recipient/certificates` — `requireRecipientAuth`
   - Returns all certificates for `req.recipient.recipient_id`, with org name, msp_id, and QR URL per cert
3. `GET /api/recipient/certificate/:id` — `requireRecipientAuth`
   - Ownership enforced: `cert.recipient_id !== recipient_id` → 403
   - Returns full certificate detail including `org_name`, `msp_id`, `verification_url`
4. `GET /api/recipient/certificate/:id/qr` — `requireRecipientAuth`
   - Ownership enforced: `cert.recipient_id !== recipient_id` → 403
   - Returns `{ cert_hash, qr_url }`

---

## Section 5 — System Architecture

### Layered Structure

```
HTTP Request
    │
    ▼
[Rate Limiter]  — express-rate-limit applied to auth + verify routes
    │
    ▼
[Controller]  — Validates input (Joi), calls service, returns HTTP response
    │
    ▼
[Service]     — Business logic, orchestrates DB + Fabric + utilities
    │
    ├──▶ [Prisma Client]      — PostgreSQL via @prisma/adapter-pg
    │
    ├──▶ [fabricService]      — Hyperledger Fabric Gateway (submitTransaction / evaluateTransaction)
    │
    ├──▶ [cryptoService]      — ECDSA key generation, signing, verification
    │
    ├──▶ [encryption.util]    — AES-256-CBC encrypt/decrypt for private key at-rest protection
    │
    ├──▶ [pdf.service]        — PDFKit document generation
    │
    ├──▶ [mail.service]       — Nodemailer + EJS templating
    │
    └──▶ [auditLog.service]   — Audit entry creation
```

### Request Lifecycle

1. `helmet` sets security headers
2. `cors` enforces allowed origin
3. Body parsed by `express.json`
4. `cookieSession` middleware hydrates session
5. **`express-rate-limit`** applied to auth and verify routes (before route handlers)
6. Route matched → auth middleware runs (`requireAuth` or `requireRecipientAuth`)
7. Controller validates request body/params with Joi
8. Service layer executes business logic
9. Response returned; errors forwarded to global `errorHandler`

### Key Non-Route Files

| File | Role |
|---|---|
| `src/index.js` | Server bootstrap, validates env, calls `connectGateway`, starts `app.listen` |
| `src/app.js` | Express factory — middleware, route mounting, static file serving, error handler |
| `src/config/env.js` | `envalid` schema; process exits on startup if any required var is missing |
| `src/database/prismaClient.js` | Singleton Prisma client with `PrismaPg` adapter |
| `scripts/seed.js` | Re-registers all orgs on Fabric after network restart (`npm run seed`) |

---

## Section 6 — Role of Blockchain

### Why Blockchain

The central problem with database-only storage: the issuing body can silently alter or delete a certificate record. Hyperledger Fabric provides a permissioned ledger where appended entries are tamper-evident and auditable by all channel members.

### What Is Stored On-Chain

| Data | Notes |
|---|---|
| `cert_hash` | SHA-256 of `{ msp_id, recipient_name, course, issue_date }` |
| `ecdsa_signature` | Org's signature over `cert_hash` |
| `msp_id` | Issuer identity |
| `is_revoked` flag | Updated by `RevokeCertificate` chaincode call |
| Organisation public key | Registered once at onboarding via `RegisterOrg` |

### What Is NOT Stored On-Chain

- Recipient PII (name, email)
- PDF files
- Password hashes
- Invite tokens
- Audit logs (DB-only)

### Verification Without Trusting the Issuer

Any verifier with `cert_hash` can:
1. Retrieve the certificate record from Fabric (`GetCertificate`)
2. Retrieve the issuer's public key from Fabric (`GetOrgPublicKey`)
3. Check the ECDSA signature locally
4. Check the revocation flag

All four steps use only on-chain data — the off-chain database is optional context only.

### Chaincode Functions Referenced

| Function | Direction | Purpose |
|---|---|---|
| `RegisterOrg(msp_id, publicKey)` | submit | Register org identity at onboarding |
| `StoreCertificate(hash, sig, msp_id, path)` | submit | Write certificate to ledger |
| `RevokeCertificate(hash)` | submit | Mark certificate revoked on ledger |
| `GetCertificate(hash)` | evaluate | Read certificate record |
| `GetOrgPublicKey(msp_id)` | evaluate | Read org's public key |

---

## Section 7 — Security Design

### JWT Authentication

Two separate JWT namespaces exist with different secrets and role guards:

| Actor | Secret | Role claim | Middleware |
|---|---|---|---|
| Organisation | `JWT_SECRET` | `role: 'org'` | `requireAuth` |
| Recipient | `RECIPIENT_JWT_SECRET` | `role: 'recipient'` | `requireRecipientAuth` |

Both middlewares verify the token, check the role, then perform a live DB lookup to confirm the entity still exists and (for orgs) is not revoked. An org token cannot pass `requireRecipientAuth` and vice versa.

### Rate Limiting

`express-rate-limit` is applied in `app.js` before route handlers:

| Limiter | Routes | Window | Max requests |
|---|---|---|---|
| `authLimiter` | `/api/org/login`, `/api/recipient/login`, `/api/auth/forgot-password`, `/api/auth/reset-password` | 15 min | 20 |
| `verifyLimiter` | `/api/verify/*` | 15 min | 100 |

Exceeded requests receive `429 Too Many Requests` with `{ success: false, message: '...' }`.

### Private Key Encryption

Organisation ECDSA private keys are encrypted at rest using AES-256-CBC:

- Key derived by SHA-256 hashing `PRIVATE_KEY_SECRET` env var to a 32-byte key
- A random 16-byte IV is generated per encryption
- Stored format: `<iv_hex>:<ciphertext_hex>` in the `Organisation.private_key` DB column
- `encrypt(plaintext)` called in `onboardOrg` before DB write
- `decrypt(ciphertext)` called in `issueCertificate` immediately before signing; the plaintext key is never stored in a variable beyond the signing call
- Implemented in `src/utils/encryption.util.js`; requires `PRIVATE_KEY_SECRET` env var

### Invite Token Security

- 32 bytes of CSPRNG randomness as the nonce
- HMAC-SHA256 (server secret: `INVITE_SECRET`) over the raw bytes as the authenticator
- Token format: `base64url(nonce).base64url(hmac)`
- Only `SHA-256(token)` is stored in DB — the plaintext token is never persisted
- `crypto.timingSafeEqual` used for HMAC comparison (prevents timing attacks)
- 7-day expiry enforced at validation time
- Single-use enforced via `used_at` timestamp

### Ownership Enforcement

- `revokeCertificate`: checks `cert.org_id === req.org.org_id`
- `getCertificateQR`: checks `cert.recipient_id === req.recipient.recipient_id`
- `getOrgRecipients`, `getOrgCertificates`, `getOrgAuditLogs`: all filter by `req.org.org_id` server-side

### Verification Logging

Every call to `GET /api/verify/:cert_hash` writes a `VerificationLog` row capturing the verifier's IP and outcome. This creates a tamper-evident access log for each certificate.

---

## Section 8 — File Storage

### PDF Generation

At certificate issuance, `pdf.service.js` uses PDFKit to synchronously generate a PDF containing recipient name, course, issuing organisation, and certificate hash. The file is streamed to `uploads/<cert_hash>.pdf`. The promise resolves only after the write stream emits `finish`.

### Storage Layout

```
Bit-Cert_Backend/
└── uploads/
    └── <cert_hash>.pdf
```

### Static Serving

`app.js` mounts:
```
GET /uploads/:filename  →  express.static(path.join(__dirname, '..', 'uploads'))
```

PDFs are publicly accessible at `http://<host>/uploads/<cert_hash>.pdf` with no authentication. This is intentional — the file is referenced by the certificate QR code for public access.

### file_path Usage

`Certificate.file_path` stores the relative path `uploads/<hash>.pdf`. The frontend constructs the full URL by prepending the API base URL: `${VERIFICATION_BASE_URL}/${file_path}`.

---

## Section 9 — Audit & Logging

### Audit Log (AuditLog model)

Written by `logAuditEvent()` for every sensitive operation:

| Action | Trigger | Target |
|---|---|---|
| `ISSUE` | `issueCertificate` completes | `cert_hash` |
| `REVOKE` | `revokeCertificate` completes | `cert_hash` |
| `INVITE` | `generateInviteToken` completes | `recipient_email` |
| `RECIPIENT_CREATE` | `createRecipient` creates a new row | `recipient_email` |

The `ISSUE` action also carries `metadata: { recipient_email, course }` for traceability. Audit logs are scoped by `org_id` and available to the org via `GET /api/org/audit-logs` (paginated).

### Verification Log (VerificationLog model)

Written by `verifyCertificate()` at every code path that reaches an outcome:

- Certificate not found on blockchain → `result: false`
- Certificate revoked on blockchain → `result: false`
- Issuer org key not found → `result: false`
- Signature valid → `result: true`
- Signature invalid → `result: false`

Logged only when a matching `Certificate` row exists in the DB. Captures `verifier_ip` for abuse detection.

---

## Section 10 — Gaps & Recommended Improvements

### Remaining Open Items

| Item | Description |
|---|---|
| `Recipient.did` is unused | No code sets or reads the `did` field. Reserved space without a plan. |
| `uploads/` is fully public | PDFs contain no PII in current form, but if access control is needed, consider signed URL delivery for recipient downloads. |
| `test.routes.js` in production | `GET /api/test-fabric` and `GET /api/test-fabric-org` expose Fabric connectivity and are not gated. Remove or guard behind auth in production. |
| `crypto.routes.js` exposed | The `/api/crypto/*` endpoints allow arbitrary key generation and signing. Restrict or remove in production. |
| `JWT_EXPIRES_IN` fallback is 24h | Long-lived tokens. Consider adding token refresh infrastructure or reducing default expiry. |
| PDF generation is blocking | PDF generation runs synchronously in the request lifecycle. For high throughput, consider moving to a background job queue. |
| No connection pooling config | `PrismaPg` connection pool size is untuned. Set `connection_limit` appropriate for the environment. |

### Production Baseline

The following hardening items from initial design are now implemented:

- ✅ Private keys encrypted at rest (AES-256-CBC via `PRIVATE_KEY_SECRET`)
- ✅ Rate limiting on all auth and verification endpoints
- ✅ `file_path` ReferenceError in `issueCertificate` fixed
- ✅ `recipient` + `org` DB lookups parallelised with `Promise.all` in `issueCertificate`
- ✅ Certificate schema includes `recipient_name`, `course`, `description`, `issue_date`, `issued_by`
- ✅ Invite and accept-invite endpoints wired
- ✅ Password reset system for both org and recipient
- ✅ Search and filter on all list endpoints
- ✅ Profile endpoints for org and recipient
- ✅ Compensating transaction pattern for DB failures after blockchain commits
- ✅ Blockchain errors return 503 (Service Unavailable)
- ✅ Fabric Gateway retry on stale connections (1 automatic retry)
- ✅ QR codes encode verification URL directly (scannable)
- ✅ All controllers use `{ success, data }` response envelope
- ✅ `description` accepted in certificate issuance validation

---

## Section 11 — Complete System Flow Summary

```
Organisation Onboarding
  POST /api/org/onboard
  → ECDSA key pair generated
  → Private key encrypted (AES-256-CBC) before DB write
  → Org stored in DB
  → Org identity registered on Fabric (RegisterOrg)
  → If Fabric fails → DB row deleted (rollback)

Organisation Login
  POST /api/org/login
  → Rate limited (20 req / 15 min)
  → JWT issued (role: 'org')

Invite Recipient
  POST /api/org/invite
  → generateInviteToken() → HMAC token stored (hash only) → INVITE audit log
  → inviteLink = APP_BASE_URL/accept-invite?token=<raw_token>
  → sendInviteEmail()     → EJS email dispatched via SMTP
  → raw token returned to org in response

Recipient Accepts Invite
  POST /api/recipient/accept-invite
  → validateInviteToken() → HMAC verified, expiry/used checks
  → password_hash set     → markTokenUsed()

Certificate Issuance
  POST /api/org/certificate/issue
  → Recipient upserted if new
  → cert_hash = SHA-256(payload)
  → Private key decrypted in memory
  → signature = ECDSA(cert_hash, decrypted_private_key)
  → StoreCertificate on Fabric (blockchain FIRST)
  → If Fabric fails → abort with 503
  → Certificate row in DB
  → If DB fails after blockchain → log inconsistency, return 500
  → PDF generated → file_path updated
  → QR code generated (encodes verification URL)
  → ISSUE audit log

Public Verification
  GET /api/verify/:cert_hash
  → Rate limited (100 req / 15 min)
  → GetCertificate from Fabric
  → GetOrgPublicKey from Fabric
  → ECDSA signature verified
  → VerificationLog written
  → { valid, issuer, issued_at }

Certificate Revocation
  POST /api/org/certificate/revoke/:hash
  → Ownership check (org_id)
  → RevokeCertificate on Fabric (blockchain FIRST)
  → If Fabric fails → abort with 503
  → is_revoked = true in DB
  → If DB fails after blockchain → log inconsistency, return 500
  → REVOKE audit log

Password Reset
  POST /api/auth/forgot-password
  → Rate limited (20 req / 15 min)
  → Silent on unknown email (no enumeration)
  → SHA-256(token) stored, raw token emailed

  POST /api/auth/reset-password
  → Token validated (hash, expiry, used_at)
  → Password bcrypt-hashed → DB updated
  → Token stamped used_at

Recipient Access
  POST /api/recipient/login     → JWT (role: 'recipient')
  GET  /api/recipient/certificates → all certs with QR URLs
  GET  /api/recipient/certificate/:id → full detail (ownership-checked)
  GET  /api/recipient/certificate/:id/qr → ownership-checked QR
  GET  /api/recipient/profile   → name, email, created_at
  GET  /uploads/<hash>.pdf      → PDF served statically
```

---

## Section 12 — Failure Scenarios

| Scenario | HTTP Status | Behaviour |
|---|---|---|
| Invite token expired | 410 | `Invite token has expired.` |
| Invite token already used | 410 | `Invite token has already been used.` |
| Invalid invite token (HMAC mismatch) | 400 | `Invalid invite token.` |
| Reset token expired | 410 | `Reset token has expired.` |
| Reset token already used | 410 | `Reset token has already been used.` |
| Invalid reset token | 400 | `Invalid or expired reset token.` |
| Certificate not found on blockchain | 200 | `{ valid: false, reason: 'Certificate not found on blockchain.' }` |
| Certificate revoked | 200 | `{ valid: false, reason: 'Certificate has been revoked.' }` |
| Signature verification failed | 200 | `{ valid: false, reason: 'Signature verification failed.' }` |
| Certificate not found in DB | 404 | `Certificate not found.` |
| Blockchain unavailable (Fabric error) | 503 | `Blockchain storage failed: <detail>` or `Blockchain revocation failed: <detail>` |
| DB write fails after blockchain commit | 500 | Logged for reconciliation. Message references `cert_hash` for manual recovery. |
| Org not found / wrong password | 401 | `Invalid email or password.` |
| Org revoked | 403 | `This organisation has been revoked.` |
| Ownership violation | 403 | `Access denied.` |
| Certificate already revoked | 409 | `Certificate is already revoked.` |
| Duplicate org email / msp_id | 409 | `An organisation with this email already exists.` |
| Validation error (Joi) | 422 | `{ success: false, message: 'Validation failed.', errors: [...] }` |
| Rate limit exceeded | 429 | `Too many requests. Please try again later.` |
| Unhandled server error | 500 | Generic message in production; full stack in development. |

---

## Section 13 — Consistency Model

### DB + Blockchain Coordination

The system uses a **compensating transaction pattern** because true distributed transactions across PostgreSQL and Hyperledger Fabric are not possible.

**Write order:** Blockchain is always written **first**. The database is the follower.

**Rationale:** A certificate must never be considered valid without a successful blockchain write. If the DB write fails after blockchain success, the certificate exists on-chain but lacks metadata — this is recoverable. The reverse (DB record with no chain entry) would create a false credential.

### Issuance Flow

1. Generate `cert_hash` + ECDSA signature
2. `StoreCertificate` on Fabric → if fails, abort immediately (503)
3. `certificate.create` in DB → if fails, log `cert_hash` for reconciliation (500)
4. PDF generation and audit log follow only after both succeed

### Revocation Flow

1. `RevokeCertificate` on Fabric → if fails, abort immediately (503)
2. `certificate.update(is_revoked: true)` in DB → if fails, log `cert_hash` for reconciliation (500)
3. Audit log follows only after DB update succeeds

### Onboarding Flow

1. Org row created in DB
2. `RegisterOrg` on Fabric → if fails, DB row is **deleted** (hard rollback)

### Recovery

If a blockchain write succeeds but the corresponding DB write fails:
- The error is logged with the `cert_hash` for manual reconciliation
- The operation returns 500 to the caller with the `cert_hash` reference
- An administrator can reconcile by re-inserting the DB record or marking the on-chain entry

---

## Section 14 — Database Indexing

### Current Indexes

| Model | Index | Type |
|---|---|---|
| Organisation | `email` | Unique |
| Organisation | `msp_id` | Unique |
| Recipient | `email` | Unique |
| Recipient | `invited_by_org_id` | Standard |
| Certificate | `cert_hash` | Unique |
| Certificate | `org_id` | Standard |
| Certificate | `recipient_id` | Standard |
| Certificate | `blockchain_tx_id` | Standard |
| InviteToken | `token_hash` | Unique |
| InviteToken | `org_id` | Standard |
| InviteToken | `recipient_email` | Standard |
| VerificationLog | `certificate_id` | Standard |
| VerificationLog | `verified_at` | Standard |
| AuditLog | `org_id` | Standard |
| AuditLog | `created_at` | Standard |
| PasswordResetToken | `token_hash` | Unique |
| PasswordResetToken | `email` | Standard |

### Recommended Additions

| Model | Index | Reason |
|---|---|---|
| Certificate | `(org_id, issued_at)` | Composite index for the org certificate list query which filters by `org_id` and orders by `issued_at DESC`. Replaces the single `org_id` scan + sort. |
| Certificate | `(org_id, is_revoked)` | Composite index for status-filtered certificate listings per org. |
| Certificate | `(recipient_id, issued_at)` | Composite index for recipient certificate list ordered by date. |

These are additive (non-destructive) and can be applied via `npx prisma migrate dev` after updating `schema.prisma`.

---

## Section 15 — Recipient Lifecycle

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ Org sends   │────▶│ Recipient opens │────▶│ Account activated│
│ invite email│     │ accept-invite   │     │ (password set)   │
└─────────────┘     └─────────────────┘     └──────────────────┘
                                                     │
                                                     ▼
                          ┌───────────────────────────────────────┐
                          │            Recipient Login             │
                          │   POST /api/recipient/login → JWT     │
                          └───────────────────────────────────────┘
                                         │
                    ┌────────────────────┬┴───────────────────┐
                    ▼                    ▼                    ▼
            ┌──────────────┐   ┌────────────────┐   ┌──────────────┐
            │ View certs   │   │ View cert QR   │   │ View profile │
            │ (list/detail)│   │ (scan/share)   │   │              │
            └──────────────┘   └────────────────┘   └──────────────┘
```

**States:**

| State | Condition |
|---|---|
| Invited | `InviteToken` exists, `Recipient.password_hash` is null |
| Active | `password_hash` is set, can log in |
| Certificate holder | Has one or more `Certificate` rows |

A recipient can also be created implicitly during certificate issuance (via `recipient_email`). In that case, the recipient exists in DB without a password and cannot log in until an invite is accepted.

---

## Section 16 — RBAC — Current and Future Design

### Current Roles

| Role | Authentication | Capabilities |
|---|---|---|
| `org` | JWT (`JWT_SECRET`) | Onboard, issue, revoke, invite, view recipients/certs/audit/profile |
| `recipient` | JWT (`RECIPIENT_JWT_SECRET`) | Login, view own certs, view QR, view profile |
| Public (anonymous) | None | Verify a certificate by hash, download PDF |

### Future Roles (Planned)

| Role | Purpose |
|---|---|
| `verifier` | Dedicated verifier accounts with API keys for automated bulk verification. Rate limits relaxed. Verification logs attributed to verifier identity. |
| `admin` | Platform-level administrator. Can manage organisations (activate, revoke, audit), view system-wide metrics, and perform reconciliation of blockchain-DB inconsistencies. |

### Extension Path

1. Add `role` column to a unified `User` table or introduce an `Admin` model
2. Create `requireAdminAuth` middleware
3. Create admin routes under `/api/admin/*`
4. Verifier accounts can be modelled as a `Verifier` table with API key auth

---

## Section 17 — API Response Format

### Success Responses

All controllers return `{ success: true }` with fields spread directly into the root object. The exact shape depends on the endpoint:

**Auth / Login:**
```json
{ "success": true, "token": "<jwt>", "org": { "org_id": "...", "org_name": "...", "email": "..." } }
```

**Single resource (certificate, profile):**
```json
{ "success": true, "certificate": { ... } }
{ "success": true, "profile": { ... } }
```

**Certificate issuance:**
```json
{ "success": true, "certificate_id": "...", "cert_hash": "...", "blockchain_tx_id": "...", "file_path": "...", "qr_code": "..." }
```

**Certificate verification:**
```json
{ "success": true, "valid": true, "cert_hash": "...", "issuer": { "msp_id": "...", "org_name": "..." }, "issued_at": "...", "is_revoked": false }
{ "success": true, "valid": false, "reason": "Certificate has been revoked." }
```

**Paginated lists:**
```json
{ "success": true, "data": [ ... ], "total": 42, "page": 1, "limit": 10 }
```

**Action responses (revoke, invite, accept-invite):**
```json
{ "success": true, "token": "..." }
{ "success": true, "cert_hash": "...", "success": true }
{ "success": true, "message": "..." }
```

### Error Responses

Handled by the global `errorHandler` middleware:

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Certificate not found."
}
```

In development mode, `stack` is included for debugging. In production, 5xx errors return a generic message.

### Validation Errors (Joi)

```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": [
    "\"email\" must be a valid email"
  ]
}
```

---

## Section 18 — Blockchain Failure Handling

### Error Classification

| Error Type | Detection | Response |
|---|---|---|
| Stale connection | `UNAVAILABLE`, `CANCELLED`, `Failed to connect`, `access denied` | Gateway reset + automatic retry (1 attempt) |
| Chaincode rejection | Any other Fabric error | Immediate failure, no retry |
| Network unreachable | Connection timeout | Gateway reset + automatic retry |

### Retry Mechanism

`fabricService.js` implements a single-retry loop for both `submitTransaction` and `evaluateTransaction`:

1. Attempt the Fabric call
2. If a stale connection error is detected → disconnect gateway, reconnect, retry once
3. If the retry also fails → throw with original error message

Non-stale errors (e.g. chaincode logic errors like "certificate already exists") fail immediately without retry.

### HTTP Status Mapping

| Operation | Fabric Outcome | HTTP Status | Notes |
|---|---|---|---|
| Issuance | Fabric call fails | 503 Service Unavailable | No DB record created |
| Revocation | Fabric call fails | 503 Service Unavailable | DB not updated |
| Onboarding | Fabric call fails | 503 Service Unavailable | DB row deleted (rollback) |
| Verification | Fabric call fails | 200 OK | Returns `{ valid: false, reason: '...' }` — errors handled internally, no 503 |

### Trust Guarantee

No certificate is considered valid without a successful blockchain write. The system never creates a DB record for a certificate before the blockchain confirms the write. This ensures that every certificate in the database has a corresponding on-chain entry.

---

## Section 19 — QR Code

### Purpose

Every issued certificate includes a QR code that encodes the public verification URL. Anyone scanning the QR code is directed to the verification endpoint.

### Encoded Data

The QR code encodes a plain URL string:

```
${VERIFICATION_BASE_URL}/api/verify/${cert_hash}
```

Example: `https://bitcert.example.com/api/verify/a1b2c3d4...`

### Generation

- Library: `qrcode` (Node.js)
- Error correction: Level H (30% recovery)
- Output: Base64 data URL (PNG)
- Generated during certificate issuance in `certificate.service.js`

### Usage

- Returned to the issuing org in the issuance response (`qr_code` field)
- Available to recipients via `GET /api/recipient/certificate/:id/qr`
- Recipient certificate list includes `qr_url` (the raw verification URL, not the image)

---

## Section 20 — Seed Script

### Purpose

`scripts/seed.js` re-registers all organisations on the Hyperledger Fabric network. Required after a Fabric network restart, since the ledger state is wiped but the PostgreSQL database retains org records.

### Usage

```bash
npm run seed
```

### Behaviour

1. Connects to the Fabric Gateway
2. Reads all organisations from the database (name, msp_id, public_key)
3. For each org, calls `RegisterOrg(msp_id, public_key)` on the chaincode
4. Errors per org are logged but do not halt the loop (idempotent — safe to re-run)
5. Disconnects the gateway and Prisma client on completion

### Safety

- **Idempotent:** If an org is already registered on Fabric, the chaincode returns an error which is caught and logged. The script continues to the next org.
- **Non-destructive:** Only performs `RegisterOrg` — does not modify or delete any data.
- **Failure isolation:** Individual org failures do not crash the process. Only a top-level error (e.g. gateway connection failure) causes `process.exit(1)`.
