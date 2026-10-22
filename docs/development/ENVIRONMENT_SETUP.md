# CAPS — Environment Configuration & Real API Integration Guide

> **Document:** `docs/development/ENVIRONMENT_SETUP.md`  
> **Status:** Active Reference  
> **Scope:** Monorepo root, Customer Web, Shop Owner Dashboard, Cloud API, and Windows Print Agent

---

## 1. Environment File Structure

The CAPS monorepo enforces a strict multi-tier environment architecture. Each tier isolates public client-safe parameters from privileged server secrets.

```text
caps/
│
├── .env.example                          # Root environment template (Tracked in Git)
├── .env                                  # Root local environment overrides (Git-ignored)
│
├── apps/
│   ├── customer-web/
│   │   ├── .env.example                  # Browser-safe public template (Tracked in Git)
│   │   └── .env.local                    # Customer Web local config (Git-ignored)
│   │
│   ├── owner-dashboard/
│   │   ├── .env.example                  # Owner UI public template (Tracked in Git)
│   │   └── .env.local                    # Owner Dashboard local config (Git-ignored)
│   │
│   ├── cloud-api/
│   │   ├── .env.example                  # Fastify backend server template (Tracked in Git)
│   │   └── .env                          # Cloud API local credentials (Git-ignored)
│   │
│   └── print-agent/
│       ├── .env.example                  # Desktop agent template (Tracked in Git)
│       └── .env                          # Print agent local configuration (Git-ignored)
│
└── .gitignore                            # Excludes all real .env and .env.local files
```

### Loading Precedence & Rules
1. **Next.js Applications (`customer-web` & `owner-dashboard`):** Automatically load `.env.local` at startup. Only variables prefixed with `NEXT_PUBLIC_` are exposed to the client bundle. Privileged secrets (such as `SUPABASE_SERVICE_ROLE_KEY` or `RAZORPAY_KEY_SECRET`) are strictly forbidden and trigger an immediate runtime security error if present.
2. **Cloud API (`cloud-api`):** Loads `apps/cloud-api/.env` via Node's native `process.loadEnvFile` in `tryLoadLocalEnv()`. Validated strictly using Zod (`validateEnv`).
3. **Print Agent (`print-agent`):** Loads `apps/print-agent/.env` (or ambient OS environment variables) through Python's `load_config()`. Enforces strict loopback binding on `127.0.0.1` for local diagnostics.

---

## 2. Complete Environment Variable Catalog

| Variable Name | Consuming App(s) | Public / Secret | Purpose | Default / Local Value |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | All | Public | Execution runtime mode (`development`, `production`, `test`) | `development` |
| `NEXT_PUBLIC_API_URL` | `customer-web`, `owner-dashboard` | Public | Base HTTP endpoint for CAPS Cloud API | `http://localhost:4000` |
| `NEXT_PUBLIC_SUPABASE_URL` | `customer-web`, `owner-dashboard` | Public | Public HTTPS endpoint for Supabase project | `http://localhost:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `customer-web`, `owner-dashboard` | Public | Anonymous client token with RLS enforcement | Supabase Anon Key |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | `customer-web` | Public | Razorpay Checkout SDK public Key ID | `rzp_test_...` |
| `HOST` / `API_HOST` | `cloud-api` | Public | Network interface binding for Fastify HTTP server | `0.0.0.0` |
| `PORT` / `API_PORT` | `cloud-api` | Public | Fastify HTTP listening port | `4000` |
| `LOG_LEVEL` | `cloud-api` | Public | Fastify/Pino log severity level | `info` |
| `CORS_ORIGINS` / `API_CORS_ORIGINS` | `cloud-api` | Public | Comma-separated allowed HTTP origins | `http://localhost:3000,http://localhost:3001` |
| `SUPABASE_URL` | `cloud-api` | Public / Internal | Supabase API endpoint for server-side operations | `http://localhost:54321` |
| `SUPABASE_SERVICE_ROLE_KEY` | `cloud-api` | **SECRET** | Privileged admin key (bypasses RLS for DB and storage) | Supabase Service Role Key |
| `SUPABASE_JWT_SECRET` | `cloud-api` | **SECRET** | Secret used to verify customer and owner Bearer JWTs | Min 32 characters |
| `SUPABASE_STORAGE_BUCKET` | `cloud-api` | Public / Internal | Private bucket name for uploaded PDF documents | `customer-documents` |
| `DATABASE_URL` | `cloud-api` | **SECRET** (Optional) | Direct PostgreSQL connection string | `postgresql://...` |
| `RAZORPAY_KEY_ID` | `cloud-api` | Public / Secret | Razorpay API Key ID for order creation | `rzp_test_...` |
| `RAZORPAY_KEY_SECRET` | `cloud-api` | **SECRET** | Razorpay API Key Secret for order creation | Razorpay Secret |
| `RAZORPAY_WEBHOOK_SECRET` | `cloud-api` | **SECRET** | HMAC SHA-256 signature secret for `payment.captured` | Razorpay Webhook Secret |
| `FIREBASE_PROJECT_ID` | `cloud-api` | Public | Google Cloud / Firebase project identifier | `caps-printing-solution` |
| `FIREBASE_CLIENT_EMAIL` | `cloud-api` | Public | Service account email for FCM push notifications | Service Account Email |
| `FIREBASE_PRIVATE_KEY` | `cloud-api` | **SECRET** | RSA private key PEM for Firebase Admin SDK | PEM Private Key |
| `CAPS_AGENT_CLOUD_API_URL` | `print-agent` | Public | Target Cloud API endpoint (must end in `/api/v1`) | `http://127.0.0.1:4000/api/v1` |
| `CAPS_AGENT_REALTIME_URL` | `print-agent` | Public | Supabase Realtime WebSocket URL | `ws://127.0.0.1:54321/realtime/v1/websocket` |
| `CAPS_AGENT_LOCAL_BIND` | `print-agent` | Public | Local diagnostic server binding (MUST be loopback) | `127.0.0.1` |
| `CAPS_AGENT_LOCAL_PORT` | `print-agent` | Public | Local diagnostic server port (1024–65535) | `9099` |
| `CAPS_LOG_LEVEL` | `print-agent` | Public | Agent console logging verbosity | `INFO` |
| `CAPS_AGENT_TEMP_DIR` | `print-agent` | Public (Optional) | Override temp directory for post-print spool files | `%TEMP%\caps_spool` |
| `CAPS_AGENT_DB_PATH` | `print-agent` | Public (Optional) | Override local SQLite attempt database path | `%LOCALAPPDATA%\caps_agent\state.db` |
| `CAPS_AGENT_CLEANUP_MAX_AGE_SEC`| `print-agent` | Public | Orphan file retention ceiling in seconds | `3600` |
| `CAPS_SHOP_ID` | `print-agent` | Secret (Optional) | Pre-configured paired shop UUID | Machine pairing |
| `CAPS_DEVICE_ID` | `print-agent` | Secret (Optional) | Pre-configured paired machine UUID | Machine pairing |
| `CAPS_DEVICE_TOKEN` | `print-agent` | **SECRET** (Optional) | Pre-configured HMAC device authentication token | Machine pairing |

