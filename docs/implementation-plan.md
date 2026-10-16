# CAPS — Master Implementation Plan

> **Status:** Architecture baseline locked for CAPS MVP  
> **Document:** `implementation-plan.md`  
> **Version:** 1.0  
> **Date:** 2026-10-16  
> **Product:** Cloud Automated Printing Solution with User-Side Configuration (CAPS)  
> **Source of requirements:** `MINI_PROJECT_I_CAPS_SRS.pdf` (2026–27 Mini-Project-I SRS, sections 1–10)  
> **Purpose:** Single authoritative implementation blueprint for repository organization, module boundaries, integrations, build/test/release pipelines, and technical sequencing.

## 0. Architecture decision and scope

**Locked implementation direction:** One **modular monorepo** containing **four independently deployable applications**, reusable TypeScript packages, versioned Supabase schema/migrations, infrastructure, documentation, and cross-application tests.

The four applications are:
1. `apps/customer-web` — customer experience, Next.js / TypeScript.
2. `apps/owner-dashboard` — shop management and one-click confirmation, Next.js / TypeScript.
3. `apps/cloud-api` — trusted orchestration and integration API, Node.js / TypeScript / Fastify.
4. `apps/print-agent` — installed Windows-side background agent, Python, Windows printing APIs, packaged as a signed installer.

Supabase provides managed PostgreSQL, Auth, private object Storage, and Realtime. Its migrations live at repository root under `supabase/`; it is **not** a fifth custom application. Separate release/deployment processes do not require separate source repositories.

**Boundaries:** The cloud owns identity, authorization, payments, pricing, storage, queue orchestration, auditing, and status fan-out. The Windows agent owns local printer discovery, file rendering, print parameter mapping, Windows spooler submission, monitoring, and local cleanup. Physical printers are never exposed to the public internet. A cloud-triggered wake-up is not permission to print: the authenticated agent must claim an eligible job through the trusted API.

**MVP scope from SRS:** customer onboarding and discovery; upload and print configuration; pricing; Urgent/Flexible queues; online payment and optionally enabled pay-at-counter; queue/status tracking; shop owner's one-tap print confirmation; authenticated Windows agent; private document retention; basic shop reports and notifications. **CAPS OS unattended kiosk mode is a future extension**, not enabled by default for MVP. For initial vertical-slice validation, deliberately reduce scope to PDF, one shop, one printer, one job at a time, and a sandbox payment or explicit authorized test path; expand to the complete MVP once this is reliable.

### 0.1 Locked vs. not-yet-finalized

**Locked:** monorepo; application and domain boundaries; TypeScript web/cloud stack; Python Windows agent; Supabase data plane; server-enforced permissions and payment gating; transactional queue claiming; shared language-neutral agent contract; GitHub Actions CI/CD; phased vertical-slice execution.

**Chosen implementation defaults (can change via ADR):** Next.js App Router, Fastify, pnpm + Turborepo, Zod, generated OpenAPI/JSON Schema contracts, pytest/Ruff, PyInstaller with Inno Setup, Vercel for frontend, hosted Node runtime for API, Razorpay for payments, FCM for push notifications. These are architecture decisions, not SRS-mandated brands/frameworks.

**Requires validation before production:** real-device driver behavior (color, duplex, A3/Legal, rendering), job completion semantics on each printer, temporary-file/spool privacy guarantees, document conversion pipeline, payment settlement and tax rules, offline semantics, device identity and key storage, local service installation mode, printer capability discovery, ETA model, and policy for physical binding/lamination.

---

## 1. Technology stack and ownership

| Layer | Recommended technology | Responsibility | Distribution |
|---|---|---|---|
| Customer | Next.js App Router, TypeScript, React, Tailwind, TanStack Query where helpful | Discovery, file upload, configuration, quote preview, checkout, tracking | Independent web deployment (e.g., Vercel) |
| Shop owner | Next.js, TypeScript, React, Tailwind | Queue, single-click authorization, printers, shop pricing, sales | Independent web deployment |
| Cloud API | Node.js LTS, TypeScript, Fastify, Zod, OpenAPI | Authoritative pricing, job/payment states, access controls, queue atomicity, pairing, signed download authorizations | Independently deployed Node service |
| Persistence | Supabase PostgreSQL, RLS, migrations, SQL RPCs | Multi-tenant transactional data and eligibility enforcement | Managed Supabase |
| Identity | Supabase Auth | Customer/shop-user identities; agent pairing is distinct | Managed Supabase + server controls |
| Documents | Private Supabase Storage | Encrypted-at-rest private object lifecycle | Managed Supabase |
| Realtime | Supabase Realtime over WSS | Signals and view updates; never a job reservation | Managed Supabase |
| Payments | Razorpay + server-verified webhooks | Orders, payment verification, replay resistance, reconciliation | External service |
| Notifications | FCM / web push as applicable | Customer/owner lifecycle messaging | External service |
| Windows agent | Python 3.x, pywin32, PDFium or MuPDF-compatible renderer, optional FastAPI loopback diagnostics | Printer management, rendering, submission, monitoring, local cleanup | Per-shop Windows installation |
| Local durability | SQLite (agent state), Windows-protected credentials, protected temporary storage | Restart recovery, unacknowledged events, lease/attempt metadata | On Windows PC |
| Desktop packaging | PyInstaller, Inno Setup (or equivalent), Authenticode signing | Build, installer, startup registration, updates | Signed Windows installer |
| Tooling | pnpm workspaces, Turborepo, ESLint, Prettier, TypeScript, Ruff, pytest, GitHub Actions | Repo automation | CI/CD |
| Testing | Vitest, API integration tests, Playwright, pytest and real-printer test matrix | Layer and journey verification | CI + controlled pilot |

