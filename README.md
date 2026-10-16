# CAPS (Cloud Automated Printing Solution)

CAPS is a cloud-based automated printing platform with user-side configuration that modernizes photocopy and Xerox shop operations. Customers configure print jobs (paper, color, duplex, binding) and pay online to enter a shop-specific two-tier queue (`Urgent` vs. `Flexible`). An authenticated local Windows Print Agent automatically renders and spools documents directly into the physical printer drivers without dialogs upon shop owner confirmation.

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
└── docs/                      # Architectural specs, SRS, and implementation plans
```

> **Note on Python Desktop Agent:** `apps/print-agent` is an independent Python application running in the Windows OS print subsystem. It consumes language-neutral contracts defined in `packages/print-contracts` and is managed via standard Python tooling (`venv`, `pytest`, `ruff`), not pnpm.

## Prerequisites

- **Node.js:** LTS `>= 20.0.0` (Node 22 LTS recommended)
- **pnpm:** `>= 9.0.0` (`corepack enable pnpm` or `npm install -g pnpm`)
- **Python:** `>= 3.11` (for `apps/print-agent` development on Windows)
- **Git**

## Quickstart

1. **Clone the repository:**
   ```bash
   git clone <repo-url> CAPS
   cd CAPS
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` with your development Supabase and API values.*

4. **Run monorepo tasks:**
   ```bash
   pnpm build      # Build all apps and packages
   pnpm lint       # Lint all TypeScript workspaces
   pnpm typecheck  # Run type checks across packages
   pnpm test       # Run tests across workspaces
   pnpm dev        # Start development servers in parallel
   ```
