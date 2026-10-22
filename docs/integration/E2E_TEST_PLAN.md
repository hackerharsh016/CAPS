# CAPS — End-to-End System Integration Test Plan

> **Document:** `docs/integration/E2E_TEST_PLAN.md`  
> **Status:** Draft / Proposed for Review  
> **Author:** Senior Integration Architect  
> **Target Release:** Phase 8 Live System Integration  
> **Monorepo Baseline:** `implementation-plan.md`, `TASK_MANIFEST.json`, `docs/integration/INTEGRATION_AUDIT.md`, `tests/e2e/`

---

## 1. Scope, Objectives & Architecture

This document defines the comprehensive end-to-end (E2E) integration test plan for CAPS (Cloud Automated Printing Solution). The goal is to rigorously validate the unified operation of all four independently developed applications:

1. **Customer Web (`apps/customer-web`):** Next.js 14 document upload, print configuration, live quote preview, Razorpay checkout, and live order tracking.
2. **Shop Owner Dashboard (`apps/owner-dashboard`):** Next.js 14 live FIFO intake queue, 1-click print approval, printer status panel, agent pairing management, and telemetry.
3. **Cloud Backend (`apps/cloud-api` & `supabase/`):** Fastify REST API, composite JWT/Device auth, atomic PostgreSQL queue RPCs, Supabase Storage, and Razorpay webhook processing.
4. **Desktop Print Agent (`apps/print-agent`):** Python Win32 daemon, zero-trust pairing, outbound claim lease, PDFium rasterization, silent Win32 spooler dispatch, and zero-retention hard document purge.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               CAPS E2E ACTOR INTERACTION                               │
├────────────────────┬────────────────────┬───────────────────────┬──────────────────────┤
│ 1. Customer Web    │ 2. Owner Dashboard │ 3. Cloud API & DB     │ 4. Desktop Agent     │
├────────────────────┼────────────────────┼───────────────────────┼──────────────────────┤
│ Upload PDF         │                    │ Generate Signed URL   │                      │
│ Configure Settings │                    │ Calculate Auth Quote  │                      │
│ Pay via Razorpay   │                    │ Webhook Verification  │                      │
│                    │ View Intake Queue  │ Realtime Notification │ Realtime Wake-up     │
│                    │ 1-Click Approval   │ Transition to QUEUED  │                      │
│                    │                    │ RPC: claim_next_job   │ Atomic Claim & Lease │
│                    │                    │ Issue Signed Download │ Stream & Verify PDF  │
│                    │                    │                       │ Win32 Silent Spool   │
│ Realtime Stepper   │ Live Status Poll   │ Broadcast Status      │ Poll GetJob() Status │
│ Tracking: DONE     │ Queue: Completed   │ Hard Purge Cloud Doc  │ Hard Purge Local Doc │
└────────────────────┴────────────────────┴───────────────────────┴──────────────────────┘
```

---

## 2. Test Execution Tiers & Environments

Integration testing is executed across three distinct environments with clear escalation gates:

| Tier | Environment | Scope & Fidelity | Data & Service Dependencies | Execution Trigger |
|:---|:---|:---|:---|:---|
| **Tier 1** | **Automated Sandbox** | In-memory unit/mock integration suites across all 4 apps. Fast feedback ($< 60\text{ s}$). | In-memory repositories, `FakeWindowsSpooler`, mock Razorpay client. | CI Pull Request gate (`pnpm test`, `pytest`). |
| **Tier 2** | **Live Local Services** | Fully integrated local containerized stack. Real HTTP calls over loopback. | Local Supabase CLI (PostgreSQL 15 + Storage + Realtime), Fastify on `127.0.0.1:4000`, Next.js on `3000`/`3001`, Python agent on Windows/macOS with Microsoft Print to PDF. | Pre-merge integration checkpoint gate. |
| **Tier 3** | **Physical Hardware Lab** | Physical staging deployment with real Windows workstations and physical printers. | Hosted Supabase project, Razorpay Sandbox API, physical Canon imageRUNNER / HP LaserJet printers via USB/LAN. | Final Phase 8 release sign-off gate. |

---

## 3. Test Fixtures, Personas & Baseline Data

### 3.1 Actor Personas

- **Customer "Rahul" (Standard):**
  - ID: `cust_rahul_001`
  - Account: Authenticated Supabase user (`rahul@example.com`).
  - Workflow: Submits 5-page standard PDF, A4, B&W, double-sided, Pay online.
- **Customer "Priya" (Urgent Priority):**
  - ID: `cust_priya_002`
  - Account: Authenticated Supabase user (`priya@example.com`).
  - Workflow: Submits 1-page urgent document, A4, Color, single-sided, paying 1.5x surge rate for queue jump.
- **Shop Owner "Suresh" (Shop Alpha):**
  - ID: `owner_suresh_001`
  - Shop ID: `00000000-0000-0000-0000-000000000001` (`"QuickPrint Alpha"`)
  - Configured Pricing: B&W A4: ₹2.00/pg (200 paise), Color A4: ₹10.00/pg (1000 paise), Urgent surcharge: +50%.
- **Desktop Agent Instance "Agent-Alpha":**
  - Hostname: `DESKTOP-PRINT-01`
  - OS: Windows 11 Pro 64-bit
  - Bound Printers:
    - Printer 1: `Canon imageRUNNER 2625 PCL6` (B&W, A4/A3, Duplex)
    - Printer 2: `HP Color LaserJet Pro M454` (Color, A4, Duplex)
    - Virtual: `Microsoft Print to PDF` (Sandbox / Fallback)

### 3.2 Document Fixtures

Located at `tests/e2e/fixtures/`:
- `standard_document.pdf`: 4 pages, A4 text/graphics, 240 KB, SHA-256 verified.
- `color_brochure.pdf`: 2 pages, A4 high-res color, 1.8 MB.
- `oversized_drawing.pdf`: 1 page, A3 architecture draft, 4.2 MB.
- `malformed_corrupt.pdf`: 12 KB damaged binary header (for fault-injection).

---

## 4. Multi-Actor End-to-End Test Journeys

---

### Journey 1: Customer Upload $\rightarrow$ Pricing Calculation $\rightarrow$ Order & Payment Capture

**Actors Involved:** Customer Web $\leftrightarrow$ Cloud API $\leftrightarrow$ Supabase Storage $\leftrightarrow$ Razorpay Gateway $\leftrightarrow$ Database.

#### Preconditions
- Customer Rahul logged into Customer Web (`http://localhost:3000`).
- Shop "QuickPrint Alpha" open and operational.