**Avoid initially:** Kubernetes, Kafka, separately deployed microservices, a second queue database, an agent-exposed public HTTP server, cloud-side raw spooler data, and autonomous unattended printing. Add new infrastructure only when demonstrated bottlenecks or requirements justify it.

---

## 2. Complete proposed monorepo structure

```text
caps/
├── apps/
│   ├── customer-web/               # Next.js customer app
│   ├── owner-dashboard/            # Next.js owner app
│   ├── cloud-api/                  # Fastify cloud orchestration backend
│   └── print-agent/                # Python Windows-side agent
│
├── packages/
│   ├── ui/                         # Shared presentational React components
│   ├── types/                      # Shared TS domain types
│   ├── validation/                 # Zod schemas for web/API
│   ├── api-client/                 # Typed frontend API calls
│   ├── print-contracts/            # OpenAPI + JSON Schema contracts for TS AND Python
│   └── config/                     # Shared lint/TS settings
│
├── supabase/
│   ├── migrations/                 # Incremental, versioned SQL
│   ├── seeds/                      # Local-only/sample data
│   ├── functions/                  # Optional narrowly scoped Edge Functions
│   ├── tests/                      # SQL integration + RLS tests
│   └── config.toml
│
├── infra/
│   ├── docker/                     # Local API dependencies and integration test setup
│   ├── deployment/                 # Web/API hosting config and runbooks
│   └── windows-installer/          # Installer artwork/config/signing metadata
│
├── tests/
│   ├── e2e/                        # Cross-application user journeys
│   ├── integration/                # API/DB/agent contract tests
│   └── fixtures/                   # Non-sensitive PDF test corpus
│
├── docs/
│   ├── architecture/               # C4 diagrams, sequence flows, state machine
│   ├── api/                        # Auth, OpenAPI, request examples
│   ├── decisions/                  # Architecture Decision Records (ADRs)
│   ├── development/                # Local setup and contribution guides
│   ├── deployment/                 # Runbooks and recovery instructions
│   └── security/                   # Threat model, document handling, permissions
│
├── scripts/
│   ├── bootstrap/                  # Machine initialization
│   └── dev/                        # Start local components
│
├── .github/
│   ├── workflows/                  # CI/CD
│   ├── CODEOWNERS
│   └── pull_request_template.md
├── .env.example
├── .gitignore
├── .editorconfig
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
├── implementation-plan.md
└── README.md
```

### 2.1 Repository operating rules

- **One Git history, multiple build artifacts:** `customer-web`, `owner-dashboard`, `cloud-api`, and `print-agent` each have separate version tags/releases and environment configuration.
- **TypeScript shares packages; Python consumes contracts:** do not attempt direct imports of TypeScript entities into Python. Publish/generate compatible Pydantic models from stable JSON Schema/OpenAPI, or validate received JSON against language-neutral schemas.
- **No cross-app source imports:** an app may import `packages/*` but not reach into another app's `src/` tree.
- **One owner per domain:** privileged pricing belongs to Cloud API, priority queue claims to DB/API, device printing to agent, and UI logic to apps.
- **Deployment isolation:** frontend releases must not implicitly update every installed print agent; API breaking changes require backwards-compatible negotiation and a controlled agent rollout.
- **Configuration isolation:** `.env.example` contains names only; production secrets are injected by managed secret stores. Never check in signing keys, admin keys, customer files, payment secrets, or machine device keys.

### 2.2 Workspace bootstrap example

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/customer-web"
  - "apps/owner-dashboard"
  - "apps/cloud-api"
  - "packages/*"
