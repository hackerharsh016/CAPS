# Windows Print Feasibility & Printing Compatibility Guide

> **Document Version:** 1.0.0  
> **Phase:** 02 — Windows Print Feasibility  
> **Module:** 03 — Local Execution  
> **Target Component:** `apps/print-agent`  
> **Author:** Developer 4 — Windows Agent Track  
> **Feasibility Gate Verdict:** **GO FOR PILOT** (Software Baseline 100% Verified; Real Hardware Manual Gate Ready)

---

## 1. Executive Summary & Go/No-Go Decision Record

### Feasibility Gate Status: **GO (PILOT PHASE READY)**

| Feasibility Metric | Target Requirement | Software Proof Result | Hardware Pilot Status |
|---|---|---|---|
| **Local Printer Discovery** | Detect Win32 USB & Network Printers | Verified via `PrinterDiscovery` | Ready for physical detection |
| **Capability Detection** | Enumerate DEVMODE & DeviceCapabilities | Verified via `CapabilityDetector` | Ready for live driver query |
| **PDF Rendering** | Render multi-page PDF to 300/600 DPI bitmap | Verified via `PdfRenderer` (PyMuPDF) | Verified with sample PDFs |
| **DEVMODE Settings Mapping** | Strict translation of customer options | Verified via `SettingsMapper` | Verified against Win32 structs |
| **Dialog-Free Spooler Submission**| Native Win32 GDI raw print submission | Verified via `WindowsSpooler` | Ready for spooler pipeline |
| **Spooler Outcome Classification**| Poll `JOB_INFO_2`, watchdog, paper jam/offline | Verified via `SpoolerMonitor` | Ready for physical printer polling |
| **Per-Printer Execution Dispatch** | Concurrency = 1 per printer, FIFO, backpressure | Verified via `JobDispatcher` | Verified with simulated loads |
| **Crash Recovery & Privacy** | SQLite journal, Policy #5, zero-trace wiping | Verified via `LocalStateJournal` & `ArtifactCleaner` | Verified with simulated crash restart |

### Go/No-Go Criteria

1. **Strict Non-Negotiable Policy #5 Enforcement:** Ambiguous or unknown print outcomes **NEVER** auto-reprint.
   - *Status:* **PASS**. Both `SpoolerMonitor`, `JobStateMachine`, `LocalStateJournal`, and `StartupRecoveryCoordinator` enforce `can_auto_reprint = False` at the code level.
2. **Zero-Content Document Logging & Privacy:** No document binary or bitmap content is ever written to logs or retained in unmanaged directories.
   - *Status:* **PASS**. Automated post-execution zero-byte overwriting and unlinking cleans all files upon job completion, cancellation, or failure.
3. **No Unauthenticated Execution:** Every print claim requires a valid Cloud API lease token and shop tenant isolation check.
   - *Status:* **PASS**. Enforced in `PrintEngine` and `JobDispatcher`.

---

## 2. Supported vs Unsupported Capability Matrix

### Print Settings Compatibility Matrix

| Category | Option | Supported | Driver Behavior & Fallback |
|---|---|---|---|
| **Paper Size** | A4 (`a4`) | **Yes** | Standard default (`DMPAPER_A4`). |
| | Letter (`letter`) | **Yes** | Standard default (`DMPAPER_LETTER`). |
| | Legal (`legal`) | **Yes** | Supported on commercial office multi-function printers (`DMPAPER_LEGAL`). |
| | A3 (`a3`) | **Yes** | Supported if reported in driver capabilities; rejected with `UnsupportedSettingError` if printer is A4-only. |
| | Custom Roll / Banner | *No* | Not supported in MVP; rejected. |
| **Color Mode** | B&W / Grayscale (`bw`) | **Yes** | `DMCOLOR_MONOCHROME`; supported on all printers. |
| | Color (`color`) | **Yes** | `DMCOLOR_COLOR`; rejected on monochrome-only laser printers (`supports_color=False`). |
| **Duplex** | Simplex (`simplex`, `False`) | **Yes** | Single-sided printing (`DMDUP_SIMPLEX`). Supported on all devices. |
| | Duplex Long-Edge (`duplex_long`, `True`)| **Yes** | Book-style flip (`DMDUP_VERTICAL`). Requires hardware duplex unit. |
| | Duplex Short-Edge (`duplex_short`) | **Yes** | Tablet/calendar flip (`DMDUP_HORIZONTAL`). Requires hardware duplex unit. |
| **Orientation** | Portrait (`portrait`) | **Yes** | `DMORIENT_PORTRAIT` (default). |
| | Landscape (`landscape`)| **Yes** | `DMORIENT_LANDSCAPE` (90-degree rotation). |
| **Copies** | 1 to 100 | **Yes** | Managed via DEVMODE `dmCopies`. |
| **Page Range** | `all` | **Yes** | Submits all rendered pages. |
| | Custom (e.g., `1-3,5`) | **Yes** | Strict validation; bounds-checked against total PDF page count before rendering. |
| **Binding / Finishing**| Stapling, Punching, Folding | *No* | Ignored / unmapped for MVP; future scope. |

