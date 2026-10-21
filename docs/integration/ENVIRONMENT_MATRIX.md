# CAPS — Environment Configuration Matrix & Audit
## Monorepo Configuration, Secrets & Loader Harmonization

> **Document:** `docs/integration/ENVIRONMENT_MATRIX.md`  
> **Status:** Active Master Reference  
> **Target Release:** CAPS Phase 8 Live Integration  
> **Audited Baseline:** `.env.example`, `apps/cloud-api/src/config/env.ts`, `apps/customer-web/src/lib/supabase.ts`, `apps/owner-dashboard/src/lib/supabase.ts`, `apps/print-agent/src/caps_agent/config.py`  
> **Author:** Senior Software Architect & Integration Engineer  

---

## 1. Executive Summary & Audit Overview

A configuration audit across the four CAPS applications revealed several variable naming discrepancies, missing environment declarations, and unaligned loaders between `.env.example` and the respective runtime parsers.

If a developer copies `.env.example` to `.env` today:
1. **Cloud API will fail to bind or read configuration:**
   - `.env.example` defines `API_HOST`, `API_PORT`, and `API_CORS_ORIGINS`.
   - `apps/cloud-api/src/config/env.ts` looks for `HOST`, `PORT`, and `CORS_ORIGINS`.
   - `.env.example` defines `NEXT_PUBLIC_SUPABASE_URL`, but `cloud-api` looks for `SUPABASE_URL`.
   - `.env.example` defines `NEXT_PUBLIC_RAZORPAY_KEY_ID`, but `cloud-api` looks for `RAZORPAY_KEY_ID`.
   - `SUPABASE_JWT_SECRET` is required by Cloud API for HS256 token verification, but is completely missing from `.env.example`.
2. **Web Clients lack Cloud API Base URL:**
   - Neither `apps/customer-web` nor `apps/owner-dashboard` have a declared `NEXT_PUBLIC_API_URL` consumer in their source code; they currently fall back to hardcoded in-memory adapters.
3. **Agent Configuration is cleanly isolated:**
   - `apps/print-agent/src/caps_agent/config.py` uses prefixed environment variables (`CAPS_AGENT_CLOUD_API_URL`, `CAPS_AGENT_REALTIME_URL`, `CAPS_SHOP_ID`, etc.), which match `.env.example` Section 5.

This document establishes the authoritative environment matrix, classifies all variables by security tier, documents discovered discrepancies, and provides a corrected, unified `.env.example` template.

---

## 2. Cross-Application Environment Variable Matrix

