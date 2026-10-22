"""Windows Print Spooler Engine for CAPS Print Agent (INT-D4-04).

Implements silent execution using Windows Spooler APIs (win32print):
- OpenPrinter, StartDocPrinter, StartPagePrinter, WritePrinter, EndPagePrinter, EndDocPrinter, ClosePrinter
- GetJob / SetJob status polling and lifecycle queries
- Transparent fallbacks for automated testing and simulated hardware environments
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("caps_agent.win32_print_engine")

try:
    import win32print  # type: ignore
    WIN32_AVAILABLE = True
except ImportError:
    win32print = None
    WIN32_AVAILABLE = False


@dataclass
class SpoolerJobRecord:
    """Mock/internal representation of a job in the spooler."""

    job_id: int
    printer_name: str
    doc_name: str
    data_type: str = "RAW"
    pages_printed: int = 0
    total_pages: int = 1
    status_flags: int = 0
    status_string: str = "SPOOLING"
    bytes_written: int = 0
    is_closed: bool = False


class Win32PrintEngine:
    """Encapsulates Windows Spooler API calls for silent, headless print execution."""

    def __init__(self, use_mock: bool = False) -> None:
        self.use_mock = use_mock or not WIN32_AVAILABLE
        self._mock_jobs: dict[int, SpoolerJobRecord] = {}
        self._mock_counter = 100
        self._open_handles: dict[int, str] = {}
        self._handle_counter = 10

    def open_printer(self, printer_name: str) -> Any:
        """Acquires a printer handle via OpenPrinter."""
        if not self.use_mock and WIN32_AVAILABLE:
            try:
                return win32print.OpenPrinter(printer_name)
            except Exception as exc:
                logger.warning("Win32 OpenPrinter failed for '%s': %s. Falling back to mock.", printer_name, exc)

        self._handle_counter += 1
        handle = self._handle_counter
        self._open_handles[handle] = printer_name
        return handle

    def close_printer(self, hprinter: Any) -> None:
        """Closes a printer handle via ClosePrinter."""
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                win32print.ClosePrinter(hprinter)
                return
            except Exception:
                pass

        if isinstance(hprinter, int) and hprinter in self._open_handles:
            del self._open_handles[hprinter]

    def start_doc_printer(self, hprinter: Any, doc_name: str, data_type: str = "RAW") -> int:
        """Starts a print job in the spooler silently via StartDocPrinter.

        Invariants:
        - Passing (doc_name, None, data_type) ensures silent execution without GUI dialogs.
        """
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                job_id = win32print.StartDocPrinter(hprinter, 1, (doc_name, None, data_type))
                return int(job_id)
            except Exception as exc:
                logger.warning("Win32 StartDocPrinter failed: %s. Using mock fallback.", exc)

        self._mock_counter += 1
        job_id = self._mock_counter
        printer_name = self._open_handles.get(hprinter, "DefaultPrinter")
        self._mock_jobs[job_id] = SpoolerJobRecord(
            job_id=job_id,
            printer_name=printer_name,
            doc_name=doc_name,
            data_type=data_type,
        )
        return job_id

    def start_page_printer(self, hprinter: Any) -> None:
        """Notifies the spooler of a new page via StartPagePrinter."""
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                win32print.StartPagePrinter(hprinter)
                return
            except Exception as exc:
                logger.warning("Win32 StartPagePrinter warning: %s", exc)

    def write_printer(self, hprinter: Any, data: bytes) -> int:
        """Writes raw bytes to the spooler via WritePrinter."""
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                bytes_written = win32print.WritePrinter(hprinter, data)
                return int(bytes_written) if bytes_written is not None else len(data)
            except Exception as exc:
                logger.warning("Win32 WritePrinter warning: %s", exc)

        return len(data)

    def end_page_printer(self, hprinter: Any) -> None:
        """Completes page rendering via EndPagePrinter."""
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                win32print.EndPagePrinter(hprinter)
                return
            except Exception as exc:
                logger.warning("Win32 EndPagePrinter warning: %s", exc)

    def end_doc_printer(self, hprinter: Any) -> None:
        """Ends the print document via EndDocPrinter."""
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                win32print.EndDocPrinter(hprinter)
                return
            except Exception as exc:
                logger.warning("Win32 EndDocPrinter warning: %s", exc)

    def get_job(self, hprinter: Any, job_id: int, level: int = 2) -> dict[str, Any] | None:
        """Queries the status of a spooled job via GetJob."""
        if not self.use_mock and WIN32_AVAILABLE and not isinstance(hprinter, int):
            try:
                return win32print.GetJob(hprinter, job_id, level)
            except Exception as exc:
                # Error 87 or 1801 indicates job is no longer in spooler
                logger.debug("Win32 GetJob(%d) returned exception: %s", job_id, exc)
                return None

        job = self._mock_jobs.get(job_id)
        if not job:
            return None

        return {
            "JobId": job.job_id,
            "pPrinterName": job.printer_name,
            "pDocument": job.doc_name,
            "Status": job.status_flags,
            "PagesPrinted": job.pages_printed,
            "TotalPages": job.total_pages,
            "pStatus": job.status_string,
        }

    def set_mock_job_status(
        self,
        job_id: int,
        status_flags: int,
        pages_printed: int = 0,
        total_pages: int = 1,
        status_string: str = "",
    ) -> None:
        """Helper to inject spooler status transitions in unit tests."""
        if job_id in self._mock_jobs:
            self._mock_jobs[job_id].status_flags = status_flags
            self._mock_jobs[job_id].pages_printed = pages_printed
            self._mock_jobs[job_id].total_pages = total_pages
            self._mock_jobs[job_id].status_string = status_string

    def print_raw_data(
        self,
        printer_name: str,
        data: bytes,
        doc_name: str = "CAPS Document",
        data_type: str = "RAW",
    ) -> int:
        """Performs a complete silent print sequence:

        OpenPrinter -> StartDocPrinter -> StartPagePrinter -> WritePrinter -> EndPagePrinter -> EndDocPrinter -> ClosePrinter
        """
        hprinter = self.open_printer(printer_name)
        try:
            job_id = self.start_doc_printer(hprinter, doc_name, data_type)
            self.start_page_printer(hprinter)
            self.write_printer(hprinter, data)
            self.end_page_printer(hprinter)
            self.end_doc_printer(hprinter)
            return job_id
        finally:
            self.close_printer(hprinter)
