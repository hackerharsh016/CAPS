# CAPS (Cloud Automated Printing Solution)

CAPS is a cloud-based automated printing platform with user-side configuration that modernizes photocopy and Xerox shop operations. Customers configure print jobs (paper, color, duplex, binding) and pay online to enter a shop-specific two-tier queue (`Urgent` vs. `Flexible`). An authenticated local Windows Print Agent automatically renders and spools documents directly into physical printer drivers without print dialogs upon shop owner confirmation.

---

## Architecture & System Documentation

Comprehensive architecture specifications, lifecycle state machines, decision records, and operational runbooks are maintained in the [`docs/`](file:///D:/CAPS%20REPO/CAPS/docs/) directory:

- **System Architecture & Data Flow:** [`docs/architecture/overview.md`](file:///D:/CAPS%20REPO/CAPS/docs/architecture/overview.md) — 3-tier model, end-to-end data flow sequence, and core invariants.
- **Lifecycle State Machines:** [`docs/architecture/state-machines.md`](file:///D:/CAPS%20REPO/CAPS/docs/architecture/state-machines.md) — 10-state print job lifecycle, payment lifecycle, and desktop agent attempt leases.
- **Two-Tier Dynamic Queue:** [`docs/architecture/queue-design.md`](file:///D:/CAPS%20REPO/CAPS/docs/architecture/queue-design.md) — Urgent vs. Flexible queue discipline, FIFO-within-tier, dynamic ETA calculation, and fairness caps.
- **Privacy Lifecycle & Document Retention:** [`docs/architecture/privacy-lifecycle.md`](file:///D:/CAPS%20REPO/CAPS/docs/architecture/privacy-lifecycle.md) — Transient cloud storage, immediate local disk deletion, automated purge workers, and physical boundary disclaimers.
- **Architecture Decision Records (ADRs):** [`docs/decisions/`](file:///D:/CAPS%20REPO/CAPS/docs/decisions/) — Numbered records of all settled architectural trade-offs:
  - [ADR 0001: Record Architecture Decisions](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0001-record-architecture-decisions.md)
  - [ADR 0002: Modular Monorepo with Turborepo & pnpm Workspaces](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0002-modular-monorepo-structure.md)
  - [ADR 0003: Desktop Agent Outbound-Only & Strict Loopback Binding](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0003-desktop-agent-outbound-only-and-loopback.md)
  - [ADR 0004: Owner Confirmation Precedes Spooler Submission](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0004-owner-approval-precedes-spooler-submission.md)
  - [ADR 0005: Two-Tier Dynamic Priority Queue with Leased Claims](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0005-two-tier-dynamic-priority-queue.md)
  - [ADR 0006: Spooler Acceptance vs. Physical Completion & Recovery](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0006-spooler-acceptance-and-physical-completion.md)
  - [ADR 0007: Transient Storage Lifecycle & Automated Purge Policies](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0007-privacy-lifecycle-and-transient-storage.md)
  - [ADR 0008: Execution Sequence Deferral of P01-M02-F03 for Docs Baseline](file:///D:/CAPS%20REPO/CAPS/docs/decisions/0008-sequence-deferral-p01-m02-f03.md)
- **Developer Setup Guide:** [`docs/development/setup.md`](file:///D:/CAPS%20REPO/CAPS/docs/development/setup.md) — Step-by-step local workstation onboarding.
- **Environment Matrix:** [`docs/development/environment-matrix.md`](file:///D:/CAPS%20REPO/CAPS/docs/development/environment-matrix.md) — Comprehensive variable specifications and security tiers.
- **Ownership Map:** [`docs/development/ownership-map.md`](file:///D:/CAPS%20REPO/CAPS/docs/development/ownership-map.md) — Four-developer work partition and review protocols.
- **Operational Runbooks:** [`docs/development/runbooks.md`](file:///D:/CAPS%20REPO/CAPS/docs/development/runbooks.md) — Startup, test execution, and troubleshooting runbooks.

---

## Repository Architecture

This repository is structured as a **modular monorepo** managed with **pnpm workspaces** and **Turborepo**:

```text
caps/
├── apps/
│   ├── customer-web/          # Next.js customer application
│   ├── owner-dashboard/       # Next.js shop owner operations dashboard
│   ├── cloud-api/             # Fastify Node.js cloud orchestration backend
│   └── print-agent/           # Python Windows background service (pywin32 / PDFium)
├── packages/
│   ├── ui/                    # Shared React design system components
│   ├── types/                 # Shared TypeScript domain types
│   ├── validation/            # Shared Zod schemas for payload validation
│   ├── api-client/            # Typed API client for web applications
│   ├── print-contracts/       # OpenAPI & JSON Schema specifications
│   └── config/                # Shared ESLint, Prettier, and TypeScript configs
├── supabase/
│   ├── migrations/            # Versioned SQL migrations & RLS policies
│   └── seeds/                 # Local dev seeds
├── infra/                     # Inno Setup scripts, Docker configs, CI/CD workflows
└── docs/                      # Architectural specs, SRS, ADRs, and runbooks
```

> **Note on Python Desktop Agent:** `apps/print-agent` is an independent Python application running in the Windows OS print subsystem. It consumes language-neutral contracts defined in `packages/print-contracts` and is managed via standard Python tooling (`venv`, `pytest`, `ruff`), not pnpm.

---

## Prerequisites

- **Node.js:** LTS `>= 20.0.0` (Node 22 LTS recommended)
- **pnpm:** `10.26.2` (or `>= 9.0.0`)
- **Python:** `>= 3.11` (for `apps/print-agent` development on Windows)
- **Git**

---

## Quickstart

1. **Clone the repository:**
   ```bash
   git clone <repo-url> CAPS
   cd CAPS
   ```

2. **Install dependencies:**
   ```bash
   corepack enable
   pnpm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` with your development Supabase, Cloud API, and Razorpay values.*

4. **Run monorepo tasks:**
   ```bash
   pnpm build      # Build all apps and packages
   pnpm lint       # Lint all TypeScript workspaces
   pnpm typecheck  # Run type checks across packages
   pnpm test       # Run tests across workspaces
   pnpm dev        # Start development servers in parallel
   ```

5. **Run Python Desktop Agent tests:**
   ```powershell
   $env:PYTHONPATH = "apps/print-agent/src"
   python -m unittest discover -s apps/print-agent/tests -p "test_*.py" -v
   ```