```

`apps/print-agent` is managed with Python tooling, not pnpm. Root scripts may *invoke* Python/PowerShell but must not misrepresent it as a Node package.

---

## 3. Customer web application structure

```text
apps/customer-web/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── (customer)/
│   │   │   ├── shops/page.tsx
│   │   │   ├── shops/[shopId]/page.tsx
│   │   │   ├── print/new/page.tsx
│   │   │   ├── jobs/[jobId]/page.tsx
│   │   │   ├── orders/page.tsx
│   │   │   └── profile/page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── features/
│   │   ├── auth/
│   │   ├── shop-discovery/
│   │   ├── document-upload/
│   │   ├── print-settings/
│   │   ├── pricing/
│   │   ├── checkout/
│   │   ├── queue-tracking/
│   │   └── notifications/
│   ├── components/
│   │   ├── layout/
│   │   └── common/
│   ├── hooks/
│   └── lib/
│       ├── api.ts                   # Authenticated, typed API client
│       └── supabase.ts              # Browser-safe Supabase client
├── public/
├── tests/
├── package.json
├── next.config.ts
└── tsconfig.json
```

**Feature-level example:**

```text
src/features/print-settings/
├── components/
│   ├── PrintSettingsForm.tsx
│   ├── PaperSizeSelector.tsx
│   ├── ColorModeSelector.tsx
│   ├── DuplexSelector.tsx
│   ├── CopiesInput.tsx
│   └── PageRangeInput.tsx
├── hooks/usePrintSettings.ts
├── schemas/printSettingsSchema.ts
└── index.ts
```

**Rules:**
- Route files route/render; feature packages contain feature-specific components and state.
- Validate settings on client for UX *and again on server* for authorization and accuracy.
- Call `POST /api/v1/quotes` for authoritative price; instant local previews may be optimistic but never determine payment amount.
- Upload directly to a private object bucket using tightly scoped, short-lived permissions negotiated with API; finalize only after file metadata, size, and content validation.
- A customer only reads their own orders/files through verified authorization (RLS is defense-in-depth, not a substitute for server checks).
- Queue and ETA widgets consume server-computed values and realtime change signals; perform reconciliation reads on reconnect.
- Keep customer workflow accessible, mobile-first, with explicit printer capability restrictions prior to checkout.

---

## 4. Shop-owner dashboard structure

```text
apps/owner-dashboard/
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   └── (dashboard)/
│   │       ├── layout.tsx
│   │       ├── page.tsx
│   │       ├── queue/page.tsx
│   │       ├── printers/page.tsx
│   │       ├── pricing/page.tsx
│   │       ├── orders/page.tsx
│   │       ├── reports/page.tsx
│   │       └── settings/page.tsx
│   ├── features/
│   │   ├── shop-management/
│   │   ├── live-queue/
│   │   ├── print-confirmation/
│   │   ├── printer-management/
│   │   ├── pricing-management/
│   │   ├── revenue-analytics/
│   │   └── agent-monitoring/
│   ├── components/
│   ├── hooks/
│   └── lib/
├── package.json
└── next.config.ts
```

**Owner flow:** read the authorized shop queue → examine next job's validated settings/payment state → press **Print** once → send approval command to Cloud API → API checks role, shop, ordering, and eligible state → agent receives signal and claims that job from API → dashboard follows status updates.

The owner dashboard **must not** send jobs directly to any printer or access the agent on its LAN. Multiple shop staff, duplicate clicks, reconnects, and stale views must all converge on a single authorized print attempt. Printer assignment views show agent-discovered printer capabilities and online state. Unsupported binding/lamination requests must be presented as separately fulfilled manual work, unless an actual supported finisher exists.

---

## 5. Cloud API — central business system

### 5.1 Folder tree

```text
apps/cloud-api/
├── src/
│   ├── main.ts                      # Process entrypoint / graceful shutdown
│   ├── app.ts                       # Fastify server construction
│   ├── config/
│   │   ├── env.ts                   # Validated environment variables
│   │   └── constants.ts
│   ├── plugins/
│   │   ├── auth.ts                  # JWT verification + roles
│   │   ├── database.ts              # Database access
│   │   └── error-handler.ts
│   ├── modules/
│   │   ├── users/
│   │   ├── shops/
│   │   ├── printers/
│   │   ├── documents/
│   │   ├── print-jobs/
│   │   ├── pricing/
│   │   ├── payments/
│   │   ├── queue/
│   │   ├── agents/
│   │   ├── notifications/
│   │   └── analytics/
│   ├── integrations/
│   │   ├── supabase/
│   │   ├── razorpay/
│   │   └── firebase/
│   ├── common/
│   │   ├── errors/
│   │   ├── middleware/
│   │   ├── security/
│   │   └── utils/
│   └── jobs/
│       ├── document-cleanup.job.ts
│       └── stale-lease-recovery.job.ts
├── tests/
├── package.json
└── tsconfig.json
```

Every nontrivial domain module follows a consistent structure:

```text
src/modules/print-jobs/
├── print-jobs.routes.ts             # HTTP registration + auth hooks
├── print-jobs.controller.ts         # Request/response adapter
├── print-jobs.service.ts            # Business operations / transitions
├── print-jobs.repository.ts         # SQL/Supabase persistence
├── print-jobs.schema.ts             # Zod contracts
├── print-jobs.types.ts              # Local domain types
└── __tests__/
    └── print-jobs.service.test.ts
```

Small modules may consolidate route/controller files to avoid useless boilerplate. Keep business policies out of route handlers and frontend components.

### 5.2 Module ownership

| Module | Responsibilities and invariants |
|---|---|
| `users` | Roles, profiles, verified auth claims; deny cross-role actions |
| `shops` | Shop ownership, location, open state, settings, pricing policy references |
| `printers` | Registered printer identity, capability snapshots, assignment, online state |
| `documents` | Upload intent, MIME/content validation, size limits, private storage key, temporary download, conversion, expiry |
| `print-jobs` | Job creation, canonical immutable setting snapshot, status state machine, metadata retention, cancellation |
| `pricing` | Authoritative paper/duplex/color/pages/copies/urgency calculation, quote expiration and signature/ID |
| `payments` | Razorpay order creation, webhook authentication, reconciliation, replay protection, refund state |
| `queue` | Per-shop/per-printer prioritization, Urgent/Flexible FIFO, atomic claim, active leases, effective positions/ETA |
| `agents` | Secure device pairing, agent authentication, shop scoping, heartbeat, software version, signed work acquisition |
| `notifications` | Outbox-based lifecycle events and retryable push dispatch |
| `analytics` | Sales and operational summaries from completed, eligible records |

### 5.3 Required transaction boundaries

1. **Payment verified → queued:** handle webhook idempotently; update payment and print-job eligibility exactly once within a transaction.
2. **Owner approval → ready for agent:** verify owner/shop, eligible job, printer capability, and queue head; protect against repeated approvals.
3. **Agent claim:** atomically assign an eligible unclaimed job to the authenticated paired agent, using a lease and attempt ID; never rely on 'SELECT then UPDATE' without concurrency control.
4. **Status progression:** accept only valid transitions from the owner of an active attempt; append a `job_events` audit row and emit the downstream event.
5. **Timeout/recovery:** re-evaluate the actual submission state before authorizing another print attempt. If physical outcome is uncertain, surface `unknown/requires_review` and avoid blind reprinting.

### 5.4 API versioning and responses

- Prefix all public APIs with `/api/v1/`.
- Generate an OpenAPI document in `packages/print-contracts/openapi/` from code contracts (or use it as a single reviewed source and generate language bindings).
- Consistent validation errors: `{ "error": { "code": "...", "message": "...", "request_id": "..." } }`.
- Requests that create orders or trigger external effects take an `Idempotency-Key` or deterministic server idempotency key.
- Agent payloads declare a contract version; retain backward compatibility for installed supported agent versions.
- Supabase public anon/publishable keys are not privileged secrets, but service-role tokens are server-only and must never be embedded in agent binary or web code.

### 5.5 Suggested API endpoints (proposed concrete design)

| Method | Endpoint | Consumer | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/documents/uploads` | Customer | Create restricted upload intent |
| `POST` | `/api/v1/documents/{id}/finalize` | Customer | Verify upload, parse, authorize conversion |
| `GET` | `/api/v1/shops` | Customer | Discover available shops |
| `GET` | `/api/v1/shops/{id}` | Customer | Services, capability and price configuration |
| `GET` | `/api/v1/shops/{id}/queue` | Authorized role | Shop-scoped queue/ETA view (redacted for customer) |
| `POST` | `/api/v1/quotes` | Customer | Server-priced estimate, availability and expiration |
| `POST` | `/api/v1/print-jobs` | Customer | Create pending order from quote and document |
| `GET` | `/api/v1/print-jobs/{id}` | Customer/owner | Role-scoped order and status |
| `POST` | `/api/v1/payments/orders` | Customer | Create payment provider order |
| `POST` | `/api/v1/webhooks/razorpay` | Razorpay | Verify signature and payment transition; idempotent |
| `POST` | `/api/v1/print-jobs/{id}/approve` | Owner | Approve eligible next job for print |
| `POST` | `/api/v1/agents/pair` | Agent | Redeem limited pairing code / establish device identity |
| `POST` | `/api/v1/agents/heartbeat` | Agent | Alive/version/status/capability signal |
| `POST` | `/api/v1/agents/jobs/claim` | Agent | Atomically claim next authorized job |
| `POST` | `/api/v1/agents/jobs/{id}/status` | Agent | Attempt-bound print state report |
| `GET` | `/api/v1/agents/config` | Agent | Obtain scoped device/printer assignments |
| `GET` | `/api/v1/owner/reports` | Owner | Shop sales and operations reporting |

