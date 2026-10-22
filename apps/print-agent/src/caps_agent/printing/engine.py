"""Stable internal printing interface and Windows Print Engine for CAPS Print Agent.

Defines the protocol boundary separating cloud orchestration, job dispatching,
and native Windows spooler interactions (Phase 02, Module 03).

Provides:
- PrintSettings: Dataclass for customer print specifications
- PrintResult: Structured outcome of local OS print submission
- PrintEngine: Protocol interface boundary for print engines
- WindowsPrintEngine (StandardPrintEngine): Production print engine orchestrating
  PDF validation, customer settings mapping (DEVMODE), raster rendering, and
  dialog-free Windows Spooler submission
- Typed error taxonomy for comprehensive diagnostics and failure recovery
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

logger = logging.getLogger("caps_agent.printing.engine")


# ==============================================================================
# Print Settings & Result Models
# ==============================================================================


@dataclass(frozen=True)
class PrintSettings:
    """User-selected print configuration received from Cloud API."""

    paper_size: str  # 'a4', 'a3', 'legal', etc.
    color_mode: str  # 'bw', 'color'
    duplex: bool | str  # True/False or 'simplex', 'duplex_long', 'duplex_short'
    copies: int  # 1..100
    page_range: str  # 'all' or custom comma/dash ranges like '1-5,8'
    orientation: str  # 'portrait', 'landscape'
    binding: str | None = None


@dataclass(frozen=True)
class PrintResult:
    """Outcome of submission to the local OS print subsystem.

    NOTE: accepted=True and non-null spooler_job_id indicate Windows Spooler
    acceptance, NOT proof of physical ink-on-paper completion.
    In accordance with Non-Negotiable Policy #5, can_auto_reprint is strictly False.
    """

    accepted: bool
    spooler_job_id: int | None
    error: str | None = None
    error_code: str | None = None
    pages_submitted: int = 0
    total_bytes_written: int = 0
    printer_name: str | None = None
    job_title: str | None = None
    submission_timestamp: str | None = None
    attempt_id: str | None = None
    can_auto_reprint: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert into a JSON-serializable dictionary."""
        return {
            "accepted": self.accepted,
            "spooler_job_id": self.spooler_job_id,
            "error": self.error,
            "error_code": self.error_code,
            "pages_submitted": self.pages_submitted,
            "total_bytes_written": self.total_bytes_written,
            "printer_name": self.printer_name,
            "job_title": self.job_title,
            "submission_timestamp": self.submission_timestamp,
            "attempt_id": self.attempt_id,
            "can_auto_reprint": self.can_auto_reprint,
        }


# ==============================================================================
# Typed Error Taxonomy
# ==============================================================================


class PrintEngineError(Exception):
    """Base exception for all print engine errors."""

    def __init__(
        self,
        message: str,
        error_code: str = "PRINT_ENGINE_ERROR",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details = details or {}


class DocumentNotFoundError(PrintEngineError):
    """Raised when the specified PDF file cannot be found."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="DOCUMENT_NOT_FOUND", details=details)


class DocumentValidationError(PrintEngineError):
    """Raised when the document is not a valid PDF or fails integrity checks."""

    def __init__(
        self,
        message: str,
        error_code: str = "DOCUMENT_INVALID",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message, error_code=error_code, details=details)


class DocumentCorruptedError(DocumentValidationError):
    """Raised when the PDF file structure is corrupted."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="DOCUMENT_CORRUPTED", details=details)


class DocumentPasswordProtectedError(DocumentValidationError):
    """Raised when the PDF is encrypted / password protected."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="DOCUMENT_PASSWORD_PROTECTED", details=details)


class PrinterNotFoundError(PrintEngineError):
    """Raised when the target printer is not discovered on the host system."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="PRINTER_NOT_FOUND", details=details)


class PrinterUnavailableError(PrintEngineError):
    """Raised when the target printer is in an unready state (offline, error, jam)."""

    def __init__(
        self,
        message: str,
        error_code: str = "PRINTER_UNAVAILABLE",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message, error_code=error_code, details=details)


class PrinterOfflineError(PrinterUnavailableError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="PRINTER_OFFLINE", details=details)


class PrinterPaperOutError(PrinterUnavailableError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="PRINTER_PAPER_OUT", details=details)


class PrinterPaperJamError(PrinterUnavailableError):
    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="PRINTER_PAPER_JAM", details=details)


class UnsupportedSettingError(PrintEngineError):
    """Raised when requested print settings exceed printer capabilities."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="UNSUPPORTED_SETTING", details=details)


class InvalidSettingError(PrintEngineError):
    """Raised when requested print settings values are invalid."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="INVALID_SETTING", details=details)


