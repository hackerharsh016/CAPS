# CAPS — Environment Variable Matrix

> **Document:** `docs/development/environment-matrix.md`  
> **Status:** Active Reference  
> **Template Reference:** `.env.example`

---

## 1. Security Classification Guidelines

All environment configuration keys in CAPS fall into one of three strict security tiers:

1. **Client-Safe (`PUBLIC`):** Keys exposed to browsers in client-side bundles (prefixed with `NEXT_PUBLIC_`). These must **never** contain private credentials, service roles, or write secrets.
2. **Server-Private (`SERVER_SECRET`):** Keys utilized exclusively by trusted server processes (`apps/cloud-api`, database workers). Access is restricted to production secret managers or local `.env`.
3. **Agent-Local (`DEVICE_SECRET`):** Keys stored securely on the shop PC (via Windows DPAPI or environment variables). These identify a paired physical shop agent.

---

## 2. Environment Configuration Matrix

| Variable Name | Target App / Service | Classification | Required In | Description / Constraints |
|---|---|:---:|:---:|---|
| `NODE_ENV` | `cloud-api`, Web Apps | `SERVER_SECRET` | All | Runtime mode (`development`, `production`, `test`). |
| `PORT` | `cloud-api` | `SERVER_SECRET` | Dev / Prod | HTTP listening port for Fastify server (default `4000`). |
| `HOST` | `cloud-api` | `SERVER_SECRET` | Dev / Prod | Binding interface (e.g., `0.0.0.0` or `127.0.0.1`). |
| `CORS_ORIGINS` | `cloud-api` | `SERVER_SECRET` | Dev / Prod | Comma-separated allowed web origins (e.g., `http://localhost:3000,http://localhost:3001`). |
| `SUPABASE_URL` | All Apps | `PUBLIC` | All | Base HTTPS URL for managed Supabase instance. |
| `SUPABASE_ANON_KEY` | `customer-web`, `owner-dashboard` | `PUBLIC` | Web Frontends | Public Supabase anon key for client-side queries protected by RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | `cloud-api` | **`SERVER_SECRET`** | Cloud Backend | Privileged master key bypassing RLS. **NEVER** expose to web clients or agent binaries. |
| `SUPABASE_JWT_SECRET` | `cloud-api` | **`SERVER_SECRET`** | Cloud Backend | Secret key used to verify Supabase Auth user JWT tokens. |
| `RAZORPAY_KEY_ID` | `cloud-api`, Web Apps | `PUBLIC` | Payment Flow | Public identifier for Razorpay Checkout modal initialization. |
| `RAZORPAY_KEY_SECRET` | `cloud-api` | **`SERVER_SECRET`** | Cloud Backend | Secret key for Razorpay server API requests and refund processing. |
| `RAZORPAY_WEBHOOK_SECRET` | `cloud-api` | **`SERVER_SECRET`** | Cloud Backend | HMAC secret used to verify incoming payment webhook signatures. |
| `FCM_PROJECT_ID` | `cloud-api` | `SERVER_SECRET` | Push Alerts | Google Firebase project ID for push notification dispatch. |
| `FCM_CLIENT_EMAIL` | `cloud-api` | `SERVER_SECRET` | Push Alerts | Service account email for FCM v1 HTTP API. |
| `FCM_PRIVATE_KEY` | `cloud-api` | **`SERVER_SECRET`** | Push Alerts | PEM-encoded RSA private key for Firebase push service account. |
| `CAPS_AGENT_CLOUD_API_URL` | `print-agent` | `DEVICE_SECRET` | Desktop Agent | HTTPS base URL of Cloud API (`https://api.caps.example.com` or `http://127.0.0.1:4000`). |
| `CAPS_AGENT_REALTIME_URL` | `print-agent` | `DEVICE_SECRET` | Desktop Agent | WebSocket URL for Supabase Realtime wake-up signals (`wss://...`). |
| `CAPS_AGENT_DEVICE_TOKEN` | `print-agent` | **`DEVICE_SECRET`** | Desktop Agent | Bearer credential issued during shop pairing. Stored via DPAPI. |
| `CAPS_AGENT_SHOP_ID` | `print-agent` | `DEVICE_SECRET` | Desktop Agent | UUID of the registered print shop paired to this desktop. |
| `CAPS_AGENT_LOCAL_BIND` | `print-agent` | `DEVICE_SECRET` | Desktop Agent | Local diagnostics interface. **STRICTLY ENFORCED:** `127.0.0.1` only. |
| `CAPS_AGENT_LOCAL_PORT` | `print-agent` | `DEVICE_SECRET` | Desktop Agent | Port for local loopback health checks (default `7890`, range `1024..65535`). |
| `CAPS_AGENT_TEMP_DIR` | `print-agent` | `DEVICE_SECRET` | Desktop Agent | Restricted local directory for transient download storage before spooling. |