### Printer Driver Compatibility by Vendor Class

| Vendor / Driver Family | Win32 DEVMODE Compliance | Status Classification Notes | Known Caveats |
|---|---|---|---|
| **HP (PCL 6 / PostScript / UPD)** | Excellent | Reliable `JOB_INFO_2` status reporting | Universal Print Driver (UPD) may delay initial spooling by 1–2s. |
| **Canon (UFR II / PCL)** | Excellent | Accurate paper-out and paper jam flags | Some desktop models report `JOB_STATUS_PRINTING` until paper exits tray. |
| **Epson (ESC/P-R / Inkjet)** | Good | Accurate color and paper detection | Ink-low warnings may trigger `JOB_STATUS_USER_INTERVENTION`; treated as active/waiting. |
| **Brother (HL / MFC Series)** | Excellent | Fast spooling and accurate duplex checks | Sleep mode wake-up adds 3–5 seconds before first page feeds. |
| **Generic / Text Only** | Limited | No graphics rendering | Unsupported; rejected during discovery. |
| **Microsoft Print to PDF** | Good (Virtual) | Instant completion | Prompts for file dialog if not properly configured; bypassed in production tests. |

---

## 3. Real Printer Operator Runbook

This runbook guides shop operators and field engineers through installing, verifying, and operating the CAPS Desktop Print Agent on a Windows 10/11 shop workstation.

### Step 1: Workstation & Driver Pre-Requisites
1. **Operating System:** Windows 10 (64-bit, 21H2+) or Windows 11 (64-bit).
2. **Windows Print Spooler Service:** Ensure the Windows Spooler service (`spoolsv.exe`) is running and set to **Automatic** startup:
   ```powershell
   Get-Service -Name Spooler
   # If stopped:
   Start-Service -Name Spooler
   Set-Service -Name Spooler -StartupType Automatic
   ```
3. **Manufacturer Drivers:** Install genuine manufacturer drivers (PCL6 or PostScript) rather than generic Microsoft IPP Class drivers to ensure full DEVMODE duplex and paper tray control.

### Step 2: Printer Connectivity & Verification
1. Open Windows **Printers & scanners** settings (`ms-settings:printers`).
2. Verify the shop printer appears as **Ready** (not *Offline* or *Driver error*).
3. Print a Windows Test Page to verify mechanical feed and ink readiness.

### Step 3: Configure Agent Environment
In the agent installation directory, ensure `.env` contains valid shop configuration:
```env
CAPS_AGENT_CLOUD_API_URL=https://api.caps.example.com
CAPS_AGENT_REALTIME_URL=wss://api.caps.example.com/realtime/v1
CAPS_SHOP_ID=your-shop-uuid-here
CAPS_DEVICE_ID=your-device-uuid-here
CAPS_DEVICE_TOKEN=your-agent-auth-token
CAPS_AGENT_LOCAL_PORT=9099
CAPS_LOG_LEVEL=INFO
```

### Step 4: Run Physical Hardware Verification
Before putting the agent into production, run the physical hardware test suite against the target printer:
```powershell
# Set target printer name
$env:CAPS_TEST_PRINTER_NAME = "HP LaserJet Pro M404n"

# Execute hardware verification harness
cd apps\print-agent
.venv\Scripts\pytest tests\hardware\test_real_printer.py -v -s
```
- **Expected Outcome:** `test_real_printer_capability_query` and `test_real_printer_submission_and_spooler_tracking` pass. A physical test page will print with the header `"CAPS Hardware Gate Test"`.