| Variable Name | Required By | Security Scope | Default / Local Development Value | Purpose & Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `customer-web`, `owner-dashboard` | **Public (Browser)** | `http://localhost:54321` | Supabase API Gateway URL for GoTrue Auth, PostgREST, and Realtime WebSocket handshakes. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `customer-web`, `owner-dashboard` | **Public (Browser)** | `eyJhbGciOi...` (Supabase local anon token) | Public anonymous key for client-side queries subject to PostgreSQL RLS policies. |
| `SUPABASE_URL` | `cloud-api` | **Server-Only (Private)** | `http://localhost:54321` | Base URL used by Cloud API to connect to PostgreSQL / PostgREST / GoTrue. |
| `SUPABASE_SERVICE_ROLE_KEY` | `cloud-api` | **Server-Only (Secret)** | `eyJhbGciOi...` (Supabase service role secret) | **High Security:** Bypasses RLS for trusted backend operations (document cleanup, system audits). **NEVER expose to web or agent.** |
| `SUPABASE_JWT_SECRET` | `cloud-api` | **Server-Only (Secret)** | `super-secret-jwt-token-with-at-least-32-characters` | HMAC-SHA256 secret used by Supabase GoTrue to sign auth tokens. Used by Cloud API's `SupabaseJwtVerifier` to authenticate user requests. |
| `SUPABASE_STORAGE_BUCKET` | `cloud-api` | **Server-Only (Private)** | `caps-private-documents` | Private Supabase Storage bucket for encrypted customer print documents. |
| `HOST` / `API_HOST` | `cloud-api` | **Server-Only (Private)** | `0.0.0.0` | IP interface on which the Fastify HTTP server listens. |
| `PORT` / `API_PORT` | `cloud-api` | **Server-Only (Private)** | `4000` | Port on which Cloud API listens. |
| `NODE_ENV` | All Node apps | **Server / Build** | `development` | Runtime environment: `development`, `production`, or `test`. |
| `CORS_ORIGINS` / `API_CORS_ORIGINS` | `cloud-api` | **Server-Only (Private)** | `http://localhost:3000,http://localhost:3001` | Comma-separated list of allowed web origins for cross-origin resource sharing. |
| `NEXT_PUBLIC_API_URL` | `customer-web`, `owner-dashboard` | **Public (Browser)** | `http://localhost:4000/api/v1` | Public Cloud API base endpoint for customer and owner frontend client requests. |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `customer-web` | **Public (Browser)** | `rzp_test_YourKeyId` | Public key ID used to open the client-side Razorpay payment checkout modal. |
| `RAZORPAY_KEY_ID` | `cloud-api` | **Server-Only (Secret)** | `rzp_test_YourKeyId` | Server-side Razorpay key ID for server-to-server order creation. |
| `RAZORPAY_KEY_SECRET` | `cloud-api` | **Server-Only (Secret)** | `your_razorpay_secret` | Server-side Razorpay secret for authenticating order creation and payment capture. |
| `RAZORPAY_WEBHOOK_SECRET` | `cloud-api` | **Server-Only (Secret)** | `your_webhook_secret` | Secret used to verify the HMAC-SHA256 signature on incoming payment event webhooks. |
| `FIREBASE_PROJECT_ID` | `cloud-api` | **Server-Only (Private)** | `caps-printing-solution` | Firebase project identifier for Firebase Cloud Messaging (FCM). |
| `FIREBASE_CLIENT_EMAIL` | `cloud-api` | **Server-Only (Secret)** | `firebase-adminsdk@...` | Service account email for authenticating outbound push notifications to customers and owners. |
| `FIREBASE_PRIVATE_KEY` | `cloud-api` | **Server-Only (Secret)** | `"-----BEGIN PRIVATE KEY-----\n..."` | RSA private key for Firebase Admin SDK. |
| `CAPS_AGENT_CLOUD_API_URL` | `print-agent` | **Agent-Scoped** | `http://localhost:4000/api/v1` | Cloud API base URL used by the desktop agent for heartbeats, claims, and status updates. |
| `CAPS_AGENT_REALTIME_URL` | `print-agent` | **Agent-Scoped** | `ws://localhost:54321/realtime/v1/websocket` | Supabase Realtime WebSocket URL for wake-up event listening. |
| `CAPS_SHOP_ID` | `print-agent` | **Agent-Scoped (Persistent)** | `00000000-0000-0000-0000-000000000001` | UUID of the print shop to which the desktop agent is paired. |
| `CAPS_DEVICE_ID` | `print-agent` | **Agent-Scoped (Persistent)** | `device-uuid-here` | Unique UUID of the registered Windows agent device. |
| `CAPS_DEVICE_TOKEN` | `print-agent` | **Agent-Scoped (DPAPI Secret)** | `caps_agent_sec_<hex>` | Secret device bearer token returned upon pairing. Stored in Windows DPAPI / secure storage. |
| `CAPS_AGENT_LOCAL_BIND` | `print-agent` | **Agent-Scoped (Loopback)** | `127.0.0.1` | **Security Constraint:** Binds strictly to `127.0.0.1` / loopback. Never exposed to LAN. |
| `CAPS_AGENT_LOCAL_PORT` | `print-agent` | **Agent-Scoped (Loopback)** | `9099` | Port for local loopback tray diagnostics HTTP API. |
| `CAPS_AGENT_TEMP_DIR` | `print-agent` | **Agent-Scoped (Local Disk)** | `%TEMP%\caps_spool` | Temporary directory for streaming and rendering PDFs. Purged immediately after spooler acceptance. |
| `CAPS_AGENT_DB_PATH` | `print-agent` | **Agent-Scoped (Local Disk)** | `%LOCALAPPDATA%\caps_agent\state.db` | Local SQLite database file for crash recovery and in-flight attempt tracking. |
| `CAPS_AGENT_CLEANUP_MAX_AGE_SEC` | `print-agent` | **Agent-Scoped** | `3600` | Maximum age in seconds before orphaned temporary spooler files are purged. |
| `CAPS_LOG_LEVEL` | `print-agent` | **Agent-Scoped** | `INFO` | Logging verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |

---

## 3. Security Classification & Invariant Rules

### Tier 1: Public Browser-Safe Variables (`NEXT_PUBLIC_*`)
- **Allowed In:** `apps/customer-web`, `apps/owner-dashboard`.
- **Constraint:** Inlined into client-side JavaScript bundles by the Next.js compiler. Anyone inspecting network tabs or page source can view these values.
- **Rule:** **NEVER** place database passwords, service-role keys, Razorpay secrets, or Firebase private keys in `NEXT_PUBLIC_*` variables.
- **Enforcement:** Verified by `assertNoServerSecrets()` in both frontend applications:
  ```typescript
  if (env && ('SUPABASE_SERVICE_ROLE_KEY' in env || 'SERVICE_ROLE_KEY' in env)) {
    throw new Error('SECURITY VIOLATION: SUPABASE_SERVICE_ROLE_KEY is present in client runtime environment!');
  }
  ```

### Tier 2: Server-Only Backend Secrets (Cloud API)
- **Allowed In:** `apps/cloud-api`.
- **Constraint:** Must only be loaded in server processes. Kept behind firewall/container boundaries.
- **Rule:** Required for server-to-server operations (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `RAZORPAY_KEY_SECRET`, `FIREBASE_PRIVATE_KEY`).

### Tier 3: Desktop Agent Device Credentials (Windows DPAPI)
- **Allowed In:** `apps/print-agent`.
- **Constraint:** Stored on the shop's local Windows machine.
- **Rule:** Must **never** receive or store the master Supabase service-role key or database credentials. The agent receives only a device-scoped token (`caps_agent_sec_...`) bound strictly to that shop's ID. In production, credentials must be encrypted via Windows Data Protection API (DPAPI) via `CryptProtectData`.