#### Step-by-Step Procedure
1. **Document Drop:** Customer drops `standard_document.pdf` onto dropzone.
2. **Presigned Upload:** Customer Web calls `POST /api/v1/uploads/presigned-url` with document metadata. Cloud API validates size ($\le 50\text{ MB}$) and returns signed URL in `customer-documents` bucket.
3. **S3 Direct Upload:** Browser streams PDF directly to Supabase Storage; calculates client-side SHA-256 hash.
4. **Configuration & Live Quote:** Customer selects: Paper: A4, Color: B&W, Duplex: `duplex_long`, Copies: 2.
   - Customer Web calls `POST /api/v1/quotes/calculate`.
   - Cloud API calculates authoritative pricing:
     $$\text{Total Pages} = 4 \times 2 = 8 \text{ impressions}$$
     $$\text{Price} = 8 \times 200 \text{ paise} = 1600 \text{ paise (₹16.00)}$$
5. **Checkout & Razorpay Modal:** Customer reviews order breakdown and clicks "Proceed to Payment".
   - Customer Web requests `POST /api/v1/payments/razorpay/order`.
   - Cloud API initializes Razorpay order ID `order_test_1001` with amount `1600` paise.
   - Razorpay standard checkout iframe displays; customer inputs test UPI/Card details.
6. **Payment Webhook Capture:**
   - Razorpay emits `payment.captured` webhook to Cloud API (`POST /api/v1/payments/razorpay/webhook`).
   - Cloud API verifies HMAC SHA-256 signature against `RAZORPAY_WEBHOOK_SECRET`.
   - Cloud API idempotently inserts into `payment_events` table and creates `print_jobs` record with status `SUBMITTED`, priority `STANDARD`.

#### Verification Checks & Pass Criteria
- [ ] Database record created in `print_jobs` with `payment_status = 'CAPTURED'` and `status = 'SUBMITTED'`.
- [ ] Database record created in `documents` with valid storage path and SHA-256 hash.
- [ ] Customer Web redirects to live tracking page `/orders/<orderId>/track` showing stepper at "Order Placed / Awaiting Shop Confirmation".

---

### Journey 2: Owner Dashboard Live Queue Intake $\rightarrow$ 1-Click Print Approval