class InvalidPageRangeError(PrintEngineError):
    """Raised when requested page range exceeds document bounds."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="PAGE_RANGE_OUT_OF_BOUNDS", details=details)


class RenderingError(PrintEngineError):
    """Raised when rendering PDF pages to raster output fails."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="RENDERING_FAILED", details=details)


class SpoolerError(PrintEngineError):
    """Raised when Windows Spooler submission fails."""

    def __init__(
        self,
        message: str,
        error_code: str = "SPOOLER_SUBMISSION_FAILED",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message, error_code=error_code, details=details)


class DuplicateJobError(PrintEngineError):
    """Raised when an attempt ID has already been submitted or is currently in progress."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="DUPLICATE_JOB_ATTEMPT", details=details)


class ShopAuthorizationError(PrintEngineError):
    """Raised when the target printer is not authorized for the specified shop / tenant."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, error_code="FORBIDDEN_SHOP", details=details)


# ==============================================================================
# Protocol Definition
# ==============================================================================


@runtime_checkable
class PrintEngine(Protocol):
    """Protocol boundary for print engine implementations."""

    def print_document(
        self,
        pdf_path: Path,
        printer_name: str,
        settings: PrintSettings,
        job_title: str | None = None,
        attempt_id: str | None = None,
        shop_id: str | None = None,
    ) -> PrintResult:
        """Submit print work to the specified printer with settings.

        Submissions must be dialog-free and non-blocking.
        NOTE: acceptance by spooler is NOT proof of physical printing.
        """
        ...


# ==============================================================================
# Imports for Production Engine Execution
# (Placed after PrintSettings and Protocol to prevent circular dependency)
# ==============================================================================

if TYPE_CHECKING:
    from caps_agent.printing.capabilities import CapabilityDetector
    from caps_agent.printing.pdf_renderer import PdfRenderer
    from caps_agent.printing.settings_mapper import SettingsMapper
    from caps_agent.printing.spooler_monitor import SpoolerMonitor
    from caps_agent.printing.windows_spooler import WindowsSpooler


# ==============================================================================
# Production Engine Implementation
# ==============================================================================


