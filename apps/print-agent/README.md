# CAPS Desktop Print Agent

The CAPS Desktop Print Agent (`apps/print-agent`) is a background service and system tray utility designed for Windows 10/11 shop PCs. It receives authorized print jobs from the Cloud API, renders PDF documents locally, applies customer-configured print parameters (paper size, duplex, color, copies) via the Windows Print Spooler (Win32 DEVMODE), and provides status tracking while automatically cleaning up all temporary files.

## Architecture Highlights

- **Outbound-Only Connectivity:** The agent initiates outbound HTTPS/WSS connections to the Cloud API; no inbound ports are exposed to the public internet.
- **Strict Loopback Binding:** Diagnostic interfaces bind exclusively to `127.0.0.1` (`localhost`), strictly prohibiting external network access.
- **Privacy by Design:** Zero document content or sensitive tokens are written to log files. The structured logging pipeline automatically redacts secrets and PII.
- **Pluggable PrintEngine Protocol:** Core printing logic is encapsulated behind the `PrintEngine` protocol, enabling in-memory testing (`FakePrintEngine`) on any developer machine without physical printer hardware.
- **Production WindowsPrintEngine:** Unified execution engine orchestrating PDF inspection, customer settings validation, page rasterization, and dialog-free Windows Spooler submission.
- **Idempotency & Replay Protection:** Guaranteed de-duplication of print attempts by `attempt_id`.
- **Policy #5 Enforcement:** `can_auto_reprint` is strictly `False` across all submissions, protecting against duplicate customer billing and ink/paper waste.

## Print Engine Subsystem (`caps_agent.printing`)

### Core Interfaces & Classes

- **`PrintEngine` (Protocol):** Defines the standard interface:
  ```python
  def print_document(
      pdf_path: Path,
      printer_name: str,
      settings: PrintSettings,
      job_title: str | None = None,
      attempt_id: str | None = None,
      shop_id: str | None = None,
  ) -> PrintResult: ...
  ```
- **`WindowsPrintEngine` (alias `StandardPrintEngine`):** Production orchestrator connecting:
  1. Idempotency cache check
  2. Shop & tenant isolation verification
  3. PDF validation & total page count (`PdfRenderer.validate_pdf`)
  4. Printer capability detection & device status (`CapabilityDetector`)
  5. Native DEVMODE parameter translation (`SettingsMapper.map_settings`)
  6. Raster page generation (`PdfRenderer.render_pages`)
  7. Dialog-free spooler transmission (`WindowsSpooler.submit_job`)
- **`FakePrintEngine` (Test Fake):** High-fidelity in-memory double supporting:
  - Incrementing spooler job IDs
  - Configurable hardware failures (no paper, paper jam, offline)
  - Unknown printer and unsupported settings rejection
  - Multi-tenant / shop authorization enforcement
  - Idempotent attempt caching
  - Spooler RPC disconnect simulation

### Error Taxonomy

All exceptions inherit from `PrintEngineError` and carry a structured `error_code` string and contextual `details`:
- `DocumentNotFoundError`: File missing from disk (`DOCUMENT_NOT_FOUND`)
- `DocumentValidationError`: Invalid header, corrupted, or password-protected (`DOCUMENT_INVALID`, `DOCUMENT_CORRUPTED`, `DOCUMENT_PASSWORD_PROTECTED`)
- `PrinterNotFoundError`: Printer not installed or queryable (`PRINTER_NOT_FOUND`)
- `PrinterUnavailableError`: Offline, paper-out, or jammed (`PRINTER_OFFLINE`, `PRINTER_PAPER_OUT`, `PRINTER_PAPER_JAM`)
- `UnsupportedSettingError`: Feature unsupported by driver (`UNSUPPORTED_SETTING`)
- `InvalidSettingError`: Malformed setting value (`INVALID_SETTING`)
- `InvalidPageRangeError`: Page range exceeds document bounds (`PAGE_RANGE_OUT_OF_BOUNDS`)
- `RenderingError`: Page rasterization failure (`RENDERING_FAILED`)
- `SpoolerError`: Windows Spooler rejected submission (`SPOOLER_SUBMISSION_FAILED`, `PRINTER_ACCESS_DENIED`)
- `DuplicateJobError`: Attempt ID already in flight or submitted (`DUPLICATE_JOB_ATTEMPT`)
- `ShopAuthorizationError`: Unauthorized printer or shop mismatch (`FORBIDDEN_SHOP`)

## Jobs & Execution Subsystem (`caps_agent.jobs`)

### Per-Printer Dispatcher (`JobDispatcher`)

The `JobDispatcher` manages execution across connected printers:
- **Per-Printer Serialization:** Concurrency is strictly 1 per printer name. Parallel execution occurs simultaneously across distinct physical printers.
- **Queue Backpressure:** Bounded capacity per printer (`max_queue_per_printer`). Attempts exceeding queue depth trigger `QueueBackpressureError`.
- **Cancellation:** Pending jobs in queue can be aborted via `cancel_job(job_id)` without reaching the Windows spooler.
- **Clean Worker Termination:** `shutdown(wait=True)` sends poison pills and safely drains or terminates worker threads.

### Formal State Machine (`JobStateMachine`)

Lifecycle states strictly follow the CAPS architecture baseline:
`QUEUED` -> `CLAIMED` -> `DOWNLOADING` -> `VALIDATING` -> `RENDERING` -> `PRINTING` -> `COMPLETED` / `FAILED` / `CANCELLED` / `UNKNOWN_REQUIRES_REVIEW`