---

## 3. Where to Obtain External Service Credentials

### 3.1 Supabase (Staging & Production)
1. Navigate to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Open your project, then navigate to **Project Settings** -> **API**:
   - **Project URL:** Copy into `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`.
   - **Project API Keys -> `anon` / `public`:** Copy into `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **Project API Keys -> `service_role` (secret):** Copy into `SUPABASE_SERVICE_ROLE_KEY` in `apps/cloud-api/.env`. **NEVER** place this key in frontend or agent environment files.
   - **JWT Settings -> JWT Secret:** Copy into `SUPABASE_JWT_SECRET` in `apps/cloud-api/.env`.
3. Open **Storage** in the sidebar:
   - Ensure the bucket `customer-documents` exists and is marked **Private**.

### 3.2 Razorpay Payment Gateway (Test Mode)
1. Log in to the [Razorpay Dashboard](https://dashboard.razorpay.com/).
2. Toggle the dashboard header switch to **Test Mode**.
3. Navigate to **Account & Settings** -> **API Keys**:
   - Generate or view test keys.
   - Copy **Key ID** (`rzp_test_...`) to `NEXT_PUBLIC_RAZORPAY_KEY_ID` (in `apps/customer-web/.env.local`) and `RAZORPAY_KEY_ID` (in `apps/cloud-api/.env`).
   - Copy **Key Secret** to `RAZORPAY_KEY_SECRET` in `apps/cloud-api/.env`.
4. Navigate to **Account & Settings** -> **Webhooks**:
   - Click **Add New Webhook**.
   - URL: `https://api.yourdomain.com/api/v1/payments/razorpay/webhook` (or your ngrok URL for local webhook testing).
   - Secret: Enter a strong random secret and copy it into `RAZORPAY_WEBHOOK_SECRET` in `apps/cloud-api/.env`.
   - Active Events: Select `payment.captured` and `payment.failed`.

### 3.3 Firebase Cloud Messaging (FCM)
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Select your project and navigate to **Project Settings** -> **Service accounts**.
3. Click **Generate new private key**.
4. From the downloaded JSON file:
   - `project_id` $\rightarrow$ `FIREBASE_PROJECT_ID`
   - `client_email` $\rightarrow$ `FIREBASE_CLIENT_EMAIL`
   - `private_key` $\rightarrow$ `FIREBASE_PRIVATE_KEY` (ensure `\n` linebreaks are preserved inside double quotes).