class WindowsPrintEngine:
    """Production print engine coordinating PDF validation/rendering, DEVMODE mapping,
    and native Windows Spooler submission.
    """

    def __init__(
        self,
        pdf_renderer: PdfRenderer | None = None,
        settings_mapper: SettingsMapper | None = None,
        windows_spooler: WindowsSpooler | None = None,
        capability_detector: CapabilityDetector | None = None,
        spooler_monitor: SpoolerMonitor | None = None,
        dpi: int = 300,
        raise_on_error: bool = False,
        shop_id: str | None = None,
        authorized_printers: set[str] | list[str] | None = None,
    ) -> None:
        from caps_agent.printing.capabilities import CapabilityDetector as CapDetector
        from caps_agent.printing.pdf_renderer import PdfRenderer as PdfRend
        from caps_agent.printing.settings_mapper import SettingsMapper as SetMap
        from caps_agent.printing.windows_spooler import WindowsSpooler as WinSpool

        self.pdf_renderer = pdf_renderer or PdfRend()
        self.settings_mapper = settings_mapper or SetMap()
        self.windows_spooler = windows_spooler or WinSpool()
        self.capability_detector = capability_detector or CapDetector()
        self.spooler_monitor = spooler_monitor
        self.dpi = dpi
        self.raise_on_error = raise_on_error
        self.shop_id = shop_id
        self.authorized_printers = (
            set(authorized_printers) if authorized_printers is not None else None
        )
        self._submitted_attempts: dict[str, PrintResult] = {}

    def print_document(
        self,
        pdf_path: Path | str,
        printer_name: str,
        settings: PrintSettings,
        job_title: str | None = None,
        attempt_id: str | None = None,
        shop_id: str | None = None,
    ) -> PrintResult:
        """Submit print work through the full pipeline:
        1. Check idempotency and duplicate attempt IDs
        2. Verify shop / tenant authorization
        3. Validate PDF document file integrity and page count
        4. Validate printer capabilities and readiness
        5. Map print settings to native DEVMODE parameters
        6. Render target pages to raster bitmap buffers
        7. Submit raster pages to Windows Print Spooler dialog-free
        """
        from caps_agent.printing.pdf_renderer import (
            PdfCorruptedError,
            PdfError,
            PdfInvalidHeaderError,
            PdfPasswordProtectedError,
            PdfRenderError,
        )
        from caps_agent.printing.settings_mapper import (
            InvalidSettingValueError,
            PageCountMismatchError,
            SettingsError,
        )
        from caps_agent.printing.settings_mapper import (
            UnsupportedSettingError as MapperUnsupportedSettingError,
        )
        from caps_agent.printing.spooler_monitor import (
            JOB_STATUS_OFFLINE,
            JOB_STATUS_PAPEROUT,
        )
        from caps_agent.printing.windows_spooler import (
            InvalidJobDataError,
            PrinterAccessDeniedError,
            SpoolerJobSubmission,
            SpoolerSubmissionError,
        )
        from caps_agent.printing.windows_spooler import (
            PrinterOfflineError as SpoolerPrinterOfflineError,
        )

        try:
            # 1. Idempotency Check
            if attempt_id and attempt_id in self._submitted_attempts:
                cached_result = self._submitted_attempts[attempt_id]
                logger.warning(
                    "Duplicate print attempt '%s' detected. Returning cached result.",
                    attempt_id,
                )
                return cached_result

            # 2. Shop / Tenant Authorization Check
            effective_shop = shop_id or self.shop_id
            if self.shop_id and shop_id and self.shop_id != shop_id:
                raise ShopAuthorizationError(
                    f"Shop ID mismatch: Agent belongs to '{self.shop_id}', "
                    f"received request for '{shop_id}'.",
                    details={"agent_shop_id": self.shop_id, "request_shop_id": shop_id},
                )

            if (
                self.authorized_printers is not None
                and printer_name not in self.authorized_printers
            ):
                raise ShopAuthorizationError(
                    f"Printer '{printer_name}' is not authorized for shop '{effective_shop}'.",
                    details={
                        "printer_name": printer_name,
                        "shop_id": effective_shop,
                        "authorized_printers": list(self.authorized_printers),
                    },
                )

            # 3. Document File Existence & PDF Validation
            doc_path = Path(pdf_path)
            if not doc_path.exists() or not doc_path.is_file():
                raise DocumentNotFoundError(
                    f"PDF document not found: {doc_path}",
                    details={"path": str(doc_path)},
                )

            try:
                val_result = self.pdf_renderer.validate_pdf(doc_path)
            except PdfCorruptedError as err:
                raise DocumentCorruptedError(f"PDF document is corrupted: {err}") from err
            except PdfPasswordProtectedError as err:
                raise DocumentPasswordProtectedError(
                    f"PDF document is password protected: {err}"
                ) from err
            except (PdfInvalidHeaderError, PdfError) as err:
                raise DocumentValidationError(f"Invalid PDF document: {err}") from err

            if not val_result.is_valid:
                raise DocumentValidationError(
                    f"PDF validation failed: {val_result.validation_error or 'Unknown error'}",
                    details={"total_pages": val_result.total_pages},
                )

            if val_result.total_pages <= 0:
                raise DocumentValidationError(
                    "PDF document contains 0 pages.",
                    details={"total_pages": 0},
                )

            # 4. Printer Capability & State Discovery
            is_known = False
            raw_status = 0
            if (
                hasattr(self.capability_detector, "_known_printers")
                and printer_name in self.capability_detector._known_printers
            ):
                is_known = True
                raw_status = getattr(
                    self.capability_detector._known_printers[printer_name], "status", 0
                )

            if not is_known and hasattr(self.capability_detector, "adapter"):
                try:
                    p_info = self.capability_detector.adapter.get_printer(printer_name)
                    is_known = True
                    if isinstance(p_info, dict):
                        raw_status = p_info.get("status", 0)
                except Exception as err:
                    raise PrinterNotFoundError(
                        f"Printer '{printer_name}' was not found on this system.",
                        details={"printer_name": printer_name},
                    ) from err

            try:
                capabilities = self.capability_detector.detect_capabilities(printer_name)
            except Exception as err:
                logger.error(
                    "Failed to detect capabilities for printer '%s': %s", printer_name, err
                )
                raise PrinterNotFoundError(
                    f"Printer '{printer_name}' could not be queried: {err}",
                    details={"printer_name": printer_name},
                ) from err

            if capabilities is None or capabilities.printer_id == "unknown":
                raise PrinterNotFoundError(
                    f"Printer '{printer_name}' was not found on this system.",
                    details={"printer_name": printer_name},
                )

            # Check printer readiness if driver reports known error / offline states
            status = raw_status or getattr(capabilities, "status", 0) or 0
            if status & JOB_STATUS_OFFLINE or status & 0x00000080:  # PRINTER_STATUS_OFFLINE
                raise PrinterOfflineError(
                    f"Printer '{printer_name}' is offline or disconnected.",
                    details={"printer_name": printer_name, "raw_status": status},
                )
            if status & JOB_STATUS_PAPEROUT or status & 0x00000020:  # PRINTER_STATUS_PAPER_OUT
                raise PrinterPaperOutError(
                    f"Printer '{printer_name}' is currently out of paper.",
                    details={"printer_name": printer_name, "raw_status": status},
                )
            if status & 0x00000008:  # PRINTER_STATUS_PAPER_JAM
                raise PrinterPaperJamError(
                    f"Printer '{printer_name}' reports a paper jam.",
                    details={"printer_name": printer_name, "raw_status": status},
                )

            # 5. Customer Settings Mapping & DEVMODE Translation
            try:
                native_params = self.settings_mapper.map_settings(
                    settings=settings,
                    capabilities=capabilities,
                    total_doc_pages=val_result.total_pages,
                )
            except MapperUnsupportedSettingError as err:
                raise UnsupportedSettingError(
                    str(err),
                    details={"printer_name": printer_name, "settings": str(settings)},
                ) from err
            except InvalidSettingValueError as err:
                raise InvalidSettingError(
                    str(err),
                    details={"printer_name": printer_name, "settings": str(settings)},
                ) from err
            except PageCountMismatchError as err:
                raise InvalidPageRangeError(
                    str(err),
                    details={
                        "page_range": settings.page_range,
                        "total_pages": val_result.total_pages,
                    },
                ) from err
            except SettingsError as err:
                raise InvalidSettingError(str(err)) from err

            # 6. PDF Page Raster Rendering
            try:
                rendered_pages = self.pdf_renderer.render_pages(
                    file_path=doc_path,
                    page_range=settings.page_range,
                    dpi=self.dpi,
                    color_mode=settings.color_mode,
                )
            except (PdfRenderError, PdfError) as err:
                raise RenderingError(
                    f"Failed to render PDF pages: {err}",
                    details={"doc_path": str(doc_path), "page_range": settings.page_range},
                ) from err

            if not rendered_pages:
                raise RenderingError(
                    f"Rendering produced 0 pages for range '{settings.page_range}'.",
                    details={"page_range": settings.page_range},
                )

            # 7. Windows Spooler Submission
            title = job_title or f"CAPS Print {doc_path.name}"
            submission = SpoolerJobSubmission(
                job_title=title,
                printer_name=printer_name,
                pages=rendered_pages,
                parameters=native_params,
            )

            try:
                spooler_result = self.windows_spooler.submit_job(submission)
            except PrinterAccessDeniedError as err:
                raise SpoolerError(
                    f"Access denied opening printer '{printer_name}': {err}",
                    error_code="PRINTER_ACCESS_DENIED",
                    details={"printer_name": printer_name},
                ) from err
            except SpoolerPrinterOfflineError as err:
                raise PrinterOfflineError(
                    f"Target printer '{printer_name}' is offline: {err}",
                    details={"printer_name": printer_name},
                ) from err
            except InvalidJobDataError as err:
                raise SpoolerError(
                    f"Invalid job submission payload: {err}",
                    error_code="INVALID_JOB_DATA",
                ) from err
            except SpoolerSubmissionError as err:
                raise SpoolerError(
                    f"Windows Spooler rejected submission: {err}",
                    error_code="SPOOLER_SUBMISSION_FAILED",
                    details={"printer_name": printer_name},
                ) from err
            except Exception as err:
                raise SpoolerError(
                    f"Unexpected spooler failure: {err}",
                    error_code="SPOOLER_UNEXPECTED_ERROR",
                    details={"printer_name": printer_name},
                ) from err

            # 8. Construct Final PrintResult
            timestamp_str = spooler_result.submission_timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
            result = PrintResult(
                accepted=spooler_result.accepted,
                spooler_job_id=spooler_result.spooler_job_id,
                error=spooler_result.error,
                error_code=None,
                pages_submitted=spooler_result.pages_submitted,
                total_bytes_written=spooler_result.total_bytes_written,
                printer_name=printer_name,
                job_title=title,
                submission_timestamp=timestamp_str,
                attempt_id=attempt_id,
                can_auto_reprint=False,
            )

            if attempt_id:
                self._submitted_attempts[attempt_id] = result

            return result

        except PrintEngineError as err:
            return self._handle_error(err, attempt_id=attempt_id, printer_name=printer_name)

    def _handle_error(
        self,
        err: PrintEngineError,
        attempt_id: str | None = None,
        printer_name: str | None = None,
    ) -> PrintResult:
        """Handle caught engine errors according to raise_on_error configuration."""
        if self.raise_on_error:
            raise err

        logger.error("PrintEngine submission rejected [%s]: %s", err.error_code, err.message)
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
            self._submitted_attempts[attempt_id] = result

        return result


# Production alias
StandardPrintEngine = WindowsPrintEngine