---

## 4. Identified Configuration Gaps & Harmonization Tasks

```text
┌──────────────────────────────────────┬──────────────────────────────────────┐
│ .env.example (Existing)              │ apps/cloud-api/src/config/env.ts     │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ API_HOST=0.0.0.0                     │ HOST: z.string().default('0.0.0.0')  │
│ API_PORT=4000                        │ PORT: z.coerce.number().default(4000)│
│ API_CORS_ORIGINS=http://...          │ CORS_ORIGINS: z.string()             │
│ NEXT_PUBLIC_SUPABASE_URL=...         │ SUPABASE_URL: z.string().url()       │
│ NEXT_PUBLIC_RAZORPAY_KEY_ID=...      │ RAZORPAY_KEY_ID: z.string()          │
│ [MISSING: SUPABASE_JWT_SECRET]       │ SUPABASE_JWT_SECRET: z.string()      │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### Remediation Steps:
1. Update `apps/cloud-api/src/config/env.ts` to accept **both** formats gracefully:
   - `HOST = rawEnv.HOST || rawEnv.API_HOST || '0.0.0.0'`
   - `PORT = rawEnv.PORT || rawEnv.API_PORT || 4000`
   - `CORS_ORIGINS = rawEnv.CORS_ORIGINS || rawEnv.API_CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001'`
   - `SUPABASE_URL = rawEnv.SUPABASE_URL || rawEnv.NEXT_PUBLIC_SUPABASE_URL`
   - `RAZORPAY_KEY_ID = rawEnv.RAZORPAY_KEY_ID || rawEnv.NEXT_PUBLIC_RAZORPAY_KEY_ID`
2. Add `SUPABASE_JWT_SECRET` to `.env.example` with clear documentation.
3. Add `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1` to `.env.example` and wire it into `packages/api-client`.

---

## 5. Corrected, Authoritative `.env.example` Template

```bash
# ==============================================================================
# CAPS (Cloud Automated Printing Solution) — Authoritative Environment Template
# Copy this file to .env at monorepo root or configure in your deployment pipeline.
# DO NOT COMMIT REAL CREDENTIALS OR SECRETS TO SOURCE CONTROL.
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Supabase Infrastructure (PostgreSQL, Auth GoTrue, Private Storage, Realtime)
# ------------------------------------------------------------------------------
# Browser-safe public URL and anonymous key (customer-web, owner-dashboard)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-anon-token-here

# Server-only Supabase Connection (cloud-api)
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-service-role-key-here

# GoTrue JWT Signing Secret (Used by cloud-api to verify HMAC-SHA256 bearer tokens)
# In local Supabase CLI, this is typically "super-secret-jwt-token-with-at-least-32-characters"
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters

# Supabase S3-Compatible Private Document Storage Bucket
SUPABASE_STORAGE_BUCKET=caps-private-documents

# ------------------------------------------------------------------------------
# 2. Fastify Cloud Backend API (apps/cloud-api)
# ------------------------------------------------------------------------------
NODE_ENV=development
HOST=0.0.0.0
PORT=4000
API_HOST=0.0.0.0
API_PORT=4000

# Permitted CORS Origins (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
API_CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Public URL consumed by customer-web and owner-dashboard
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1

# Rate limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
LOG_LEVEL=info

# ------------------------------------------------------------------------------
# 3. Payment Gateway — Razorpay
# ------------------------------------------------------------------------------
# Public Key ID (Customer web checkout modal)
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere

# Server-only Secret and Webhook Signature (cloud-api only)
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret_here

# ------------------------------------------------------------------------------
# 4. Push Notifications — Firebase Cloud Messaging (FCM)
# ------------------------------------------------------------------------------
FIREBASE_PROJECT_ID=caps-printing-solution
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@caps-printing-solution.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"

# ------------------------------------------------------------------------------
# 5. Desktop Print Agent Configuration (apps/print-agent)
# ------------------------------------------------------------------------------
# Outbound Cloud API base URL
CAPS_AGENT_CLOUD_API_URL=http://localhost:4000/api/v1

# Outbound Supabase Realtime WebSocket URL
CAPS_AGENT_REALTIME_URL=ws://localhost:54321/realtime/v1/websocket

# Persistent Agent Device Credentials (Generated during pairing; stored in DPAPI)
CAPS_SHOP_ID=00000000-0000-0000-0000-000000000001
CAPS_DEVICE_ID=
CAPS_DEVICE_TOKEN=

# Loopback-only diagnostic interface (Mandatory: 127.0.0.1)
CAPS_AGENT_LOCAL_BIND=127.0.0.1
CAPS_AGENT_LOCAL_PORT=9099

# File system storage paths
# On Windows, defaults to %TEMP%\caps_spool and %LOCALAPPDATA%\caps_agent\state.db
CAPS_AGENT_TEMP_DIR=
CAPS_AGENT_DB_PATH=
CAPS_AGENT_CLEANUP_MAX_AGE_SEC=3600
CAPS_LOG_LEVEL=INFO
```