**Actors Involved:** Cloud API $\leftrightarrow$ Supabase Realtime $\leftrightarrow$ Shop Owner Dashboard.

#### Preconditions
- Order from Journey 1 is in `SUBMITTED` state in database.
- Shop Owner Suresh is logged into Owner Dashboard (`http://localhost:3001`) with active WebSocket connection.

#### Step-by-Step Procedure
1. **Realtime Queue Insertion:**
   - Cloud API emits broadcast event `job.created` on channel `caps:shop:00000000-0000-0000-0000-000000000001`.
   - Owner Dashboard's `useQueue` hook receives WebSocket payload and injects Rahul's job into the live queue table with pulsing indicator.
2. **Order Detail Inspection:**
   - Suresh clicks the row to expand details: confirms 4 pages, 2 copies, B&W, double-sided, payment verified (₹16.00 online).
3. **One-Click Approval (`OWNER_CONFIRMED`):**
   - Suresh clicks "Confirm & Print" button.
   - UI immediately debounces the button and applies optimistic state `Approving...`.
   - Dashboard dispatches `POST /api/v1/shops/:shopId/jobs/:jobId/approve`.
   - Cloud API validates owner tenancy, transitions job status to `QUEUED`, sets `approved_at = NOW()`, and broadcasts `job.approved` event.

#### Verification Checks & Pass Criteria
- [ ] Database updates `print_jobs.status` to `QUEUED`.
- [ ] Concurrency check: Rapid double-clicks on "Confirm & Print" result in exactly 1 API call; second call is blocked by UI debounce and backend rejects with `409 Conflict` (Already approved).
- [ ] Owner Dashboard table updates status badge from `Submitted` to `Queued`.

---

### Journey 3: Agent Zero-Trust Pairing $\rightarrow$ Heartbeat $\rightarrow$ Realtime Wake-Up

**Actors Involved:** Shop Owner Dashboard $\leftrightarrow$ Cloud API $\leftrightarrow$ Python Desktop Agent.

#### Preconditions
- Python Print Agent installed on Windows machine but unconfigured (clean state).
- Shop Owner Suresh viewing Owner Dashboard `/printers` page.

#### Step-by-Step Procedure
1. **Pairing Code Generation:**
   - Suresh clicks "Pair New Print Agent". Dashboard calls `POST /api/v1/shops/:shopId/agent-tokens/generate`.
   - Cloud API generates one-time 8-character pairing code `CP-782941` with 10-minute expiry.
2. **Agent Pairing Execution:**
   - Operator launches agent pairing command in PowerShell:
     ```powershell
     caps-agent pair --code CP-782941 --api-url http://127.0.0.1:4000
     ```
   - Agent gathers machine fingerprint, hostname, and OS version; sends `POST /api/v1/agent/pair`.
   - Cloud API verifies code, creates `agent_devices` record, generates device secret `caps_agent_sec_9f4b...`, hashes it with SHA-256 into `device_token_hash`, and returns plaintext secret.
   - Agent writes secret to secure local storage (`%PROGRAMDATA%\CAPS\credentials.json` or Windows DPAPI).
3. **Heartbeat Loop Initialization:**
   - Agent daemon starts and sends `POST /api/v1/agent/heartbeat` with `Authorization: Bearer caps_agent_sec_...` and list of local printers:
     - `Canon imageRUNNER 2625 PCL6` (Status: `IDLE`, Duplex: `True`)
     - `HP Color LaserJet Pro M454` (Status: `IDLE`, Duplex: `True`)
   - Cloud API composite verifier accepts device secret, updates `agent_devices.last_heartbeat_at`, and returns `200 OK`.
4. **Realtime Channel Subscription:**
   - Agent establishes WSS connection to Supabase Realtime / Cloud gateway, subscribing to `caps:shop:00000000-0000-0000-0000-000000000001`.

#### Verification Checks & Pass Criteria
- [ ] Agent appears as **Online** on Owner Dashboard `/printers` within 10 seconds of startup.
- [ ] Agent displays in Windows System Tray with green connected icon.
- [ ] Invalid/tampered agent token returns `401 Unauthorized` without crashing agent process.

---

### Journey 4: Atomic Claim $\rightarrow$ Document Stream $\rightarrow$ Win32 Spooler Dispatch

**Actors Involved:** Python Desktop Agent $\leftrightarrow$ Cloud API $\leftrightarrow$ Win32 Spooler API.

#### Preconditions
- Agent is running and connected (Journey 3).
- Job `e2e-job-001` is in `QUEUED` state (Journey 2).