**Additional implementation endpoints to include as features mature:** agent lease renewal, attempt reconciliation, agent printer capability sync, request cancellation, job audit history, authorized signed download URL issue, device unlink/revoke, payment reconciliation, and admin intervention endpoints. These remain internal design extensions of the suggested API list.

**Authorization principle:** customer can only access own documents/job status; owner can act only within their shop; agent can only claim jobs for the paired shop and authorized printer. Use server-side permission checks and SQL RLS where appropriate; avoid exposing document object paths via unrestricted tables, analytics responses, or event payloads.

---

## 6. Windows Print Agent — dedicated architecture

### 6.1 Python source structure

```text
apps/print-agent/
├── src/
│   └── caps_agent/
│       ├── __init__.py
│       ├── main.py                      # Agent process boot
│       ├── config.py                    # Config and secure paths
│       ├── api/
│       │   ├── server.py                # Optional localhost-only diagnostics
│       │   ├── routes.py
│       │   └── schemas.py
│       ├── auth/
│       │   ├── pairing.py              # Shop/device pairing
│       │   ├── credentials.py          # Windows-protected credential storage
│       │   └── token_manager.py        # Rotation/refresh
│       ├── cloud/
│       │   ├── api_client.py           # HTTPS/auth/retry
│       │   ├── realtime_client.py      # WSS signal and reconnect
│       │   ├── job_client.py           # Claim/renew/report/reconcile
│       │   └── status_sync.py          # Durable outbound event delivery
│       ├── jobs/
│       │   ├── dispatcher.py           # Per-printer serialized execution
│       │   ├── executor.py             # Attempt coordination
│       │   ├── state_machine.py        # Allowed transitions
│       │   └── recovery.py             # Crash/offline reconciliation
│       ├── printing/
│       │   ├── engine.py               # Public internal printing boundary
│       │   ├── printer_discovery.py     # Installed Windows devices
│       │   ├── capabilities.py         # Features, media, color, duplex
│       │   ├── pdf_renderer.py         # Page-range/rendering implementation
│       │   ├── settings_mapper.py      # Job JSON -> validated Windows settings
│       │   ├── windows_spooler.py      # pywin32/native submission
│       │   └── spooler_monitor.py      # Observed state + timeouts
│       ├── storage/
│       │   ├── temp_files.py           # Restricted temp artifacts
│       │   ├── local_state.py          # SQLite attempt/event store
│       │   └── cleanup.py             # Time-bound cleanup/recovery
│       ├── tray/
│       │   ├── tray_app.py
│       │   └── tray_menu.py
│       └── utils/
│           └── logging.py             # Metadata-only structured logs
├── tests/
│   ├── unit/
│   ├── integration/
│   └── hardware/                       # Opt-in real-printer tests
├── scripts/
│   ├── build.ps1
│   └── run-dev.ps1
├── packaging/
│   ├── agent.spec                      # PyInstaller
│   └── installer.iss                   # Inno Setup
├── pyproject.toml
├── requirements.lock
└── README.md
```

### 6.2 Stable internal printing interface

```python
from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class PrintSettings:
    paper_size: str
    color_mode: str
    duplex: bool
    copies: int
    page_range: str
    orientation: str

@dataclass(frozen=True)
class PrintResult:
    accepted: bool
    spooler_job_id: int | None
    error: str | None = None

class PrintEngine:
    def print_document(
        self,
        pdf_path: Path,
        printer_name: str,
        settings: PrintSettings,
    ) -> PrintResult:
        """Submit print work; acceptance is NOT proof of physical completion."""
        raise NotImplementedError
```

`PrintEngine` is an interface/protocol boundary, **not** the final implementation. `engine.py` calls `pdf_renderer`, `settings_mapper`, and `windows_spooler`; controller/network layers never call `win32print` directly. Actual rendering may require page rasters or appropriate Windows graphics output; pywin32 alone does not universally and silently print raw PDF byte streams. Test driver DEVMODE support and fallbacks on real equipment before claiming feature parity.

### 6.3 Agent lifecycle