- **Terminal States:** `COMPLETED`, `FAILED`, `CANCELLED`, `UNKNOWN_REQUIRES_REVIEW`. Transitioning out of terminal states raises `TerminalStateError`.
- **Ambiguous Outcomes (Policy #5):** Disappearing spooler jobs or unconfirmed outcomes transition to `UNKNOWN_REQUIRES_REVIEW` with `can_auto_reprint=False`.
- **Audit History:** Every transition records an immutable `StateTransitionRecord` timestamped in UTC with reasons and structured details.

## Storage Subsystem (`caps_agent.storage`)

### Durable SQLite Attempt Journal (`LocalStateJournal`)

- **Persistent Attempt Store:** Thread-safe SQLite journal storing job claims, attempt IDs, cloud lease tokens, assigned spooler job IDs, and full lifecycle state transitions.
- **ACID Transactions & Concurrency:** Configured with WAL (`PRAGMA journal_mode=WAL`), normal synchronization, foreign keys enabled, and recursive re-entrant locking (`threading.RLock`).
- **Policy #5 Integrity:** Enforces `can_auto_reprint = False` across all attempt rows and transition logs.
- **Active In-Flight Queries:** Identifies incomplete/interrupted jobs upon agent process restart.

### Protected Temporary File Storage (`TempFileManager`)

- **Secure Scoped Directories:** Isolates PDF downloads, rendered raster bitmaps, and spool artifacts in per-job folders (`job_<job_id>`).
- **Path Traversal Defense:** Validates job and attempt IDs against directory traversal sequences (`..`, `/`, `\`, null bytes).
- **Access Control:** Restricts folder permissions to the running user and SYSTEM (via `icacls` on Windows, `0700` on POSIX), protecting customer document privacy from other local users.
- **Registry Tracking:** Actively registers files for lifecycle management and immediate deletion.

### Transient File Cleanup & Orphan Scrubbing (`ArtifactCleaner`)

- **Post-Execution Cleanup:** Scrubbing of temporary PDFs and rendered bitmaps immediately upon job completion (`COMPLETED`), cancellation (`CANCELLED`), or failure (`FAILED`).
- **Privacy File Wiping:** Overwrites file contents with zeros (`\x00`) before unlinking when secure wipe is enabled.
- **Orphan Sweeper:** Cleans stale spool artifacts older than `temp_cleanup_max_age_seconds` (default 3600s), while protecting files belonging to currently active jobs.
- **Lock Resiliency:** Gracefully tolerates temporary Windows file handles held by the spooler or antivirus without crashing the agent.

## Startup Crash Recovery Subsystem (`caps_agent.jobs.recovery`)

### Startup Reconciliation (`StartupRecoveryCoordinator`)

- **Crash Inspection:** On agent startup, queries `LocalStateJournal.get_active_attempts()` to discover in-flight jobs interrupted by process crash, system reboot, or power outage.
- **Windows Spooler Reconciliation:**
  - If interrupted during `PRINTING` with a `spooler_job_id`, checks the spooler queue via `Win32JobQueryAdapter`.
  - If spooler confirms `JOB_STATUS_COMPLETE` / `JOB_STATUS_PRINTED`, transitions attempt to `COMPLETED`.
  - If spooler job disappeared or status is unconfirmed, transitions to `UNKNOWN_REQUIRES_REVIEW` with `can_auto_reprint=False` (**Non-Negotiable Policy #5** strictly enforced; no automatic reprints).
  - If interrupted prior to spooler submission (`QUEUED`, `CLAIMED`, `DOWNLOADING`, `VALIDATING`, `RENDERING`), transitions to `FAILED` (`AGENT_CRASH_BEFORE_SPOOLER`).
- **Startup Cleanup:** Triggers immediate residual artifact removal for crashed attempts and runs background orphan scrubbing.

## Hardware Verification & Feasibility Gate (`tests/hardware`)

- **Feasibility Integration Gate:** End-to-end software simulation validating driver capability matrices, multi-printer serialized dispatching, spooler traces, Policy #5 enforcement, and zero document retention (`tests/hardware/test_hardware_gate.py`).
- **Physical Hardware Test Suite:** Live hardware verification suite (`tests/hardware/test_real_printer.py`).
  - To run with physical Windows printers:
    ```powershell
    $env:CAPS_TEST_PRINTER_NAME = "Your Printer Name"
    pytest tests/hardware/test_real_printer.py -v -s
    ```
  - When no printer is designated, physical tests are cleanly marked `SKIPPED` / `BLOCKED`, faithfully preventing fake pass assertions in automated test environments.
- **Printing Compatibility Guide & Operator Runbook:** See [docs/printing-compatibility.md](docs/printing-compatibility.md) for full driver compatibility matrix, error recovery procedures, spooler traces, and the official Go/No-Go decision record.
- **Real-Device Compatibility Matrix & High-Volume Stress Suite:** See [docs/real-device-compatibility-matrix.md](docs/real-device-compatibility-matrix.md) and [`tests/hardware/test_compatibility_matrix.py`](tests/hardware/test_compatibility_matrix.py) for the complete parameter permutation matrix (A4, A3, Legal, B&W, Color, Duplex, copies) and multi-job serialized queue stress tests.

## Development Setup

1. **Create and activate a virtual environment:**
   ```powershell
   python -m venv .venv
   .venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```powershell
   pip install -e .
   pip install pytest ruff
   ```

3. **Run tests:**
   ```powershell
   pytest -v
   ```

4. **Lint code:**
   ```powershell
   ruff check .
   ```