#### Step-by-Step Procedure
1. **Realtime Wake-Up & Claim Trigger:**
   - Agent receives `job.approved` broadcast on WebSocket channel.
   - Agent immediately interrupts polling sleep and initiates outbound HTTP claim:
     `POST /api/v1/agent/jobs/claim`
     Header: `Authorization: Bearer caps_agent_sec_...`
     Body: `{"device_id": "...", "supported_capabilities": ["bw", "color", "duplex"]}`
2. **Atomic Queue RPC Execution:**
   - Cloud API executes PostgreSQL transactional RPC `claim_next_approved_job`:
     - Checks two-tier priority (any `URGENT` jobs first; then FIFO `STANDARD`).
     - Acquires `FOR UPDATE SKIP LOCKED` row lock.
     - Transitions job to `CLAIMED`.
     - Generates cryptographically random `lease_token` (valid 300 seconds).
     - Returns nested JSON response matching `job-claim-response.schema.json`.
3. **Document Download & SHA-256 Checksum:**
   - Agent extracts `response.job.document_url` (temporary Supabase signed URL).
   - Agent streams PDF file to `%TEMP%\caps\jobs\e2e-job-001\document.pdf`.
   - Agent computes SHA-256 on the fly and verifies it matches `response.job.checksum`.
4. **DEVMODE Settings Mapping & Win32 Spooler Dispatch:**
   - Agent maps job print settings to Win32 `DEVMODE`:
     - `dmCopies = 2`
     - `dmDuplex = DMDUP_VERTICAL` (Duplex Long-Edge)
     - `dmColor = DMCOLOR_MONOCHROME`
     - `dmPaperSize = DMPAPER_A4`
   - Agent calls `win32print.OpenPrinter("Canon imageRUNNER 2625 PCL6")`.
   - Agent calls `StartDocPrinter`, renders pages via PDFium, writes raw spool streams, and calls `EndDocPrinter` without displaying any user dialogs.
   - Spooler assigns Windows Job ID `1042`.

#### Verification Checks & Pass Criteria
- [ ] Cloud API database verifies `print_jobs.status = 'CLAIMED'` and `lease_token` is recorded.
- [ ] No duplicate claims: Simultaneous claim request from second agent device returns `{"claimed": false, "job": null}`.
- [ ] Windows Print Queue shows active spooling job with document name `CAPS_e2e-job-001`.

---

### Journey 5: Spooler Execution Monitoring $\rightarrow$ Status Sync $\rightarrow$ Hard Purge

**Actors Involved:** Desktop Agent $\leftrightarrow$ Win32 Spooler $\leftrightarrow$ Cloud API $\leftrightarrow$ Customer Web $\leftrightarrow$ Owner Dashboard.

#### Preconditions
- Windows Spooler Job `1042` is currently spooling / printing.

#### Step-by-Step Procedure
1. **Spooler Polling Loop:**
   - Agent monitors Windows Spooler every 1000 ms using `win32print.GetJob(handle, 1042, 2)`.
   - As pages are dispatched to hardware engine, Agent posts status updates:
     `POST /api/v1/agent/jobs/status`
     Payload: `{"job_id": "e2e-job-001", "lease_token": "...", "status": "PRINTING", "pages_printed": 2, "total_pages": 4}`
2. **Multi-Client Realtime Status Sync:**
   - Cloud API broadcasts progress event to `caps:job:e2e-job-001` and `caps:shop:00000000...`.
   - Customer Web tracking stepper displays: `Printing page 2 of 4...`.
   - Owner Dashboard displays: `Printing (50%)`.
3. **Physical Eject & Spooler De-allocation:**
   - Physical printer ejects final page. Windows Spooler de-allocates job ID `1042`.
   - Agent detects `JOB_STATUS_PRINTED` (or job absence following active status).
   - Agent sends final status update:
     `POST /api/v1/agent/jobs/status`
     Payload: `{"job_id": "e2e-job-001", "lease_token": "...", "status": "COMPLETED", "pages_printed": 4, "total_pages": 4}`
4. **Desktop Zero-Retention Hard Purge:**
   - Immediately following API call (in a `finally` block), Agent triggers `secure_purge()`:
     - Overwrites `%TEMP%\caps\jobs\e2e-job-001\document.pdf` with zeroes.
     - Unlinks file from filesystem.
     - Verifies `os.path.exists()` returns `False`.
