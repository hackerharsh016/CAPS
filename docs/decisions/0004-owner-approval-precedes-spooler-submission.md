# ADR 0004: Owner Confirmation Precedes Spooler Submission

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** CAPS Architecture & Development Team

## Context

In `MINI_PROJECT_I_CAPS_SRS.md` §6 UC-2 (Automated Print Execution), the flow stated:
> 4. Agent submits the job to the Windows Print Spooler for the assigned printer — no dialog is shown.  
> 5. Shop Owner presses a single "Print" confirmation in the dashboard (or the job proceeds automatically if auto-print is enabled).

In the physical reality of Windows printing, once rasterized data is submitted to the Windows Print Spooler, the spooler immediately transmits the data stream to the physical printer, which consumes paper and toner without delay. If the shop owner's confirmation occurred *after* spooler submission, the confirmation step would be completely moot, and paper would already be printed before approval.

## Decision

We resolve this logical flaw by making **Shop Owner Confirmation an explicit precondition for agent claiming and spooler submission** in the MVP:
1. When payment is verified, the job transitions to `PAYMENT_CONFIRMED` and enters the shop's live queue.
2. The shop owner clicks "Print" in the dashboard, invoking `POST /api/v1/print-jobs/{id}/approve`.
3. Cloud API verifies the shop ownership and transitions the job to `OWNER_CONFIRMED`.
4. Only jobs in `OWNER_CONFIRMED` status are released to the agent via atomic lease claim (`POST /api/v1/agent/jobs/claim`).
5. The agent then downloads, renders, and submits the job to the Windows Print Spooler.

*(Note: In the future CAPS OS autonomous kiosk mode, step 2 is replaced by automated policy-based authorization).*

## Consequences

### Positive
- Prevents unintended physical printing before the shop operator has verified printer readiness (paper loaded, correct tray, toner available).
- Eliminates financial disputes where print jobs run while a shop is unmonitored or jammed.
- Maintains a clean, verifiable state machine.

### Negative / Trade-offs
- Requires the shop owner to tap one button per job during MVP operation.