1. Install signed package; start background worker and optional tray UI. Choose Windows service vs user-session startup after validating user-context printer access and Windows restrictions.
2. Pair device to a shop using a short-lived code authorized by shop owner. Persist device-scoped credentials protected by Windows facilities; support revoke and rotation.
3. Discover installed printers and report accurate capabilities; shop assigns roles/printers in owner dashboard.
4. Maintain outbound HTTPS/WSS connection. Reconnect with exponential backoff and periodically reconcile; realtime only notifies that work may be available.
5. Receive approved job signal; use authenticated API to atomically claim next eligible job. Record attempt ID and lease locally before any side effect.
6. Download through a short-lived scoped URL after authorization. Validate checksum, allowed file type, size, PDF validity and trusted page count; use protected temporary path.
7. Validate support for paper size, duplex, copies, orientation, page range and color. Reject unsupported combinations with actionable error rather than silently altering a paid specification.
8. Render selected pages and submit to the selected Windows printer without a dialog. Record spooler job ID and submission outcome.
9. Observe spooler states where supported; send durable status events, retries, and heartbeat; distinguish `accepted_by_spooler`, `printing`, `completed`, `failed`, and `unknown` where available.
10. Remove temporary source/render intermediates promptly and on error; enforce crash-recovery cleanup. Separately document limits of controlling Windows spool files and printer firmware persistence.
11. On restart, reconcile previously submitted attempts against spooler history if available. Never blindly reprint an uncertain previously submitted attempt.

### 6.4 FastAPI policy

FastAPI is **optional**, for `127.0.0.1` diagnostics (`GET /health`, `GET /printers`, `GET /status`) and development/test tools. It must not form a cloud-to-printer ingress, must never listen on `0.0.0.0`, and must enforce authentication/CSRF and carefully controlled browser origins if any state-changing routes are exposed. The main agent functions without any HTTP server.

### 6.5 Agent state and reliability rules

- **Per-printer execution lock** to avoid unsafe interleaving; bounded concurrency only after real-device testing.
- **Agent attempt IDs and cloud lease IDs** to connect Windows spooler events with API claims.
- **Durable SQLite outbound event queue** for status reports missed during network outages.
- **Downloaded-and-authorized offline continuation** allowed; no new unapproved work during disconnection.
- **Unknown outcome is not retryable by default**; human intervention or reliable printer-specific evidence is required.
- **Operational security:** no raw files or document contents in logs, telemetry, error traces, or analytics; restrict temp dir permissions and rotate logs.
- **Production installer:** build on Windows CI, bundle runtime/dependencies, add signed release channel, provide clean uninstall/startup/revocation procedures. PyInstaller bundles Python bytecode and is not a source secrecy/security boundary by itself.

---

## 7. Supabase database and migrations

### 7.1 Folder tree

```text
supabase/
├── migrations/
│   ├── 001_create_users.sql
│   ├── 002_create_shops.sql
│   ├── 003_create_printers.sql
│   ├── 004_create_print_jobs.sql
│   ├── 005_create_payments.sql
│   ├── 006_create_agent_sessions.sql
│   ├── 007_create_job_attempts.sql
│   ├── 008_create_job_events.sql
│   ├── 009_create_rls_policies.sql
│   └── 010_create_queue_functions.sql
├── seeds/demo_data.sql
├── tests/
│   ├── queue_priority.test.sql
│   └── shop_isolation.test.sql
├── functions/                        # Only if chosen for narrow serverless work
└── config.toml
```

**Note:** In execution, prefer the Supabase CLI's timestamped migration filenames (`YYYYMMDDHHMMSS_description.sql`) so migration ordering and tooling remain compatible; numeric names above describe the intended creation sequence.

### 7.2 Logical tables and recommended additions

| Table | Key data | Security/business purpose |
|---|---|---|
| `users` (or `profiles`) | `id` references `auth.users`, role, name, phone, timestamp | Customer / owner / admin identity |
| `shops` | owner ID, name, address/geolocation, opening status, pricing JSON/config | Tenant and commercial configuration |
| `printers` | shop, agent/device, Windows printer identity, capabilities, status, role | Local printer routing and policy |
| `print_jobs` | job ID, shop/customer, storage object key, settings snapshot, tier, totals, state, `enqueued_at`, `document_expires_at` | Immutable paid work unit and queue ordering |
| `payments` | job, amount/currency, gateway order/payment IDs, verified state, method | Financial eligibility and reconciliation |
| `agent_sessions` | shop/device, version, heartbeat, token reference, session status | Connected device observability |
| `agent_devices` *(addition)* | shop ID, stable device ID, public key/credential reference, revoked flag | Pairing and scoped identity |
| `job_attempts` *(addition)* | job/printer/agent IDs, lease, attempt state, spooler ID, timestamps | Recovery without duplicate physical output |
| `job_events` *(addition)* | job ID, actor, from/to states, time, safe metadata | Audit and troubleshooting without document contents |
| `outbox_events` *(recommended)* | event type, aggregate, retries, delivered timestamp | Durable notifications and synchronization |

Use integer minor units for payments (`amount_paise`) or precise fixed `numeric`, not binary floating point. Persist a server-verifiable quote/price snapshot so changes in shop pricing do not retrospectively change accepted orders. Store **private object keys**, not publicly accessible document URLs.

### 7.3 Queue semantics

Urgent jobs are ahead of all queued Flexible jobs but **never preempt a job already executing**; FIFO is preserved inside each tier. Effective order follows `(priority_rank, enqueued_at, stable_tiebreaker)` within each shop/printer capacity domain. Queue position is derived, never a primary ordering source.

Illustrative *read-only* next-job query:

```sql
SELECT id
FROM print_jobs
WHERE shop_id = $1 AND status = 'queued'
ORDER BY
  CASE priority_tier WHEN 'urgent' THEN 0 ELSE 1 END,
  enqueued_at ASC,
  id ASC
LIMIT 1;
```

