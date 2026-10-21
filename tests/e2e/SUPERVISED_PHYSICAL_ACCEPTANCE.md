# CAPS — Supervised Physical Acceptance Gate Protocol (P05-M05-F02)

> **Document:** `tests/e2e/SUPERVISED_PHYSICAL_ACCEPTANCE.md`  
> **Status:** Active Acceptance Protocol  
> **Milestone:** Phase 05 -> Phase 06 Integration Gate

---

## 1. Purpose & Scope

This runbook documents the physical hardware verification procedure for the full **Owner → Cloud → Agent → Spooler** vertical slice.

While automated unit and integration tests validate the flow end-to-end using high-fidelity fake adapters (`FakeWindowsSpooler`, `FakePrintEngine`), physical certification requires human verification on a physical Windows machine connected to real printers.

---

## 2. Invariants Under Verification

| Invariant | Description | Enforced By |
|---|---|---|
| **Zero Spontaneous Printing** | Realtime WebSocket events are wake-up signals only. An agent may never print without an authenticated atomic lease (`lease_token`). | Cloud RPC `claim_next_approved_job` |
| **Owner Confirmation (MVP)** | Every customer job must be approved by the shop owner (`OWNER_CONFIRMED`) before the agent can claim it. | Owner Dashboard Queue UI |
| **Payment Precondition** | No job can be approved or claimed unless payment is verified (`paid`) or expressly marked cash-collected at counter. | Cloud API State Machine |
| **Single Physical Output** | Replayed network signals or concurrent desktop agent workers must never produce duplicate physical prints. | Win32 Spooler Idempotency Key & Lease Mutex |
| **Status Honesty** | A Win32 spooler submission ID indicates submission only. Status becomes `completed` only when physical hardware ejects the page. | Agent Spooler Monitor (`GetJob` Win32) |
| **No Auto-Reprint on Fault** | Hardware faults (paper jam, out-of-paper, door open) transition job to `requires_review`. Unknown outcomes never auto-reprint. | Agent Failure Handler |
| **Immediate Document Purge** | Upon completed printing, customer PDF rasters and temp spool files are wiped immediately. | Document Retention Sweeper & SQLite Recovery |

---

## 3. Supervised Physical Acceptance Step-by-Step

### Prerequisites
1. Windows 10/11 Desktop running `apps/print-agent`.
2. Physical USB or Network Printer (e.g. Canon imageRUNNER or HP LaserJet) with standard A4 paper loaded.
3. Local Supabase or Cloud API instance accessible at `http://127.0.0.1:4000`.
4. Shop Owner Dashboard logged in at `http://localhost:3001`.

---

### Step 1: Pair Desktop Agent
```powershell
cd apps/print-agent
.\.venv\Scripts\Activate.ps1
python src/caps_agent/main.py pair --code CP-XXXXXX
```
- [ ] Agent reports successful pairing and appears as **Online** on Owner Dashboard `/printers`.
- [ ] Last heartbeat timestamp refreshes within 90 seconds.

---

### Step 2: Customer Job Enqueue & Payment
- [ ] Create test print job with 2 copies, double-sided (duplex), A4.
- [ ] Complete payment via test gateway or select Pay at Counter.
- [ ] Job enters **Live Queue** on Owner Dashboard.

---

### Step 3: Owner Approval
- [ ] Owner clicks **Confirm Print** (One-Tap Approval).
- [ ] Job status visibly changes to `Approved` in the UI.

---

### Step 4: Agent Outbound Claim & Spooler Submission
- [ ] Desktop Agent log outputs:
  ```text
  [INFO] Received queue wakeup notification.
  [INFO] Claiming next approved job for shop: 00000000-0000-0000-0000-000000000001
  [INFO] Acquired lease token: lease-tok-xxxx for job: e2e-job-001
  [INFO] Rendering 2 duplex pages with PDFium...
  [INFO] Submitting to Windows Print Spooler: Canon imageRUNNER 2625 (Tray 1)
  [INFO] Windows Spooler Job ID assigned: 1042
  ```
- [ ] Windows Print Queue window (`printmanagement.msc` or `Printers & Scanners`) displays active spooler job.
- [ ] Dashboard displays status: `Printing` (NOT `Completed`).

---

### Step 5: Physical Print Completion & File Purge
- [ ] Physical printer feeds paper and outputs 2 clean duplex pages.
- [ ] Agent detects print completion via `GetJob` status transition.
- [ ] Dashboard displays status: `Completed`.
- [ ] Agent deletes local raster temp file: `C:\Users\<user>\AppData\Local\Temp\caps_agent\*.pdf` and verifies `os.path.exists() == False`.

---

### Step 6: Fault Injection Test (Paper Out)
- [ ] Empty paper tray on printer.
- [ ] Send new print job and approve it.
- [ ] Agent submits to spooler -> printer reports paper out.
- [ ] Agent flags job as `requires_review` with error code `PRINTER_PAPER_OUT`.
- [ ] Verify that printer does NOT print multiple copies upon reloading paper without operator review.

---

## 4. Certification Sign-off

| Milestone Stage | Acceptance Gate | Verified By | Date | Result |
|---|---|---|---|---|
| Automated Vertical Slice | `tests/e2e/owner-cloud-agent-spooler.test.ts` | Vitest Runner | 2026-10-21 | **PASS** |
| Agent Engine Unit Tests | `apps/print-agent/tests/test_engine.py` | Pytest Runner | 2026-10-21 | **PASS** |
| Supervised Physical Printer | Physical Canon / HP Hardware | Hardware Lab | Pending | **BLOCKED / HARDWARE LAB** |