5. **Cloud Storage Hard Purge:**
   - Cloud API receives `COMPLETED` status.
   - Storage service removes document object from Supabase bucket `customer-documents`.
   - Database marks `print_jobs.purged_at = NOW()`.
   - Customer Web tracking stepper transitions to `Completed — Ready for Pickup!`.

#### Verification Checks & Pass Criteria
- [ ] Database records `print_jobs.status = 'COMPLETED'` and `purged_at IS NOT NULL`.
- [ ] Local temp file `%TEMP%\caps\jobs\e2e-job-001\document.pdf` is completely deleted.
- [ ] Supabase Storage object is verified deleted (`404 Not Found` upon download attempt).
- [ ] Customer Web and Owner Dashboard both show completed state in real time.

---

### Journey 6: Two-Tier Priority Queue Jump & Abuse Rate Limiting

**Actors Involved:** Customer Rahul (Standard) $\leftrightarrow$ Customer Priya (Urgent) $\leftrightarrow$ Cloud API $\leftrightarrow$ Desktop Agent.

#### Preconditions
- Rahul's standard job (`job_std_01`) submitted at $T_0$.
- Priya's urgent job (`job_urg_02`) submitted at $T_0 + 30\text{ s}$ with 1.5x price multiplier.
- Both jobs are approved by Owner Suresh (`QUEUED` state).

#### Step-by-Step Procedure
1. **Queue Positioning Check:**
   - Inspect queue state: `job_std_01` created earlier than `job_urg_02`.
2. **Agent Claim Execution:**
   - Agent calls `POST /api/v1/agent/jobs/claim`.
   - Cloud API executes `claim_next_approved_job`:
     $$\text{ORDER BY priority_class DESC (URGENT > STANDARD), created_at ASC}$$
   - RPC selects Priya's job `job_urg_02` first despite later creation time.
3. **Abuse / Rate Limit Trigger Check:**
   - Simulate a script submitting 35 print jobs within 1 hour for Shop Alpha.
   - Cloud API rate limit middleware enforces max 30 jobs/hour per shop/user.
   - 31st job is rejected with `429 Too Many Requests` (`error: RATE_LIMIT_EXCEEDED`).

#### Verification Checks & Pass Criteria
- [ ] Urgent job claims first, ahead of older standard jobs in the queue.
- [ ] Rate limiter protects shop queue from automated spam flooding.

---

### Journey 7: Network Disconnect Reconciliation, Lease Expiry & Idempotency

**Actors Involved:** Desktop Agent $\leftrightarrow$ Cloud API $\leftrightarrow$ Network Simulation.

#### Preconditions
- Job `e2e-job-003` claimed by Agent with 60-second lease token.

#### Step-by-Step Procedure
1. **Network Disruption Injection:**
   - Cut network connectivity to Windows Agent immediately after lease acquisition (before spooler submission).
2. **Lease Expiration & Re-queue:**
   - Cloud API lease reaper runs (or next agent claim checks expired leases).
   - At $T > 60\text{ s}$, lease expires. Job status reverts from `CLAIMED` to `QUEUED`.
3. **Network Recovery & Re-claim:**
   - Network connectivity restored.
   - Agent attempts to send status update with expired lease token.
   - Cloud API rejects update with `409 Conflict: Lease expired`.
   - Agent purges local temp file and re-claims `job_e2e_003` with fresh lease token.
4. **Spooler Deduplication Check:**
   - Agent verifies local SQLite attempt registry to prevent double-spooling the same document.

#### Verification Checks & Pass Criteria
- [ ] Expired lease gracefully returns to queue without manual intervention.
- [ ] Stale agent updates rejected; zero duplicate prints sent to Windows Spooler.

---

## 5. End-to-End Test Execution Commands & Runbooks

### 5.1 Tier 1: Automated In-Memory Regression Suite

Execute the unified test suite across all 4 applications in CI/CD:

```bash
# 1. Run root Turbo test suite (Customer Web, Owner Dashboard, Cloud API, Packages)
pnpm turbo run test

# 2. Run Python Agent Pytest Suite
cd apps/print-agent
source .venv/bin/activate || .venv\Scripts\activate
pytest tests/ -v --tb=short

# 3. Run Monorepo TypeScript E2E Vertical Slice Test
pnpm vitest run tests/e2e/owner-cloud-agent-spooler.test.ts
```

### 5.2 Tier 2: Live Local Services Multi-Process Orchestration