**Never use this query directly for competing agent claims.** Implement a privileged transactional database function (e.g., `claim_next_approved_job`) with authenticated shop and device checks, eligibility/payment verification, serialization/row locking (`FOR UPDATE SKIP LOCKED` where appropriate), lease issuance, attempt insertion, and idempotency. The API invokes the function with trusted server credentials after checking the caller; clients never call privileged RPCs directly. Enforce a maximum one-active-attempt constraint per job and a per-printer execution policy.

### 7.4 State machines

**Order lifecycle:** `draft` → `pending_payment` → `queued` → `approved` → `claimed` → `downloading` → `submitted` → `printing` → `completed`; alternate terminal states `failed`, `cancelled`, `expired`, or `unknown/requires_review` depending on evidence. These proposed sub-states expand the SRS's compact set (`pending_payment`, `queued`, `printing`, `completed`, `failed`, `cancelled`) and should be documented in the schema and API contracts before implementation.

**Payment lifecycle:** `initiated` → `verified`/`failed`; separate refund/reconciliation states. An unverified client callback cannot mark a job paid. An explicitly enabled pay-at-counter policy is a separate authorization path, with collection status shown and audited.

**Privacy:** store documents in a private bucket; scheduled deletion upon outcome or retention window (whichever policy requires), plus a sweeper for missed jobs/failed operations. Deletion must not remove audit metadata required for disputes. Document visibility remains minimal, and product language must not claim certified erasure of inaccessible printer memory or OS spool artifacts.

### 7.5 RLS and schema tests

- Enforce shop isolation for owner/staff, ownership for customer jobs, and narrow agent permissions through trusted API access.
- Test that customer A cannot read customer B's job, owner A cannot access shop B, unpaired agent cannot claim, and client cannot update payment/print state directly.
- Test simultaneous claims, duplicate webhooks, urgent insertion, canceled jobs, lease expiry, notification replay, and document expiry.
- SQL migrations must be additive/backward-compatible with supported older print agents until the upgrade window closes.

---

## 8. Communication and integration between components

### 8.1 Network topology

```text
Customer Browser ── HTTPS ─┐
                            ├── Cloud API ── PostgreSQL / private Storage
Owner Browser ──── HTTPS ──┘        │                 │
            ▲                       │                 └── Supabase Realtime (WSS)
            └──── WSS change signals┘

Windows Print Agent ── outbound HTTPS/WSS ── Cloud API + authorized Storage URL
         │
         ├── PDF renderer / job settings adapter
         └── Windows Print Spooler → installed Windows printer driver → printer

Razorpay ── authenticated webhook ── Cloud API
Cloud API ── push events ── FCM
```

There is **no inbound public agent endpoint**. Agent pairing and print claims are initiated from the shop computer using authenticated outbound connections. Supabase Realtime only wakes subscribers; a missed event must not mean missed work.

### 8.2 End-to-end paid print sequence

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant Web as Customer Web
    participant API as Cloud API
    participant DB as Supabase DB/Storage
    participant PSP as Razorpay
    participant Owner as Owner Dashboard
    participant Agent as Windows Agent
    participant Spooler as Windows Spooler
    Customer->>Web: Select shop, upload and configure
    Web->>API: Upload intent + quote request
    API->>DB: Persist private document and quote metadata
    API-->>Web: Authoritative price and payment order
    Web->>PSP: Checkout
    PSP-->>API: Signed payment webhook
    API->>API: Verify signature, amount, ID and replay
    API->>DB: Transactionally authorize queue entry
    DB-->>Owner: Realtime queue changed
    Owner->>API: Approve eligible next job
    API->>DB: Record authorized execution intent
    DB-->>Agent: Realtime wake-up event
    Agent->>API: Claim next eligible authorized job
    API->>DB: Atomic lease + job attempt
    API-->>Agent: Scoped metadata + temporary download grant
    Agent->>Agent: Download, validate, render, map settings
    Agent->>Spooler: Submit print
    Spooler-->>Agent: Spooler job ID/status
    Agent->>API: Idempotent attempt status update
    API->>DB: Persist status + audit event
    DB-->>Web: Realtime status update
    DB-->>Owner: Realtime status update
    Note over Agent,DB: Clean temp files; delete cloud file by retention policy
