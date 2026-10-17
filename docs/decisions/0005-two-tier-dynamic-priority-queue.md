# ADR 0005: Two-Tier Dynamic Priority Queue with Leased Claims

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** CAPS Architecture & Development Team

## Context

Customers at Xerox/print shops often have urgent requirements (e.g., imminent train departures, court hearings, exam submissions) and are willing to pay a premium to jump the line. However, a naive priority queue could lead to starvation of regular customers, concurrency bugs during queue reordering, or race conditions between competing print agents.

## Decision

1. **Two-Tier Model:**
   - Every job is classified as either `urgent` or `flexible` prior to payment.
   - Urgent jobs jump ahead of all queued Flexible jobs.
   - Strict FIFO is maintained within each tier (`enqueued_at ASC, id ASC`).
2. **Non-Preemptive Execution:**
   - Urgent jobs never preempt an active print job in the `PRINTING` state.
3. **Derived Ephemeral Positions:**
   - Queue position is never stored as an authoritative static column on the job row. It is dynamically derived via SQL window functions (`ROW_NUMBER() OVER ...`).
4. **Atomic Leased Claims:**
   - When an agent requests the next job, Cloud API executes a database transaction using `SELECT ... FOR UPDATE SKIP LOCKED` on the highest-ranking approved job, issues a `lease_token` (default 120s) and an `attempt_id`, and transitions the state to `CLAIMED`.
5. **Fairness Controls:**
   - Shop owners can configure hourly caps on Urgent jobs to protect standard customers from queue starvation.

## Consequences

### Positive
- Predictable, mathematically sound ordering without race conditions.
- Realtime ETA recalculation pushes updated wait times to customers accurately.
- Eliminates duplicate printing across concurrent agent sessions.

### Negative / Trade-offs
- Downstream Flexible jobs will experience ETA changes when an Urgent job arrives ahead of them. Realtime UI must clearly explain these updates to users.
