## Description

<!-- Provide a concise summary of the change and the problem it solves. -->

### Manifest & Tracking
- **Task ID:** `PXX-MXX-FXX` <!-- e.g. P01-M03-F02 -->
- **Phase:** 
- **Module:** 
- **Related Issues / PRs:** 

---

## Architectural & Non-Negotiable Checks

- [ ] **Independently Deployable Apps:** Respects monorepo boundaries (`apps/customer-web`, `apps/owner-dashboard`, `apps/cloud-api`, `apps/print-agent`). No illegal cross-app imports.
- [ ] **Secret Isolation:** Verified **zero** server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, private keys) exposed in web bundles, client-side code, or agent binaries.
- [ ] **Privacy & Transient Storage:** Customer document content is **never** logged in error messages, analytics, or application telemetry. Local temporary files are immediately deleted post-spooling.
- [ ] **Payment Security:** Payment verification is enforced strictly on the trusted server (`cloud-api`) via signed webhooks. No client-side callback directly marks an order paid.
- [ ] **Queue Atomicity:** Job claiming uses database-level transactional locks (`FOR UPDATE SKIP LOCKED`) with leases and attempt IDs. Realtime events are treated as wake-up signals only.
- [ ] **Desktop Agent Loopback:** Any local diagnostic interface on the agent binds strictly to `127.0.0.1`. No public inbound ports are opened.
- [ ] **Spooler Invariant:** Spooler acceptance is not conflated with physical paper completion. Ambiguous crash/recovery states transition to `UNKNOWN_REQUIRES_REVIEW` without auto-reprint.

---

## Testing & Quality Evidence

- [ ] `pnpm run format:check` passes across the repository.
- [ ] `pnpm run lint` passes across all TypeScript workspaces.
- [ ] `pnpm run typecheck` passes with zero type errors.
- [ ] `pnpm run test` passes all unit and integration test suites.
- [ ] `pnpm run build` succeeds for all affected applications and packages.
- [ ] Python agent tests (`apps/print-agent`) pass unit and contract checks (`python -m unittest discover ...`).
- [ ] Physical/real-hardware tests clearly separated from mocks (mocks reported honestly, physical testing marked BLOCKED if hardware unavailable).

---

## Documentation & Status
- [ ] `README.md` and/or nearest documentation updated.
- [ ] Any architectural deviations or scope adjustments recorded as an ADR in `docs/decisions/`.
- [ ] `IMPLEMENTATION_STATUS.md` updated with scope delivered, commands run, test evidence, and next task.