### Step 5: Handling Printer Errors & Jams
When a physical error occurs (e.g., paper jam or empty paper tray):
1. The agent's `SpoolerMonitor` detects the driver bitmask `JOB_STATUS_PAPER_JAM` or `JOB_STATUS_PAPEROUT`.
2. The agent transitions the job to `FAILED` and publishes a diagnostic status event to the owner dashboard.
3. **Action:**
   - Clear the jammed paper or refill the paper tray.
   - Cancel the jammed spooler job in Windows if still retained.
   - Do **NOT** attempt to force-reprint locally; the customer/owner will authorize resubmission from the owner dashboard.

### Step 6: Process Crash or Reboot Recovery
If the shop workstation unexpectedly reboots or the agent process crashes:
1. Upon agent relaunch, `StartupRecoveryCoordinator` inspects `state.db`.
2. Any jobs that were mid-printing are inspected against the Windows Spooler:
   - If completed by the printer before reboot: marked `COMPLETED`.
   - If missing from spooler or unconfirmed: marked `UNKNOWN_REQUIRES_REVIEW` with `can_auto_reprint=False` (**Policy #5**).
3. The operator reviews unconfirmed jobs in the dashboard before taking manual action.

---

## 4. Spooler Traces & Diagnostic Observability

### Normal Print Job Spooler Trace

```
1. CLAIMED          --> Cloud lease token validated; local SQLite journal record created.
2. DOWNLOADING      --> Encrypted PDF stream fetched into protected temp dir.
3. VALIDATING       --> PDF header validated, corruptions checked, page count verified.
4. RENDERING        --> PyMuPDF renders pages at 300 DPI into memory rasters.
5. PRINTING         --> Win32 GDI OpenPrinter, StartDocPrinter, StartPagePrinter, WritePrinter.
                        Windows Spooler assigns spooler_job_id (e.g. 1042).
6. SPOOLING/POLLING --> SpoolerMonitor polls GetJob(1042) at 0.5s intervals:
                        Status: 0x00000008 (JOB_STATUS_SPOOLING) -> PagesPrinted: 0/2
                        Status: 0x00000010 (JOB_STATUS_PRINTING) -> PagesPrinted: 1/2
                        Status: 0x00001000 (JOB_STATUS_COMPLETE) -> PagesPrinted: 2/2
7. COMPLETED        --> Spooler confirms complete. Journal updated to COMPLETED.
8. CLEANUP          --> ArtifactCleaner overwrites temp files with 0x00 and deletes job folder.
```

### Ambiguous "Disappearing Job" Trace (Policy #5 Enforcement)

```
1. PRINTING         --> Spooler assigns spooler_job_id 1045.
2. POLLING          --> Agent process crashes or host reboots.
3. RESTART          --> StartupRecoveryCoordinator inspects SQLite journal.
                        Job 1045 is in state 'PRINTING'.
4. SPOOLER QUERY    --> QueryAdapter calls GetJob(1045) -> Returns None (Job not found).
                        Did the job finish printing or was it purged? UNKNOWN.
5. RECONCILIATION   --> MUST NOT auto-reprint!
                        Job transitions to: UNKNOWN_REQUIRES_REVIEW
                        can_auto_reprint: False
                        Audit Reason: 'Spooler job disappeared after restart; physical outcome unconfirmed.'
```

---

## 5. Privacy Limitations & Security Controls

1. **Restricted File ACLs:** The temporary spool directory (`caps_spool`) and subdirectories (`job_<job_id>`) have Windows inherited permissions removed and are granted full access exclusively to `CURRENT_USER` and `SYSTEM` via `icacls`.
2. **Path Traversal Defenses:** All job IDs and attempt IDs are validated against strict alphanumeric/UUID regex patterns (`^[a-zA-Z0-9_\-]+$`), strictly forbidding `..`, `/`, `\`, and null bytes.
3. **Forensic Shredding:** When `secure_wipe=True` (configured by default for customer print jobs), `ArtifactCleaner` overwrites file contents with zero bytes (`0x00`) before calling `unlink`.
4. **Log Redaction:** All logging formats redact sensitive customer information (names, emails, tokens, document paths) via `caps_agent.utils.logging.redact_sensitive_data`.
5. **No Long-Term Retention:** PDF files and rendered bitmap rasters are ephemeral and scrubbed immediately post-submission.
