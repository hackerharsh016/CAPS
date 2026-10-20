"""Windows Print Spooler submission for raster pages and native DEVMODE parameters.

Part of CAPS Windows Print Feasibility (Phase 02, Module 02).
Responsible for:
- Submitting rasterized pages to the Windows Spooler dialog-free
- Applying driver parameters (DEVMODE) during printer handle acquisition
- Executing StartDocPrinter / StartPagePrinter / WritePrinter / EndPagePrinter / EndDocPrinter
- Capturing the Windows spooler job ID for downstream lifecycle tracking
- Translating spooler errors (access denied, printer offline, write failures) into structured exceptions
- Providing pluggable Spooler adapters for native win32print and deterministic in-memory mock testing
"""

from __future__ import annotations

import contextlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

from caps_agent.printing.engine import PrintResult
from caps_agent.printing.pdf_renderer import RenderedPage
from caps_agent.printing.settings_mapper import NativePrintParameters

logger = logging.getLogger("caps_agent.printing.windows_spooler")


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class SpoolerError(Exception):
    """Base exception for all Windows Spooler submission errors."""


class PrinterAccessDeniedError(SpoolerError):
    """Raised when spooler permissions prevent opening or writing to the printer."""


class PrinterOfflineError(SpoolerError):
    """Raised when the target printer is paused, disconnected, or marked offline."""


class SpoolerSubmissionError(SpoolerError):
    """Raised when a spooler API call (StartDocPrinter, WritePrinter, etc.) fails."""


class InvalidJobDataError(SpoolerError):
    """Raised when submitted job data or raster payload is empty or invalid."""


# ==============================================================================
# Job Submission Data Models
# ==============================================================================


@dataclass(frozen=True)
class SpoolerJobSubmission:
    """Encapsulates a complete print job ready for Windows Spooler transmission."""

    job_title: str
    printer_name: str
    pages: list[RenderedPage]
    parameters: NativePrintParameters
    data_type: str = "RAW"


