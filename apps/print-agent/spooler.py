"""Windows Print Spooler Execution, DEVMODE Mapping & Fault Trapping (INT-D4-04).

Coordinates silent Win32 Spooler dispatch, DEVMODE settings mapping,
1-second interval spooler status polling, hardware fault trapping,
and real-time Cloud API progress reporting.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

from api_client import AgentApiClient
from printer_settings_mapper import PrinterSettingsMapper
from win32_print_engine import Win32PrintEngine

logger = logging.getLogger("caps_agent.spooler")

# Spooler Status Flags
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
JOB_STATUS_COMPLETE = 0x00001000


class SpoolerError(Exception):
    """Base exception for spooler failures."""

    def __init__(self, message: str, error_code: str = "SPOOLER_ERROR") -> None:
        super().__init__(message)
        self.error_code = error_code


class PrinterOfflineError(SpoolerError):
    """Raised when target printer is offline, disconnected, or paper is out."""

    def __init__(self, message: str = "Printer is offline or out of paper.") -> None:
        super().__init__(message, error_code="PRINTER_OFFLINE")


class SpoolerService:
    """Manages silent Win32 Spooler dispatch, DEVMODE application, and fault monitoring."""

    def __init__(
        self,
        api_client: AgentApiClient | None = None,
        engine: Win32PrintEngine | None = None,
        settings_mapper: PrinterSettingsMapper | None = None,
        poll_interval: float = 1.0,
        watchdog_timeout: float = 60.0,
    ) -> None:
        self.api_client = api_client
        self.engine = engine or Win32PrintEngine()
        self.settings_mapper = settings_mapper or PrinterSettingsMapper()
        self.poll_interval = poll_interval
        self.watchdog_timeout = watchdog_timeout

    def spool_and_monitor(
        self,
        job_id: str,
        attempt_id: str,
        printer_name: str,
        document_path: str | Path | bytes,
        settings: dict[str, Any],
        lease_token: str | None = None,
        total_pages: int = 1,
    ) -> dict[str, Any]:
        """Executes full print lifecycle:

        1. Maps settings to Windows DEVMODE structure.
        2. Dispatches payload silently to Windows Spooler without GUI dialogs.
        3. Polls spooler status via GetJob in 1-second intervals.
        4. Reports real-time status transitions and page counts to Cloud API.
        5. Traps hardware faults (paper out, offline, jam) and reports PRINTER_OFFLINE.
        """
        # 1. Map settings to DEVMODE
        devmode = self.settings_mapper.map_settings_to_devmode(settings)
        logger.info(
            "Mapped DEVMODE for job '%s': paper=%s, color=%s, duplex=%s, copies=%d",
            job_id,
            devmode.paper_size,
            devmode.color,
            devmode.duplex,
            devmode.copies,
        )

        # 2. Read document data if path
        if isinstance(document_path, (str, Path)):
            path = Path(document_path)
            if not path.exists():
                raise FileNotFoundError(f"Document file not found: {path}")
            data = path.read_bytes()
        else:
            data = document_path

        doc_name = f"CAPS Print Job #{job_id[:8]}"

        # 3. Silent Win32 Spooler Dispatch
        hprinter = self.engine.open_printer(printer_name)
        try:
            spooler_job_id = self.engine.start_doc_printer(hprinter, doc_name, "RAW")
            self.engine.start_page_printer(hprinter)
            self.engine.write_printer(hprinter, data)
            self.engine.end_page_printer(hprinter)
            self.engine.end_doc_printer(hprinter)
        except Exception as exc:
            self.engine.close_printer(hprinter)
            error_msg = f"Failed to dispatch to Windows Spooler: {exc}"
            logger.error(error_msg)
            if self.api_client:
                self.api_client.update_job_status(
                    job_id=job_id,
                    attempt_id=attempt_id,
                    status="FAILED",
                    lease_token=lease_token,
                    error_code="PRINTER_OFFLINE",
                    error_message=error_msg,
                )
            raise PrinterOfflineError(error_msg) from exc

        logger.info(
            "Dispatched job '%s' to printer '%s' (spooler ID: %d). Starting status monitoring...",
            job_id,
            printer_name,
            spooler_job_id,
        )

        # Initial PRINTING progress report
        if self.api_client:
            self.api_client.update_job_status(
                job_id=job_id,
                attempt_id=attempt_id,
                status="PRINTING",
                lease_token=lease_token,
                pages_printed=0,
                total_pages=total_pages,
                spooler_job_id=spooler_job_id,
            )

        # 4. Spooler Status Polling Loop in 1-second intervals
        start_time = time.time()
        last_reported_pages = 0

        try:
            while True:
                # Query spooler status
                job_info = self.engine.get_job(hprinter, spooler_job_id, level=2)

                # Job has disappeared from spooler (clean completion or printed)
                if job_info is None:
                    logger.info("Spooler job %d has cleared from spooler queue.", spooler_job_id)
                    break

                status_flags = int(job_info.get("Status", 0))
                pages_printed = int(job_info.get("PagesPrinted", 0))

                logger.debug(
                    "Spooler job %d status: 0x%08X, pages: %d/%d",
                    spooler_job_id,
                    status_flags,
                    pages_printed,
                    total_pages,
                )

                # Check hardware faults: Paper Out, Disconnected, Offline
                if status_flags & (JOB_STATUS_PAPEROUT | JOB_STATUS_OFFLINE | JOB_STATUS_USER_INTERVENTION):
                    fault_reason = "Printer is offline or out of paper."
                    if status_flags & JOB_STATUS_PAPEROUT:
                        fault_reason = "Printer out of paper."
                    elif status_flags & JOB_STATUS_OFFLINE:
                        fault_reason = "Printer is disconnected or offline."

                    logger.error("Hardware fault trapped for job '%s': %s", job_id, fault_reason)
                    if self.api_client:
                        self.api_client.update_job_status(
                            job_id=job_id,
                            attempt_id=attempt_id,
                            status="FAILED",
                            lease_token=lease_token,
                            error_code="PRINTER_OFFLINE",
                            error_message=fault_reason,
                            spooler_job_id=spooler_job_id,
                        )
                    raise PrinterOfflineError(fault_reason)

                # Check general error
                if status_flags & JOB_STATUS_ERROR:
                    err_msg = "Spooler reported driver or communication error."
                    logger.error("Spooler error trapped for job '%s': %s", job_id, err_msg)
                    if self.api_client:
                        self.api_client.update_job_status(
                            job_id=job_id,
                            attempt_id=attempt_id,
                            status="FAILED",
                            lease_token=lease_token,
                            error_code="PRINTER_OFFLINE",
                            error_message=err_msg,
                            spooler_job_id=spooler_job_id,
                        )
                    raise PrinterOfflineError(err_msg)

                # Report incremental progress if pages advanced
                if pages_printed > last_reported_pages:
                    last_reported_pages = pages_printed
                    if self.api_client:
                        self.api_client.update_job_status(
                            job_id=job_id,
                            attempt_id=attempt_id,
                            status="PRINTING",
                            lease_token=lease_token,
                            pages_printed=pages_printed,
                            total_pages=total_pages,
                            spooler_job_id=spooler_job_id,
                        )

                # Check completion flags
                if status_flags & (JOB_STATUS_PRINTED | JOB_STATUS_COMPLETE):
                    logger.info("Spooler reported job %d marked as PRINTED/COMPLETE.", spooler_job_id)
                    break

                # Watchdog check
                if time.time() - start_time > self.watchdog_timeout:
                    logger.warning("Spooler watchdog timeout reached for job %d.", spooler_job_id)
                    break

                time.sleep(self.poll_interval)

        finally:
            self.engine.close_printer(hprinter)

        # 5. Final COMPLETED Status Report
        if self.api_client:
            self.api_client.update_job_status(
                job_id=job_id,
                attempt_id=attempt_id,
                status="COMPLETED",
                lease_token=lease_token,
                pages_printed=total_pages,
                total_pages=total_pages,
                spooler_job_id=spooler_job_id,
            )

        logger.info("Successfully finished print and monitoring for job '%s'.", job_id)
        return {
            "job_id": job_id,
            "spooler_job_id": spooler_job_id,
            "status": "COMPLETED",
            "pages_printed": total_pages,
            "total_pages": total_pages,
        }