### 3.4 Windows Print Agent Pairing
1. Machine credentials (`CAPS_SHOP_ID`, `CAPS_DEVICE_ID`, `CAPS_DEVICE_TOKEN`) do **not** need to be manually typed.
2. The recommended flow is:
   - Start the Print Agent.
   - The Print Agent displays a pairing prompt with an OTP or listens on loopback `127.0.0.1:9099`.
   - The Shop Owner navigates to `http://localhost:3001/settings` -> **Pair Print Agent**.
   - Upon pairing approval, the Cloud API issues a signed device token that the Windows Print Agent securely stores locally in Windows DPAPI / protected storage.

---

## 4. Local Development vs. Staging Differences

| Configuration Parameter | Local Development | Staging / Production |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | `production` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | `https://api.staging.capsprint.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `http://localhost:54321` | `https://<proj-id>.supabase.co` |
| `SUPABASE_URL` | `http://localhost:54321` | `https://<proj-id>.supabase.co` |
| `CAPS_AGENT_CLOUD_API_URL` | `http://127.0.0.1:4000/api/v1` | `https://api.staging.capsprint.com/api/v1` |
| `CAPS_AGENT_REALTIME_URL` | `ws://127.0.0.1:54321/realtime/v1/websocket` | `wss://<proj-id>.supabase.co/realtime/v1/websocket` |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | `https://app.capsprint.com,https://owner.capsprint.com` |
| `RAZORPAY_KEY_ID` | `rzp_test_...` (Test mode) | `rzp_test_...` (Staging) / `rzp_live_...` (Production) |

---

## 5. Startup Commands & Verification Sequence

Execute the following commands from the repository root:

### Step 5.1: Start Cloud API Backend
```bash
# Terminal 1: Launch Fastify Cloud API (Port 4000)
pnpm --filter @caps/cloud-api dev
```
*Health Check:* Open `http://localhost:4000/health` in your browser. It should return `{"status":"ok"}`.

### Step 5.2: Start Customer Web Application
```bash
# Terminal 2: Launch Customer Web Portal (Port 3000)
pnpm --filter @caps/customer-web dev
```
*Verification:* Open `http://localhost:3000`. Navigate to `/shops` to verify connection to Cloud API shop discovery.

### Step 5.3: Start Shop Owner Dashboard
```bash
# Terminal 3: Launch Owner Dashboard (Port 3001)
pnpm --filter @caps/owner-dashboard dev
```
*Verification:* Open `http://localhost:3001`. Navigate to `/printers` to verify telemetry panels and queue table.

### Step 5.4: Start Windows Desktop Print Agent
```powershell
# Terminal 4: Launch Python Desktop Agent (Windows PowerShell)
cd apps/print-agent
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = "src"
python src/caps_agent/main.py
```
*Verification:* Open `http://127.0.0.1:9099/health` to confirm the local loopback diagnostic server is responsive.

---

## 6. Common Errors & Troubleshooting

### Error: `SECURITY VIOLATION: SUPABASE_SERVICE_ROLE_KEY is present in client runtime environment`
- **Cause:** `SUPABASE_SERVICE_ROLE_KEY` was accidentally placed in `apps/customer-web/.env.local` or `apps/owner-dashboard/.env.local`.
- **Fix:** Remove `SUPABASE_SERVICE_ROLE_KEY` from all frontend `.env.local` files. It belongs solely in `apps/cloud-api/.env`.

### Error: `ConfigurationError: Security violation: local_diagnostics_host '0.0.0.0' is forbidden`
- **Cause:** `CAPS_AGENT_LOCAL_BIND` was set to `0.0.0.0` in the print agent.
- **Fix:** Set `CAPS_AGENT_LOCAL_BIND=127.0.0.1`. The local diagnostics server must only listen on loopback for Windows workstation security.

### Error: `[CAPS Cloud API] Environment validation failed: - SUPABASE_URL: Invalid url`
- **Cause:** `SUPABASE_URL` in `apps/cloud-api/.env` is malformed or missing the protocol prefix.
- **Fix:** Ensure `SUPABASE_URL` starts with `http://` or `https://` (e.g. `http://localhost:54321` or `https://xyz.supabase.co`).

### Error: `Razorpay Webhook Signature Verification Failed (400)`
- **Cause:** The `RAZORPAY_WEBHOOK_SECRET` in `apps/cloud-api/.env` does not match the secret entered in the Razorpay Webhook Dashboard.
- **Fix:** Update `RAZORPAY_WEBHOOK_SECRET` with the exact string configured in Razorpay.

---

## 7. Safe Placeholder Replacement Procedure

1. Copy `.env.example` to the local environment file:
   ```bash
   cp apps/cloud-api/.env.example apps/cloud-api/.env
   cp apps/customer-web/.env.example apps/customer-web/.env.local
   cp apps/owner-dashboard/.env.example apps/owner-dashboard/.env.local
   cp apps/print-agent/.env.example apps/print-agent/.env
   ```
2. Edit each local file with real development/staging keys.
3. Verify that Git ignores the real files:
   ```bash
   git status
   ```
   **Invariant:** Only `.env.example` files must appear in git status. If any `.env` or `.env.local` file appears as untracked or modified, do not commit before checking `.gitignore`.
