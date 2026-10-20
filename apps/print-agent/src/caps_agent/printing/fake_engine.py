"""In-memory test fake for the PrintEngine protocol.

Enables developer iteration, CI test runners, and multi-developer parallel testing
without requiring physical Windows printers or pywin32 OS drivers.

Supports comprehensive simulation of:
- Happy-path submissions with incrementing spooler job IDs
- Custom simulated failures and error codes
- Printer readiness checks (no paper, paper jam, offline, missing printer)
- Multi-tenant / shop authorization enforcement
- Document validation failures (corrupted PDF, unreadable header)
- Unsupported print settings rejections
- Idempotency & duplicate/replayed call handling
- Spooler disconnection and reconnect error modeling
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from caps_agent.printing.engine import (
    DocumentValidationError,
    PrintEngine,
    PrintEngineError,
    PrinterNotFoundError,
    PrinterOfflineError,
    PrinterPaperJamError,
    PrinterPaperOutError,
    PrintResult,
    PrintSettings,
    ShopAuthorizationError,
    SpoolerError,
    UnsupportedSettingError,
)

logger = logging.getLogger("caps_agent.printing.fake_engine")


@dataclass
class FakePrintEngine(PrintEngine):
    """Test fake modeling spooler submission without generating physical output."""

    should_succeed: bool = True
    simulated_spooler_job_id: int = 1001
    simulated_error: str | None = None
    simulated_error_code: str | None = None
    raise_on_error: bool = False

    configured_printers: set[str] | list[str] | None = None
    authorized_shops: dict[str, set[str] | list[str]] | None = None
    offline_printers: set[str] = field(default_factory=set)
    no_paper_printers: set[str] = field(default_factory=set)
    paper_jam_printers: set[str] = field(default_factory=set)
    unsupported_settings: dict[str, set[str] | list[str]] = field(default_factory=dict)
    simulate_validation_failure: bool = False
    simulate_spooler_disconnect: bool = False

    submission_log: list[dict[str, Any]] = field(default_factory=list)
    recorded_attempts: dict[str, PrintResult] = field(default_factory=dict)

    def print_document(
        self,
        pdf_path: Path | str,
        printer_name: str,
        settings: PrintSettings,
        job_title: str | None = None,
        attempt_id: str | None = None,
        shop_id: str | None = None,
    ) -> PrintResult:
        """Process simulated print request and return structured PrintResult."""
        doc_path = Path(pdf_path)
        title = job_title or f"CAPS Print {doc_path.name}"

        # 1. Log invocation
        self.submission_log.append({
            "pdf_path": str(doc_path),
            "printer_name": printer_name,
            "settings": settings,
            "job_title": title,
            "attempt_id": attempt_id,
            "shop_id": shop_id,
        })

        # 2. Duplicate / Replayed Attempt Handling (Idempotency)
        if attempt_id and attempt_id in self.recorded_attempts:
            logger.info("FakePrintEngine: Duplicate attempt '%s' returning recorded result.", attempt_id)
            return self.recorded_attempts[attempt_id]

        # 3. Shop / Tenant Authorization Check
        if shop_id and self.authorized_shops is not None:
            allowed = set(self.authorized_shops.get(shop_id, set()))
            if printer_name not in allowed:
                err = ShopAuthorizationError(
                    f"Printer '{printer_name}' is not authorized for shop '{shop_id}'.",
                    details={"printer_name": printer_name, "shop_id": shop_id},
                )
                return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 4. Document Validation Simulation
        if self.simulate_validation_failure:
            err = DocumentValidationError(
                f"Simulated validation failure for document '{doc_path.name}'.",
                details={"doc_path": str(doc_path)},
            )
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 5. Printer Discovery Check
        if self.configured_printers is not None:
            configured_set = set(self.configured_printers)
            if printer_name not in configured_set:
                err = PrinterNotFoundError(
                    f"Printer '{printer_name}' not found on host system.",
                    details={"printer_name": printer_name},
                )
                return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 6. Printer Hardware Error Simulation
        if printer_name in self.offline_printers:
            err = PrinterOfflineError(
                f"Printer '{printer_name}' is offline or disconnected.",
                details={"printer_name": printer_name},
            )
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        if printer_name in self.no_paper_printers:
            err = PrinterPaperOutError(
                f"Printer '{printer_name}' is out of paper in all trays.",
                details={"printer_name": printer_name},
            )
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        if printer_name in self.paper_jam_printers:
            err = PrinterPaperJamError(
                f"Printer '{printer_name}' has an active paper jam.",
                details={"printer_name": printer_name},
            )
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 7. Unsupported Settings Simulation
        if printer_name in self.unsupported_settings:
            unsupported = set(self.unsupported_settings[printer_name])
            if (
                settings.color_mode.lower() in unsupported
                or settings.paper_size.lower() in unsupported
                or (isinstance(settings.duplex, bool) and settings.duplex and "duplex" in unsupported)
                or (isinstance(settings.duplex, str) and settings.duplex.lower() in unsupported)
            ):
                err = UnsupportedSettingError(
                    f"Printer '{printer_name}' does not support requested settings.",
                    details={"printer_name": printer_name, "settings": str(settings)},
                )
                return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 8. Spooler Disconnection Simulation
        if self.simulate_spooler_disconnect:
            err = SpoolerError(
                "Windows Spooler RPC service unreachable.",
                error_code="SPOOLER_DISCONNECTED",
                details={"printer_name": printer_name},
            )
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 9. Generic Configured Failure
        if not self.should_succeed:
            err_msg = self.simulated_error or "Simulated hardware error"
            err_code = self.simulated_error_code or "SIMULATED_FAILURE"
            err = PrintEngineError(err_msg, error_code=err_code)
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

        # 10. Happy Path: Spooler Acceptance
        job_id = self.simulated_spooler_job_id
        self.simulated_spooler_job_id += 1
        now_iso = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

        result = PrintResult(
            accepted=True,
            spooler_job_id=job_id,
            error=None,
            error_code=None,
            pages_submitted=1,
            total_bytes_written=4096,
            printer_name=printer_name,
            job_title=title,
            submission_timestamp=now_iso,
            attempt_id=attempt_id,
            can_auto_reprint=False,
        )

        if attempt_id:
            self.recorded_attempts[attempt_id] = result

        return result

    def _handle_error(
        self,
        err: PrintEngineError,
        attempt_id: str | None = None,
        printer_name: str | None = None,
    ) -> PrintResult:
        """Handle simulated error according to raise_on_error configuration."""
        if self.raise_on_error:
            raise err

        result = PrintResult(
            accepted=False,
            spooler_job_id=None,
            error=err.message,
            error_code=err.error_code,
            printer_name=printer_name,
            attempt_id=attempt_id,
            can_auto_reprint=False,
        )

        if attempt_id:
            self.recorded_attempts[attempt_id] = result

        return result