Run all services locally with real databases and network transport:

```bash
# Terminal 1: Start Supabase Local Containers (Postgres, Storage, Auth, Realtime)
supabase start

# Terminal 2: Apply Migrations & Seed Baseline Data
supabase db reset

# Terminal 3: Launch Cloud API Server (Port 4000)
cd apps/cloud-api
pnpm dev

# Terminal 4: Launch Customer Web Next.js (Port 3000)
cd apps/customer-web
pnpm dev

# Terminal 5: Launch Shop Owner Dashboard Next.js (Port 3001)
cd apps/owner-dashboard
pnpm dev

# Terminal 6: Launch Desktop Print Agent (Headless Loopback Mode)
cd apps/print-agent
python src/caps_agent/main.py daemon --api-url http://127.0.0.1:4000
```

### 5.3 Tier 3: Physical Hardware Acceptance Checklist (Windows Staging Lab)

For human-supervised testing on real Windows hardware:

```powershell
# In Windows PowerShell (Administrator):
# 1. Verify physical printer is online and set as default or registered in CAPS
Get-Printer | Format-Table Name, PrinterStatus, PortName

# 2. Start agent with live staging cloud backend
caps-agent.exe daemon --api-url https://api-staging.capsprint.in

# 3. Open Windows Spooler Management Console to visually observe spool events
printmanagement.msc
```

---

## 6. Pass / Fail / Blocked Criteria Matrix

| Gate ID | Verification Stage | Pass Criteria | Fail Criteria | Blocked Condition |
|:---|:---|:---|:---|:---|
| **GATE-01** | **Contract & Schemas** | All 4 apps exchange JSON payloads conforming to `packages/print-contracts/openapi/v1.json` with 0 validation errors. | Any HTTP 400 schema mismatch, missing fields, or casing discrepancy. | None. |
| **GATE-02** | **Authentication** | Customer/Owner Supabase JWTs and Agent device tokens (`caps_agent_sec_*`) authorize correctly. | 401 Unauthorized for valid device token or malformed JWT errors. | Supabase Auth service down. |
| **GATE-03** | **Storage & Presigned URLs** | Customer uploads PDF to bucket; Agent downloads via signed URL with matching SHA-256 hash. | Download URL expired prematurely; checksum mismatch; upload rejected. | Supabase S3 storage container offline. |
| **GATE-04** | **Realtime Wake-Up** | Owner approval event delivers to Windows Agent over WebSocket in $< 500\text{ ms}$. | WebSocket disconnected; agent fails to wake up and falls back to polling. | WebSocket port 443/54321 blocked by firewall. |
| **GATE-05** | **Spooler & Execution** | Document spools silently with correct DEVMODE (A4, duplex, B&W) without GUI popups. | Print dialog pops up; incorrect orientation/duplex; spooler crash. | Non-Windows OS (Linux/macOS) cannot execute Win32 APIs. |
| **GATE-06** | **Document Hard Purge** | Temp PDF deleted and overwritten on Windows disk immediately; cloud object deleted from Supabase. | PDF file remains in `%TEMP%` after print completes or fails. | OS file lock preventing deletion. |
| **GATE-07** | **Physical Hardware** | Real printer feeds paper, prints double-sided with accurate alignment, and ejects final sheet. | Paper jam; blank sheets; toner error; printer hangs. | Physical printer hardware not connected. |

---

## 7. Audit & Hardware Lab Status Sign-Off

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 8 E2E TEST PLAN STATUS SUMMARY                      │
├──────────────────────────────────────┬────────────────┬──────────────────────┤
│ Test Level                           │ Executable Now │ Blocking Dependency  │
├──────────────────────────────────────┼────────────────┼──────────────────────┤
│ Tier 1: Automated Sandbox Mocks      │ YES (Passed)   │ None                 │
│ Tier 2: Live Local Integrated Stack  │ YES (Ready)    │ Completion of CP 8.1 │
│ Tier 3: Physical Hardware Validation │ PENDING LAB    │ Windows + Canon/HP   │
└──────────────────────────────────────┴────────────────┴──────────────────────┘
```

> **Note on Physical Hardware Testing:** As documented in `tests/e2e/SUPERVISED_PHYSICAL_ACCEPTANCE.md`, physical Win32 Spooler and real printer testing requires a supervised physical Windows workstation. Simulated spooler verification (`FakeWindowsSpooler` and Microsoft Print to PDF) validates 100% of the software interface contracts in development and CI environments.
