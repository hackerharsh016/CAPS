# ADR 0006: Spooler Acceptance vs. Physical Completion & Recovery

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** CAPS Architecture & Development Team

## Context

The Windows Win32 Print Spooler API (`StartDocPrinter`, `WritePrinter`, `EndDocPrinter`) acknowledges when bytes are written to the Windows spool file and returns a `spooler_job_id`. However, the physical printer may still experience paper jams, run out of paper or toner, or fail during physical transfer. Furthermore, if the shop PC loses power or reboots while a job is in the spooler, the physical state of the paper output is ambiguous.

## Decision

1. **State Disambiguation:**
   - The agent and cloud explicitly distinguish `accepted_by_spooler` (state `PRINTING`) from verified completion (state `COMPLETED`).
   - Acceptance by the spooler proves only that the OS received the raster stream.
2. **Spooler Monitoring:**
   - The agent continuously monitors the Win32 job status using `GetJob()` where driver support exists to detect hardware errors (e.g., `JOB_STATUS_PAPEROUT`, `JOB_STATUS_OFFLINE`, `JOB_STATUS_ERROR`).
3. **No Blind Auto-Reprints:**
   - On crash or reboot recovery, if the agent finds an attempt that was in `PRINTING` status without confirmed spooler completion, it **must not** blindly re-spool the job.
   - The job transitions to `UNKNOWN_REQUIRES_REVIEW` and prompts the shop operator to inspect the printer output tray before either marking it completed or triggering an explicit reprint.

## Consequences

### Positive
- Prevents duplicate prints of expensive/multi-page documents caused by software reconnect loops.
- Accurately surfaces hardware jams and low-paper states to the owner dashboard.

### Negative / Trade-offs
- Ambiguous crashes require operator intervention rather than 100% automated recovery.
