# CAPS — Module Ownership & Work Partition Map

> **Document:** `docs/development/ownership-map.md`  
> **Status:** Active Reference  
> **Source Baseline:** `implementation-plan.md` §9.2

---

## 1. Engineering Work Partition (Four-Developer Model)

To maintain architectural cohesion and avoid merge conflicts across the monorepo, work is partitioned across four primary tracks. Each track has an assigned domain owner and secondary reviewer.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                              CAPS MONOREPO                             │
├─────────────────┬──────────────────┬─────────────────┬─────────────────┤
│   Track 1:      │   Track 2:       │   Track 3:      │   Track 4:      │
│  Customer Web   │  Owner Dashboard │  Cloud API & DB │  Desktop Agent  │
├─────────────────┼──────────────────┼─────────────────┼─────────────────┤
│ apps/           │ apps/            │ apps/cloud-api  │ apps/           │
│ customer-web    │ owner-dashboard  │ supabase/       │ print-agent     │
│ packages/ui     │ packages/ui      │ packages/types  │ packages/       │
│ packages/       │ packages/        │ packages/       │ print-contracts │
│ api-client      │ api-client       │ validation      │ infra/windows   │
└─────────────────┴──────────────────┴─────────────────┴─────────────────┘
```

---

## 2. Detailed Track Responsibilities

### Developer 1: Customer Web Experience
- **Primary Workspaces:** `apps/customer-web/`, `packages/ui/`, `packages/api-client/`.
- **Core Modules:**
  - Customer registration, login, and profile.
  - Shop discovery (map/list views, capability filters, distance, open/closed status).
  - Document upload dropzone, client-side format checks, upload progress.
  - Print configuration form (paper size, color mode, duplex, copies, page range, binding).
  - Live quote preview and order review screens.
  - Customer live queue tracking page and real-time status updates.
- **Integration Obligations:**
  - Contract validation tests against Cloud API OpenAPI specifications.
  - E2E journey tests covering upload $\rightarrow$ configuration $\rightarrow$ quote $\rightarrow$ tracking.

### Developer 2: Shop Owner Operations Dashboard
- **Primary Workspaces:** `apps/owner-dashboard/`, `packages/ui/`, `packages/api-client/`.
- **Core Modules:**
  - Shop owner registration, shop profile, and per-service pricing configuration.
  - Live FIFO queue view with real-time job intake.
  - One-click print confirmation workflow (`OWNER_CONFIRMED`).
  - Printer configuration and role assignment (B&W, color, large format).
  - Desktop agent connectivity and heartbeat health status panel.
  - Sales, operational, and revenue reports (daily/weekly/monthly revenue, peak hours).
- **Integration Obligations:**
  - Concurrency testing on one-tap approvals (idempotent double-click protection).
  - Realtime queue synchronization and reconnection tests.

### Developer 3: Cloud API, Database & Payment Core
- **Primary Workspaces:** `apps/cloud-api/`, `supabase/`, `packages/types/`, `packages/validation/`, `packages/print-contracts/`.
- **Core Modules:**
  - Supabase PostgreSQL schema, migrations, and Row-Level Security (RLS) policies.
  - Fastify server core, JWT verification, role-based access control.
  - Authoritative pricing calculation engine (non-negative integer paise).
  - Razorpay order creation, signed webhook verification, and replay protection.
  - Transactional two-tier priority queue RPC (`claim_next_approved_job`).
  - Agent device pairing, authentication, and lease management.
  - Push notification dispatch (FCM) and automated document purge worker.
- **Integration Obligations:**
  - Transactional consistency tests (atomic claims, lease expiry, idempotent webhooks).
  - Multi-tenant data isolation and RLS policy verification suites.

### Developer 4: Windows Desktop Print Agent & OS Integration
- **Primary Workspaces:** `apps/print-agent/`, `packages/print-contracts/`, `infra/windows-installer/`.
- **Core Modules:**
  - Windows installed printer discovery and DEVMODE capability enumeration.
  - PDF rendering engine (PDFium/MuPDF) with page range slicing.
  - Native print settings mapper (mapping JSON to Win32 printer parameters).
  - Silent spooler submission via Win32 Print Spooler APIs (zero print dialogs).
  - Spooler status monitoring and hardware error classification.
  - Local SQLite attempt state recovery and immediate temp file purge.
  - Windows system tray UI, loopback diagnostics (`127.0.0.1`), and PyInstaller packaging.
- **Integration Obligations:**
  - Cross-language JSON Schema conformance tests with Cloud API.
  - Physical printer hardware compatibility matrix validation on real Windows devices.

---

## 3. Review & Approval Protocol

1. **Shared Package Changes:** Any modification to `packages/types`, `packages/validation`, or `packages/print-contracts` requires review from at least one backend engineer (Track 3) and one frontend/desktop engineer (Track 1, 2, or 4).
2. **Security & Financial Changes:** Pricing logic, payment webhook verification, and agent pairing logic require strict two-party review before merging.
