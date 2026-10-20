"""Windows Print Spooler outcome monitor and status classifier.

Part of CAPS Windows Print Feasibility (Phase 02, Module 02).
Responsible for:
- Polling and observing spooler job state transitions (SPOOLING, PRINTING, COMPLETED, FAILED, UNKNOWN)
- Detecting driver-reported hardware errors (paper jam, out-of-paper, offline, user intervention)
- Disambiguating the Windows 'disappearing job' lifecycle: verified completion vs premature cancellation
- Enforcing watchdog timeouts for stalled or hung print jobs
- Ensuring unknown outcomes NEVER trigger automatic duplicate reprints
- Providing pluggable job query adapters for native win32print and deterministic in-memory mock testing
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger("caps_agent.printing.spooler_monitor")


# ==============================================================================
# Win32 JOB_STATUS_* and PRINTER_STATUS_* Constants (wingdi.h / winspool.h)
# ==============================================================================

JOB_STATUS_PAUSED = 0x00000001
JOB_STATUS_ERROR = 0x00000002
JOB_STATUS_DELETING = 0x00000004
JOB_STATUS_SPOOLING = 0x00000008
JOB_STATUS_PRINTING = 0x00000010
JOB_STATUS_OFFLINE = 0x00000020
JOB_STATUS_PAPEROUT = 0x00000040
JOB_STATUS_PRINTED = 0x00000080
JOB_STATUS_DELETED = 0x00000100
JOB_STATUS_BLOCKED_DEVQ = 0x00000200
JOB_STATUS_USER_INTERVENTION = 0x00000400
JOB_STATUS_RESTART = 0x00000800
JOB_STATUS_COMPLETE = 0x00001000
JOB_STATUS_RETAINED = 0x00002000
JOB_STATUS_RENDERING_LOCALLY = 0x00004000

PRINTER_STATUS_PAUSED = 0x00000001
PRINTER_STATUS_ERROR = 0x00000002
PRINTER_STATUS_PENDING_DELETION = 0x00000004
PRINTER_STATUS_PAPER_JAM = 0x00000008
PRINTER_STATUS_PAPER_OUT = 0x00000010
PRINTER_STATUS_MANUAL_FEED = 0x00000020
PRINTER_STATUS_PAPER_PROBLEM = 0x00000040
PRINTER_STATUS_OFFLINE = 0x00000080
PRINTER_STATUS_DOOR_OPEN = 0x00400000


# ==============================================================================
# Spooler Outcome Enum and Status Models
# ==============================================================================


class SpoolerOutcome(StrEnum):
    """Categorized outcome of a Windows Spooler print job."""

    ACCEPTED_BY_SPOOLER = "accepted_by_spooler"  # Initial state: handed off to spooler
    SPOOLING = "spooling"                        # Job data actively spooling to local disk
    PRINTING = "printing"                        # Spooler actively transferring data to printer
    COMPLETED = "completed"                      # Spooler confirmed complete / job finished cleanly
    FAILED = "failed"                            # Explicit driver error (jam, offline, out of paper)
    UNKNOWN = "unknown"                          # Disappeared prematurely or watchdog timeout expired


@dataclass(frozen=True)
class JobStatusInfo:
    """Detailed observation snapshot of a Windows spooler job."""

    job_id: int
    printer_name: str
    outcome: SpoolerOutcome
    raw_status_flags: int = 0
    status_reasons: tuple[str, ...] = ()
    pages_printed: int = 0
    total_pages: int = 0
    is_terminal: bool = False
    failure_reason: str | None = None
    can_auto_reprint: bool = False  # Always False for unknown outcomes to prevent paper waste
    observed_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        """Convert into a JSON-serializable dictionary for cloud synchronization."""
        return {
            "job_id": self.job_id,
            "printer_name": self.printer_name,
            "outcome": str(self.outcome),
            "is_terminal": self.is_terminal,
            "raw_status_flags": self.raw_status_flags,
            "status_reasons": list(self.status_reasons),
            "pages_printed": self.pages_printed,
            "total_pages": self.total_pages,
            "failure_reason": self.failure_reason,
            "can_auto_reprint": self.can_auto_reprint,
            "observed_at": self.observed_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }


# ==============================================================================
# Spooler Query Adapter Protocol & Implementations
# ==============================================================================


@runtime_checkable
class Win32JobQueryAdapter(Protocol):
    """Protocol for querying Windows Spooler jobs and printer status."""

    def get_job(self, printer_name: str, job_id: int) -> dict[str, Any] | None:
        """Retrieve JOB_INFO_2 structure for a specific job, or None if not found."""
        ...

    def enum_jobs(self, printer_name: str) -> list[dict[str, Any]]:
        """List active jobs currently queued on the specified printer."""
        ...

    def get_printer_status(self, printer_name: str) -> int:
        """Retrieve PRINTER_STATUS_* bitmask for the target printer."""
        ...


class FakeWin32JobQueryAdapter:
    """Deterministic in-memory mock job query adapter for unit and edge-case testing."""

    def __init__(self) -> None:
        # Key: (printer_name, job_id) -> dict[str, Any]
        self._jobs: dict[tuple[str, int], dict[str, Any]] = {}
        self._printer_status: dict[str, int] = {}

    def set_job(
        self,
        printer_name: str,
        job_id: int,
        status_flags: int = 0,
        pages_printed: int = 0,
        total_pages: int = 1,
        p_status: str | None = None,
    ) -> None:
        """Configure or update a mock job in the simulated spooler queue."""
        self._jobs[(printer_name, job_id)] = {
            "JobId": job_id,
            "pPrinterName": printer_name,
            "Status": status_flags,
            "pStatus": p_status or "",
            "PagesPrinted": pages_printed,
            "TotalPages": total_pages,
        }

    def remove_job(self, printer_name: str, job_id: int) -> None:
        """Simulate a job disappearing from the spooler queue."""
        self._jobs.pop((printer_name, job_id), None)

    def set_printer_status(self, printer_name: str, status_flags: int) -> None:
        """Set simulated hardware PRINTER_STATUS_* flags."""
        self._printer_status[printer_name] = status_flags

    def get_job(self, printer_name: str, job_id: int) -> dict[str, Any] | None:
        return self._jobs.get((printer_name, job_id))

    def enum_jobs(self, printer_name: str) -> list[dict[str, Any]]:
        return [job for (p_name, _), job in self._jobs.items() if p_name == printer_name]

    def get_printer_status(self, printer_name: str) -> int:
        return self._printer_status.get(printer_name, 0)


class PyWin32JobQueryAdapter:
    """Production Windows Spooler query adapter using pywin32 (win32print)."""

    def get_job(self, printer_name: str, job_id: int) -> dict[str, Any] | None:
        try:
            import win32print
        except ImportError as err:
            raise RuntimeError(
                "pywin32 is not installed. Use FakeWin32JobQueryAdapter for non-Windows environments."
            ) from err

        h_printer = win32print.OpenPrinter(printer_name)
        try:
            # Query JOB_INFO_2
            return win32print.GetJob(h_printer, job_id, 2)
        except Exception as err:
            # Error 87 (ERROR_INVALID_PARAMETER) or Error 2 (ERROR_FILE_NOT_FOUND) indicates job completed/disappeared
            logger.debug("GetJob(%s, %d) returned error: %s", printer_name, job_id, err)
            return None
        finally:
            win32print.ClosePrinter(h_printer)

    def enum_jobs(self, printer_name: str) -> list[dict[str, Any]]:
        try:
            import win32print
        except ImportError as err:
            raise RuntimeError("pywin32 is not installed.") from err

        h_printer = win32print.OpenPrinter(printer_name)
        try:
            # EnumJobs level 2
            jobs = win32print.EnumJobs(h_printer, 0, 100, 2)
            return list(jobs)
        except Exception as err:
            logger.debug("EnumJobs failed for '%s': %s", printer_name, err)
            return []
        finally:
            win32print.ClosePrinter(h_printer)

    def get_printer_status(self, printer_name: str) -> int:
        try:
            import win32print
        except ImportError as err:
            raise RuntimeError("pywin32 is not installed.") from err

        h_printer = win32print.OpenPrinter(printer_name)
        try:
            printer_info = win32print.GetPrinter(h_printer, 2)
            return int(printer_info.get("Status", 0))
        except Exception as err:
            logger.debug("GetPrinter status failed for '%s': %s", printer_name, err)
            return 0
        finally:
            win32print.ClosePrinter(h_printer)


# ==============================================================================
# Spooler Monitor Service
# ==============================================================================


class SpoolerMonitor:
    """Monitors and classifies Windows Spooler print job outcomes.

    Provides deterministic classification of the Windows Spooler lifecycle:
    1. Active states: SPOOLING, PRINTING
    2. Terminal success: COMPLETED (explicitly confirmed or clean post-print disappearance)
    3. Terminal failure: FAILED (paper jam, out-of-paper, driver error, offline)
    4. Guarded unknown: UNKNOWN (vanished without printing or watchdog timeout; NEVER auto-reprints)
    """

    def __init__(self, adapter: Win32JobQueryAdapter | None = None) -> None:
        if adapter is not None:
            self._adapter = adapter
        else:
            try:
                self._adapter = PyWin32JobQueryAdapter()
            except Exception:
                self._adapter = FakeWin32JobQueryAdapter()

    @property
    def adapter(self) -> Win32JobQueryAdapter:
        return self._adapter

    def classify_status(
        self,
        job_info: dict[str, Any] | None,
        printer_name: str,
        job_id: int,
        previous_state: JobStatusInfo | None = None,
    ) -> JobStatusInfo:
        """Classify a raw spooler job snapshot into structured JobStatusInfo.

        Handles:
        - Active spooler bitmasks (JOB_STATUS_PRINTING, JOB_STATUS_SPOOLING, etc.)
        - Hardware errors reported via JOB_STATUS_* or PRINTER_STATUS_*
        - The Windows 'disappearing job' puzzle: distinguishing successful print completion
          from premature aborts or cancellations.
        """
        # 1. Job disappeared from queue (GetJob returned None)
        if job_info is None:
            printer_status = self._adapter.get_printer_status(printer_name)

            # Check if printer is currently in a severe error state
            if printer_status & (PRINTER_STATUS_PAPER_JAM | PRINTER_STATUS_ERROR):
                return JobStatusInfo(
                    job_id=job_id,
                    printer_name=printer_name,
                    outcome=SpoolerOutcome.FAILED,
                    is_terminal=True,
                    failure_reason="Job removed while printer was in paper jam / error state.",
                    can_auto_reprint=False,
                )
            if printer_status & (PRINTER_STATUS_PAPER_OUT | PRINTER_STATUS_PAPER_PROBLEM):
                return JobStatusInfo(
                    job_id=job_id,
                    printer_name=printer_name,
                    outcome=SpoolerOutcome.FAILED,
                    is_terminal=True,
                    failure_reason="Job removed while printer was out of paper.",
                    can_auto_reprint=False,
                )

            # Analyze previous observed state to determine clean completion vs unknown abort
            if previous_state is not None:
                # If we previously observed it actively printing, printed, or completed
                if previous_state.outcome in (SpoolerOutcome.PRINTING, SpoolerOutcome.COMPLETED):
                    return JobStatusInfo(
                        job_id=job_id,
                        printer_name=printer_name,
                        outcome=SpoolerOutcome.COMPLETED,
                        pages_printed=previous_state.pages_printed,
                        total_pages=previous_state.total_pages,
                        is_terminal=True,
                        status_reasons=("Job despooled and cleared queue cleanly.",),
                    )
                # If it was in an active failure state previously
                if previous_state.outcome == SpoolerOutcome.FAILED:
                    return JobStatusInfo(
                        job_id=job_id,
                        printer_name=printer_name,
                        outcome=SpoolerOutcome.FAILED,
                        is_terminal=True,
                        failure_reason=previous_state.failure_reason or "Job failed before clearing queue.",
                        can_auto_reprint=False,
                    )

            # Job disappeared before active printing was verified or without prior observation
            logger.warning(
                "Job ID %d on printer '%s' disappeared from queue without verified printing.",
                job_id,
                printer_name,
            )
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.UNKNOWN,
                is_terminal=True,
                failure_reason="Job disappeared from spooler queue before printing confirmation.",
                can_auto_reprint=False,  # Enforce non-negotiable policy #5: never auto-reprint unknown
            )

        # 2. Parse active Job Information
        raw_flags = int(job_info.get("Status", 0))
        pages_printed = int(job_info.get("PagesPrinted", 0))
        total_pages = int(job_info.get("TotalPages", 0))
        reasons: list[str] = []

        # Check explicit terminal error flags
        if raw_flags & JOB_STATUS_ERROR:
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.FAILED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                failure_reason="Spooler driver reported JOB_STATUS_ERROR.",
                pages_printed=pages_printed,
                total_pages=total_pages,
                can_auto_reprint=False,
            )
        if raw_flags & JOB_STATUS_PAPEROUT:
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.FAILED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                failure_reason="Printer out of paper (JOB_STATUS_PAPEROUT).",
                pages_printed=pages_printed,
                total_pages=total_pages,
                can_auto_reprint=False,
            )
        if raw_flags & JOB_STATUS_BLOCKED_DEVQ:
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.FAILED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                failure_reason="Device queue blocked / paper jam (JOB_STATUS_BLOCKED_DEVQ).",
                pages_printed=pages_printed,
                total_pages=total_pages,
                can_auto_reprint=False,
            )
        if raw_flags & (JOB_STATUS_DELETING | JOB_STATUS_DELETED):
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.FAILED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                failure_reason="Job deleted or cancelled in spooler.",
                pages_printed=pages_printed,
                total_pages=total_pages,
                can_auto_reprint=False,
            )
        if raw_flags & JOB_STATUS_USER_INTERVENTION:
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.FAILED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                failure_reason="User intervention required (JOB_STATUS_USER_INTERVENTION).",
                pages_printed=pages_printed,
                total_pages=total_pages,
                can_auto_reprint=False,
            )
        if raw_flags & JOB_STATUS_OFFLINE:
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.FAILED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                failure_reason="Printer offline (JOB_STATUS_OFFLINE).",
                pages_printed=pages_printed,
                total_pages=total_pages,
                can_auto_reprint=False,
            )

        # Check explicit completion flags
        if raw_flags & (JOB_STATUS_PRINTED | JOB_STATUS_COMPLETE):
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.COMPLETED,
                raw_status_flags=raw_flags,
                is_terminal=True,
                pages_printed=pages_printed or total_pages,
                total_pages=total_pages,
                status_reasons=("Job marked printed/complete by driver.",),
            )

        # Check active progress states
        if raw_flags & JOB_STATUS_PRINTING or pages_printed > 0:
            reasons.append("Job actively transferring to printer.")
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.PRINTING,
                raw_status_flags=raw_flags,
                is_terminal=False,
                pages_printed=pages_printed,
                total_pages=total_pages,
                status_reasons=tuple(reasons),
            )

        if raw_flags & (JOB_STATUS_SPOOLING | JOB_STATUS_RENDERING_LOCALLY):
            reasons.append("Spooler buffering document pages.")
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.SPOOLING,
                raw_status_flags=raw_flags,
                is_terminal=False,
                pages_printed=pages_printed,
                total_pages=total_pages,
                status_reasons=tuple(reasons),
            )

        if raw_flags & JOB_STATUS_PAUSED:
            reasons.append("Job paused in spooler queue.")
            return JobStatusInfo(
                job_id=job_id,
                printer_name=printer_name,
                outcome=SpoolerOutcome.ACCEPTED_BY_SPOOLER,
                raw_status_flags=raw_flags,
                is_terminal=False,
                pages_printed=pages_printed,
                total_pages=total_pages,
                status_reasons=tuple(reasons),
            )

        # Default initial accepted state
        return JobStatusInfo(
            job_id=job_id,
            printer_name=printer_name,
            outcome=SpoolerOutcome.ACCEPTED_BY_SPOOLER,
            raw_status_flags=raw_flags,
            is_terminal=False,
            pages_printed=pages_printed,
            total_pages=total_pages,
            status_reasons=("Job queued in Windows Spooler.",),
        )

    def poll_job_status(
        self,
        printer_name: str,
        job_id: int,
        previous_state: JobStatusInfo | None = None,
    ) -> JobStatusInfo:
        """Poll the current status of a job in the Windows Spooler."""
        raw_info = self._adapter.get_job(printer_name, job_id)
        return self.classify_status(
            job_info=raw_info,
            printer_name=printer_name,
            job_id=job_id,
            previous_state=previous_state,
        )

    def monitor_until_terminal(
        self,
        printer_name: str,
        job_id: int,
        timeout_seconds: float = 30.0,
        poll_interval_seconds: float = 0.2,
    ) -> JobStatusInfo:
        """Monitor a spooler job until a terminal state is reached or timeout expires.

        Args:
            printer_name: Target printer name.
            job_id: Windows Spooler job ID.
            timeout_seconds: Maximum duration to watch before classifying as UNKNOWN timeout.
            poll_interval_seconds: Polling interval between status checks.

        Returns:
            Terminal JobStatusInfo (COMPLETED, FAILED, or UNKNOWN).
        """
        start_time = time.monotonic()
        current_state: JobStatusInfo | None = None

        while (time.monotonic() - start_time) < timeout_seconds:
            current_state = self.poll_job_status(
                printer_name=printer_name,
                job_id=job_id,
                previous_state=current_state,
            )

            if current_state.is_terminal:
                logger.info(
                    "Job ID %d reached terminal outcome: %s (printer: '%s')",
                    job_id,
                    current_state.outcome,
                    printer_name,
                )
                return current_state

            time.sleep(poll_interval_seconds)

        # Watchdog timeout expired without terminal confirmation
        logger.warning(
            "Watchdog timeout (%0.1fs) expired monitoring Job ID %d on '%s'.",
            timeout_seconds,
            job_id,
            printer_name,
        )
        return JobStatusInfo(
            job_id=job_id,
            printer_name=printer_name,
            outcome=SpoolerOutcome.UNKNOWN,
            is_terminal=True,
            failure_reason=f"Watchdog timeout expired ({timeout_seconds:.1f}s) without terminal state.",
            can_auto_reprint=False,
            pages_printed=current_state.pages_printed if current_state else 0,
            total_pages=current_state.total_pages if current_state else 0,
        )
