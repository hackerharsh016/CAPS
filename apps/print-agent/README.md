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