```

**Correctness notes:** The customer order must be created as a pending/unpaid record *before* checkout, allowing verified payment confirmation to transition that record to `queued`. Owner approval occurs before physical submission in MVP (the SRS's UC-2 step ordering is internally inconsistent on this point). Once a claim has reached the spooler, do not convert a network reconnect into a duplicate submission.

### 8.3 Contract design

Define a canonical `PrintJob` payload with:
- `contract_version`, `job_id`, `attempt_id`, `lease_id`, `shop_id`, `agent_device_id`, `printer_id`.
- Signed short-lived `download_url` returned only to authenticated agent; `checksum_sha256` and `content_type`.
- Validated `settings`: `paper_size`, `color_mode`, `duplex`, `orientation`, `copies`, `page_range`, plus `finishing` metadata.
- `authorized_until`/lease expiry and `idempotency_key`; no payment secrets or unnecessary customer PII.

Publish JSON Schema in `packages/print-contracts/schema/`, OpenAPI in `packages/print-contracts/openapi/`, examples in `packages/print-contracts/examples/`, and contract conformance tests in both the TypeScript API and Python agent.

### 8.4 Failure modes and protections

| Failure | Required behavior |
|---|---|
| Realtime event missed | Agent reconnects and queries for claimable work; event is signal only |
| Duplicate owner clicks | Idempotent approval and optimistic/transactional guards |
| Duplicate Razorpay webhook | Signature verification, gateway event uniqueness, amount/order matching |
| Agent crashes before submit | Recover lease and local attempt; reschedule only when safe |
| Agent crashes after submit | Reconcile spooler if possible; otherwise mark `unknown` and seek intervention |
| Printer offline/jammed | Surface error and preserve attempt; no uncontrolled replay |
| Internet lost after download | Continue authorized work; locally buffer status and sync later |
| Unsupported duplex/color/page size | Reject with explicit user/owner resolution; do not silently downgrade |
| File cleanup interrupted | Startup cleanup + cloud expiry sweeper with retry/audit |
| API unavailable | Exponential backoff, observable disconnected state, no public LAN fallback |

---

## 9. Development workflow and repository management

### 9.1 Branching and code review

Use protected `main`, short-lived branches, pull requests, and mandatory checks:

```text
main
├── feat/customer-document-upload
├── feat/cloud-priority-queue
├── feat/owner-print-confirmation
├── feat/agent-printer-discovery
└── fix/agent-spooler-recovery
```

- `main` always remains releasable.
- At least one review for changes; `CODEOWNERS` routes sensitive modules to domain owners.
- Include tests with each behavior change, migration with each schema change, and API contract change with each public API modification.
- Every breaking architectural decision gets an ADR in `docs/decisions/` (context, decision, rejected options, consequences).
- Tag applications independently (e.g., `cloud-api/v1.1.0`, `print-agent/v0.3.0`). Maintain an agent compatibility matrix and API deprecation window.

### 9.2 Four-developer work partition

| Track | Primary owned components | Integration obligation |
|---|---|---|
| Developer 1 | `apps/customer-web`, upload, settings, pricing UI | Contract tests vs API, customer e2e |
| Developer 2 | `apps/owner-dashboard`, live queue, approval, reports | Approval concurrency tests, realtime UI |
| Developer 3 | `apps/cloud-api`, `supabase/`, payment, queue, auth | End-to-end transactional, tenancy, RLS tests |
| Developer 4 | `apps/print-agent`, Windows packaging, spooler | Real-device validation, agent/API compatibility |

All developers review shared contracts and participate in integration demonstrations. Assign a secondary reviewer for agent and backend as they are operationally highest risk.

### 9.3 Local environment

- Clone repo, install Node LTS, pnpm, Python, and (for print agent development) Windows + printer drivers.
- Set up local Supabase via Supabase CLI, apply migrations and demo seeds.
- Run cloud API with non-production keys, web apps on their own ports, and agent in simulated mode when no Windows printer is available.
- Provide a `FakePrintEngine` in tests that models acceptance/failure without producing paper. **Do not** treat these simulations as proof of real print correctness.
- Use safe dummy PDFs only. Upload and payment fixtures are synthetic, never real customer documents.

### 9.4 Definition of done

Feature accepted only when: requirements mapped to SRS acceptance case; validation and access controls in place; success/timeout/error cases covered; logs safe; migrations reviewed; API docs updated; relevant CI passes; and manual printer QA evidence exists for device-dependent behavior.

---

## 10. CI/CD pipeline design

```text
.github/workflows/
├── web-ci.yml
├── api-ci.yml
├── database-ci.yml
├── agent-ci.yml
├── contract-ci.yml
├── e2e.yml
├── web-deploy.yml
├── api-deploy.yml
└── agent-release.yml
```

| Workflow | Trigger | Jobs | Artifacts/gate |
|---|---|---|---|
| `web-ci.yml` | PRs changing web/shared UI | pnpm install frozen lockfile; lint; typecheck; unit tests; production builds | Pass before merge |
| `api-ci.yml` | API/shared contract PRs | lint; typecheck; unit/integration API tests; server config validation; OpenAPI validation | Pass before merge |
| `database-ci.yml` | SQL migrations/RLS PRs | local DB startup; migrate fresh and upgrade; tenant isolation tests; concurrency SQL tests | No destructive/unreviewed schema change |
| `agent-ci.yml` | Python/agent PRs | Windows runner; dependency install; Ruff; pytest; mocked spooler tests; static/security checks | Python wheel/exe test build when needed |
| `contract-ci.yml` | API/schema changes | generate schema; detect stale checked-in artifacts; TypeScript + Python compatibility tests | Pass for cross-language boundaries |
| `e2e.yml` | main/staging + relevant PRs | Playwright web journey, API DB, mock agent and queue/payment retries | Integration gate |
| `web-deploy.yml` | Merge to main or release tag | Deploy affected Next.js apps independently | Staging smoke tests; production approval |
| `api-deploy.yml` | Release tag | Deploy API, run smoke and backwards-compatibility tests | Rollback-ready deployment |
| `agent-release.yml` | `print-agent/v*` tag | Windows release build; PyInstaller; Inno Setup; code sign; verify signature; malware scan where available; smoke tests | Signed, versioned installer with checksum |

### 10.1 Pipeline safety

- Use path filtering so an unrelated frontend change does not rebuild the Windows installer; shared contract changes trigger all affected consumers.
- GitHub Actions uses least-privilege permissions and environment-scoped approvals. Store signing certificates and deployment credentials in secure secret storage or a managed signing service.
- Publish an immutable checksum and release manifest for each agent version. Never silently download arbitrary code and execute it in the agent.
- Stage database migrations ahead of services using backward-compatible `expand → migrate → contract` deployment discipline.
- Maintain staging and production environments with separated storage buckets, auth projects, webhooks, and payment credentials.
- Monitor deployment health, agent version distribution, webhook processing failures, queue latency, print error rates, and cleanup backlog. Exclude document content from observability.

### 10.2 Recommended release sequence

1. Apply backward-compatible database migrations.
2. Deploy cloud API with support for both existing and new agent payloads.
3. Deploy web UI applications independently.
4. Pilot signed print-agent update at a small number of shops.
5. Expand rollout after hardware/telemetry validation; provide tested rollback path.
6. Remove deprecated API/schema behavior only after supported client versions are migrated.

---

## 11. Implementation phases and milestone acceptance

### Phase 1 — Repo foundation and contracts

**Deliver:** pnpm workspace, Turborepo, Next.js scaffolds, Fastify skeleton, Python package skeleton, lint/test config, GitHub workflows, API and agent contract drafts, Supabase local project.  
**Exit criterion:** every app boots independently; CI builds; `FakePrintEngine` and first cross-language JSON contract test pass.

### Phase 2 — Standalone Windows printing proof (highest technical risk)

**Deliver:** printer enumeration, installed-driver capability reading, PDF rendering, silent Windows submission, spooler ID/status mapping, minimum local diagnostics and protected temp cleanup.  
**Exit criterion:** print a known PDF in the correct page range/copies/paper/duplex on a chosen real Windows printer without opening a print dialog; log observed actual capability limits.

### Phase 3 — Cloud backend and database

**Deliver:** schema, Auth and RLS, private file upload, server pricing, jobs, transactional Urgent/Flexible queue, agent pairing and atomic claims, durable audit/outbox.  
**Exit criterion:** safe concurrent claim tests pass; no tenant leaks; approved paid/test-authorized job is claimable exactly once.

### Phase 4 — Customer order experience

**Deliver:** discovery, upload, print settings, capability/price preview, quote, pending order, status screen.  
**Exit criterion:** customer can create one validated order with no privileged client-side mutations.

### Phase 5 — Owner operations and agent integration

**Deliver:** shop management, live queue, approval, printer assignment, agent download/render/spool submission, status reconciliation and errors.  
**Exit criterion:** one real customer-originated test PDF goes from web → API/DB → owner approval → agent → printer; job audit and status trace remain consistent.

### Phase 6 — Payments, priority/ETA, notifications, privacy

**Deliver:** Razorpay test/live integration, webhook verification, Urgent/Flexible insertion and recomputation, push notifications, cleanup scheduler, owner sales summaries.  
**Exit criterion:** duplicate webhook test, concurrent priority test, document TTL test, and reconnect tests pass in staging.

### Phase 7 — Packaging, QA and pilot

**Deliver:** signed Windows installer, device pairing UX, start-on-boot support, operational runbooks, compatibility matrix, pilot with one or two shops.  
**Exit criterion:** supervised pilot completes repeat orders with measured reliability and observed error/recovery behavior. Production rollout requires sign-off on privacy, payments, security, and spooler uncertainty.

---

## 12. Critical design decisions and known SRS gaps

1. **Spooler acceptance is not guaranteed paper output.** Job submission state and physical completion/ready-for-pickup must not be conflated when printer signals are ambiguous.
2. **Owner confirmation precedes print submission.** The SRS use-case sequence lists submitting to spooler before owner confirmation; this plan resolves that logical inconsistency in favor of explicit approval before claim/submit.
3. **Payment is a verified server-side state.** Client checkout success alone never unlocks printing. Honor pay-at-counter only under explicit shop policy and audit it.
4. **Queue position is derived and ephemeral.** Tier precedence remains stable; concurrent changes require transactional selection, not an in-memory JavaScript array or mutable globally authoritative `queue_position`.
5. **Renderer choice requires empirical Windows testing.** PDFium/MuPDF may be used; check library licensing and packaging compatibility before production. Windows drivers expose inconsistent capability/status data.
6. **Finishing services need fulfillment classification.** Spiral binding/lamination may require staff intervention; cannot be promised as automatic native print settings without appropriate finishing hardware.
7. **Privacy has physical boundaries.** Application cleanup can delete its own temporary files and private storage objects; it cannot guarantee all spooler storage/printer memory is securely erased.
8. **Kiosk mode is excluded from MVP** but the permission model includes a future configurable automation policy with emergency stop, abuse controls, and size/payment limits.
9. **Document conversion:** non-PDF source formats need a safe isolated converter (e.g., a controlled document-conversion worker) and time/resource limits. This is not the same as PDF rendering in the desktop agent.
10. **Cloud load includes document bandwidth/storage.** Rendering is local, but uploads/downloads and storage remain cloud costs that must be sized and monitored.

---

## 13. First implementation tasks (actionable checklist)

- [ ] Create `caps` GitHub repository; add branch protection, CODEOWNERS and this plan.
- [ ] Initialize pnpm workspaces, Turborepo, lint, formatting, and Next.js/Fastify skeletons.
- [ ] Initialize Python `caps_agent` package and Windows-runner test job.
- [ ] Add JSON Schema/OpenAPI for `PrintSettings`, `PrintJobClaim`, `PrintAttemptStatus` and version negotiation.
- [ ] Create Supabase local project and initial identity/shop/printer/job migration.
- [ ] Implement Python printer discovery and `PrintEngine` with PDF renderer on Windows.
- [ ] Prove silent print of a known PDF on one specific printer; write driver capability findings.
- [ ] Add server-owned quote and order lifecycle, private storage and verified payment test flow.
- [ ] Implement shop-agent secure pairing and atomic claim RPC plus lease/attempt record.
- [ ] Build owner approval and customer status views, then the first end-to-end demo.
- [ ] Add payment webhooks, priority queue, expiry, reconciliation, and pilot operations.

**Non-negotiable design rule:** A completed browser click is never itself a print command. Only a verified, eligible, approved (or future policy-authorized), atomically claimed job should reach a shop's Windows Print Agent.

---

## 14. Document control and change policy

This file is the **locked baseline**, not a claim that all downstream engineering unknowns have been solved. Change high-level architecture only through an ADR and PR review. Keep the SRS as the requirements reference; record deviations (like new attempt states and the owner-before-submission correction) explicitly. Keep lower-level module details and feature tickets synchronized with this document as implementation evolves.

**Reference:** `MINI_PROJECT_I_CAPS_SRS.pdf`, especially §§1.2, 2.5, 3, 4, 5.4, 6, 7, 8, 9.1, 10.1. All specific repository paths, internal states, endpoint shapes, and CI job names above are *recommended implementation designs* rather than literal SRS requirements.