@dataclass(frozen=True)
class SpoolerSubmissionResult:
    """Outcome of submission to the local OS print subsystem."""

    accepted: bool
    spooler_job_id: int | None
    printer_name: str
    job_title: str
    pages_submitted: int
    total_bytes_written: int
    submission_timestamp: datetime
    error: str | None = None

    def to_print_result(self) -> PrintResult:
        """Convert into the internal PrintResult protocol dataclass."""
        return PrintResult(
            accepted=self.accepted,
            spooler_job_id=self.spooler_job_id,
            error=self.error,
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert into a JSON-serializable dictionary for audit and tracking."""
        return {
            "accepted": self.accepted,
            "spooler_job_id": self.spooler_job_id,
            "printer_name": self.printer_name,
            "job_title": self.job_title,
            "pages_submitted": self.pages_submitted,
            "total_bytes_written": self.total_bytes_written,
            "submission_timestamp": self.submission_timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "error": self.error,
        }


# ==============================================================================
# Spooler Adapter Protocol & Implementations
# ==============================================================================


@runtime_checkable
class Win32SpoolerAdapter(Protocol):
    """Protocol for abstracting low-level Windows Spooler API calls."""

    def open_printer(self, printer_name: str, devmode: Any = None) -> Any:
        ...

    def start_doc_printer(self, h_printer: Any, job_title: str, data_type: str = "RAW") -> int:
        ...

    def start_page_printer(self, h_printer: Any) -> None:
        ...

    def write_printer(self, h_printer: Any, data: bytes) -> int:
        ...

    def end_page_printer(self, h_printer: Any) -> None:
        ...

    def end_doc_printer(self, h_printer: Any) -> None:
        ...

    def close_printer(self, h_printer: Any) -> None:
        ...


class FakeWin32SpoolerAdapter:
    """Deterministic in-memory mock spooler adapter for unit and contract testing."""

    def __init__(self, starting_job_id: int = 1001) -> None:
        self._next_job_id = starting_job_id
        self.submitted_jobs: list[dict[str, Any]] = []
        self._open_handles: dict[int, dict[str, Any]] = {}
        self._handle_counter = 1

        # Failure injection flags for testing edge cases
        self.simulate_access_denied = False
        self.simulate_offline = False
        self.simulate_write_failure = False
        self.simulate_zero_job_id = False

    def open_printer(self, printer_name: str, devmode: Any = None) -> int:
        if self.simulate_access_denied:
            raise PermissionError(f"Access denied to printer '{printer_name}'. (Error 5)")
        if self.simulate_offline:
            raise ConnectionError(f"Printer '{printer_name}' is currently offline.")

        handle = self._handle_counter
        self._handle_counter += 1
        self._open_handles[handle] = {
            "printer_name": printer_name,
            "devmode": devmode,
            "job_id": None,
            "pages": [],
            "current_page": None,
            "in_doc": False,
            "in_page": False,
        }
        return handle

    def start_doc_printer(self, h_printer: int, job_title: str, data_type: str = "RAW") -> int:
        if h_printer not in self._open_handles:
            raise ValueError(f"Invalid printer handle: {h_printer}")
        if self.simulate_zero_job_id:
            return 0

        job_info = self._open_handles[h_printer]
        job_id = self._next_job_id
        self._next_job_id += 1

        job_info["job_id"] = job_id
        job_info["job_title"] = job_title
        job_info["data_type"] = data_type
        job_info["in_doc"] = True
        return job_id

    def start_page_printer(self, h_printer: int) -> None:
        if h_printer not in self._open_handles:
            raise ValueError(f"Invalid printer handle: {h_printer}")
        job_info = self._open_handles[h_printer]
        if not job_info["in_doc"]:
            raise RuntimeError("Cannot start page before StartDocPrinter.")

        job_info["in_page"] = True
        job_info["current_page"] = bytearray()

    def write_printer(self, h_printer: int, data: bytes) -> int:
        if h_printer not in self._open_handles:
            raise ValueError(f"Invalid printer handle: {h_printer}")
        if self.simulate_write_failure:
            raise OSError("Simulated spooler pipe broken / write failure.")

        job_info = self._open_handles[h_printer]
        if not job_info["in_page"]:
            raise RuntimeError("Cannot write data before StartPagePrinter.")

        job_info["current_page"].extend(data)
        return len(data)

    def end_page_printer(self, h_printer: int) -> None:
        if h_printer not in self._open_handles:
            raise ValueError(f"Invalid printer handle: {h_printer}")
        job_info = self._open_handles[h_printer]
        if not job_info["in_page"]:
            raise RuntimeError("Cannot end page that was not started.")

        job_info["pages"].append(bytes(job_info["current_page"]))
        job_info["current_page"] = None
        job_info["in_page"] = False

    def end_doc_printer(self, h_printer: int) -> None:
        if h_printer not in self._open_handles:
            raise ValueError(f"Invalid printer handle: {h_printer}")
        job_info = self._open_handles[h_printer]
        job_info["in_doc"] = False

        record = {
            "job_id": job_info["job_id"],
            "job_title": job_info.get("job_title"),
            "printer_name": job_info["printer_name"],
            "page_count": len(job_info["pages"]),
            "total_bytes": sum(len(p) for p in job_info["pages"]),
            "pages_data": list(job_info["pages"]),
            "devmode": job_info.get("devmode"),
        }
        self.submitted_jobs.append(record)

    def close_printer(self, h_printer: int) -> None:
        self._open_handles.pop(h_printer, None)


class PyWin32SpoolerAdapter:
    """Production Windows Spooler adapter using pywin32 (win32print)."""

    def open_printer(self, printer_name: str, devmode: Any = None) -> Any:
        try:
            import win32print
        except ImportError as err:
            raise RuntimeError(
                "pywin32 is not installed. Use FakeWin32SpoolerAdapter for non-Windows environments."
            ) from err

        open_params: dict[str, Any] = {"DesiredAccess": win32print.PRINTER_ACCESS_USE}
        if devmode is not None:
            open_params["pDevMode"] = devmode

        return win32print.OpenPrinter(printer_name, open_params)

    def start_doc_printer(self, h_printer: Any, job_title: str, data_type: str = "RAW") -> int:
        import win32print

        doc_info = (job_title, None, data_type)
        job_id = win32print.StartDocPrinter(h_printer, 1, doc_info)
        return int(job_id)

    def start_page_printer(self, h_printer: Any) -> None:
        import win32print

        win32print.StartPagePrinter(h_printer)

    def write_printer(self, h_printer: Any, data: bytes) -> int:
        import win32print

        return int(win32print.WritePrinter(h_printer, data))

    def end_page_printer(self, h_printer: Any) -> None:
        import win32print

        win32print.EndPagePrinter(h_printer)

    def end_doc_printer(self, h_printer: Any) -> None:
        import win32print

        win32print.EndDocPrinter(h_printer)

    def close_printer(self, h_printer: Any) -> None:
        import win32print

        win32print.ClosePrinter(h_printer)


# ==============================================================================
# Windows Spooler Submission Service
# ==============================================================================


class WindowsSpooler:
    """Submits rasterized document pages and DEVMODE settings to Windows Spooler.

    Encapsulates lifecycle boundaries:
    - Dialog-free submission without raw PDF driver assumptions
    - Guaranteed cleanup of OS printer handles and spool files
    - Explicit spooler job ID capture for downstream state tracking
    """

    def __init__(self, adapter: Win32SpoolerAdapter | None = None) -> None:
        if adapter is not None:
            self._adapter = adapter
        else:
            try:
                self._adapter = PyWin32SpoolerAdapter()
            except Exception:
                self._adapter = FakeWin32SpoolerAdapter()

    @property
    def adapter(self) -> Win32SpoolerAdapter:
        return self._adapter

    def submit_job(self, submission: SpoolerJobSubmission) -> SpoolerSubmissionResult:
        """Submit a raster job to the target Windows printer spooler.

        Args:
            submission: Complete job description including pages and DEVMODE.

        Returns:
            SpoolerSubmissionResult detailing acceptance and spooler job ID.

        Raises:
            PrinterAccessDeniedError: If the process lacks permissions to the spooler.
            PrinterOfflineError: If the printer is unreachable or offline.
            SpoolerSubmissionError: If a spooler API failure occurs.
            InvalidJobDataError: If submission payload is empty.
        """
        printer_name = submission.printer_name.strip()
        if not printer_name:
            raise InvalidJobDataError("Printer name cannot be empty.")
        if not submission.pages:
            raise InvalidJobDataError("Cannot submit print job with 0 pages.")

        job_title = submission.job_title.strip() or "CAPS Print Document"
        timestamp = datetime.now(UTC)

        # 1. Acquire printer handle with DEVMODE attached
        try:
            h_printer = self._adapter.open_printer(
                printer_name=printer_name,
                devmode=submission.parameters.devmode.to_dict(),
            )
        except PermissionError as err:
            logger.error("Access denied opening printer '%s': %s", printer_name, err)
            raise PrinterAccessDeniedError(f"Access denied for printer '{printer_name}': {err}") from err
        except (ConnectionError, OSError) as err:
            logger.error("Printer '%s' is unavailable or offline: %s", printer_name, err)
            raise PrinterOfflineError(f"Printer '{printer_name}' offline/unavailable: {err}") from err
        except Exception as err:
            logger.error("Failed to open printer '%s': %s", printer_name, err)
            raise SpoolerSubmissionError(f"OpenPrinter failed for '{printer_name}': {err}") from err

        in_doc = False
        in_page = False
        pages_written = 0
        total_bytes = 0
        spooler_job_id: int | None = None

        try:
            # 2. Start print document
            spooler_job_id = self._adapter.start_doc_printer(
                h_printer=h_printer,
                job_title=job_title,
                data_type=submission.data_type,
            )

            if not spooler_job_id or spooler_job_id <= 0:
                raise SpoolerSubmissionError(
                    f"StartDocPrinter returned invalid job ID ({spooler_job_id})."
                )
            in_doc = True
            logger.info(
                "Started Spooler Job ID %d for '%s' on printer '%s'",
                spooler_job_id,
                job_title,
                printer_name,
            )

            # 3. Stream each raster page into the spooler
            for page in submission.pages:
                self._adapter.start_page_printer(h_printer)
                in_page = True

                written = self._adapter.write_printer(h_printer, page.image_bytes)
                total_bytes += written

                self._adapter.end_page_printer(h_printer)
                in_page = False
                pages_written += 1

            # 4. Finalize document
            self._adapter.end_doc_printer(h_printer)
            in_doc = False

            logger.info(
                "Spooler Job ID %d accepted: %d pages (%d bytes) written to '%s'",
                spooler_job_id,
                pages_written,
                total_bytes,
                printer_name,
            )

            return SpoolerSubmissionResult(
                accepted=True,
                spooler_job_id=spooler_job_id,
                printer_name=printer_name,
                job_title=job_title,
                pages_submitted=pages_written,
                total_bytes_written=total_bytes,
                submission_timestamp=timestamp,
            )

        except Exception as err:
            logger.error("Spooler submission failed on '%s': %s", printer_name, err)

            # Attempt graceful abort if doc was started
            if in_page:
                with contextlib.suppress(Exception):
                    self._adapter.end_page_printer(h_printer)
            if in_doc:
                with contextlib.suppress(Exception):
                    self._adapter.end_doc_printer(h_printer)

            if isinstance(err, SpoolerError):
                raise
            raise SpoolerSubmissionError(
                f"Error writing job '{job_title}' to spooler '{printer_name}': {err}"
            ) from err

        finally:
            try:
                self._adapter.close_printer(h_printer)
            except Exception as close_err:
                logger.debug("Failed closing printer handle: %s", close_err)

    def submit_raster_pages(
        self,
        printer_name: str,
        pages: list[RenderedPage],
        parameters: NativePrintParameters,
        job_title: str = "CAPS Print Job",
    ) -> SpoolerSubmissionResult:
        """Convenience method to package and submit rendered raster pages."""
        submission = SpoolerJobSubmission(
            job_title=job_title,
            printer_name=printer_name,
            pages=pages,
            parameters=parameters,
        )
        return self.submit_job(submission)
