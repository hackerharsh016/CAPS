# ADR 0002: Modular Monorepo with Turborepo & pnpm Workspaces

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** CAPS Architecture & Development Team

## Context

The CAPS system comprises four primary applications:
1. `apps/customer-web` (Customer interface)
2. `apps/owner-dashboard` (Shop operator interface)
3. `apps/cloud-api` (Central business and orchestration backend)
4. `apps/print-agent` (Windows-side background agent)

We required a repository structure that ensures strict type safety, shared validation rules, synchronized contracts, and atomic changes across frontends and backends while preventing tight coupling or monolith deployment hazards.

## Decision

We adopt a **modular monorepo** architecture using **pnpm workspaces** and **Turborepo**:
- **Apps:** `apps/*` contains the four independently deployable applications.
- **Shared TS Packages:** `packages/*` contains reusable TypeScript libraries (`@caps/config`, `@caps/types`, `@caps/validation`, `@caps/print-contracts`, `@caps/api-client`, `@caps/ui`).
- **Python Boundary:** `apps/print-agent` is managed with native Python tooling (`venv`, `pytest`, `ruff`), consuming language-neutral JSON Schemas and OpenAPI contracts generated in `packages/print-contracts`.
- **Database Migrations:** PostgreSQL schema migrations and RLS policies live at the repository root under `supabase/migrations/`.

## Consequences

### Positive
- Single Git history and unified PR verification across apps and contracts.
- Zero code duplication for domain models, validation schemas, and API contracts.
- High build speed and incremental caching provided by Turborepo.
- Independent deployability preserved: applications can be tagged and deployed independently.

### Negative / Trade-offs
- CI pipelines must use path filtering to avoid rebuilding unrelated applications.
- Cross-language boundary requires contract generation (JSON Schema/OpenAPI) rather than direct TypeScript imports into Python.
