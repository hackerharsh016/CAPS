"""Convert customer print settings into validated native Windows DEVMODE parameters.

Part of CAPS Windows Print Feasibility (Phase 02, Module 02).
Responsible for:
- Mapping customer print settings (A4/A3/Legal, orientation, color, duplex, copies, page range)
- Enforcing pre-spooler capability validation: rejecting unsupported options before calling Windows print APIs
- Mapping settings to Windows GDI DEVMODE fields (dmPaperSize, dmOrientation, dmColor, dmDuplex, dmCopies)
- Applying explicit printable margin policies and geometry scaling
- Providing pluggable DEVMODE adapters for native pywin32 and cross-platform unit testing
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from caps_agent.printing.capabilities import (
    DMPAPER_A3,
    DMPAPER_A4,
    DMPAPER_A5,
    DMPAPER_LEGAL,
    DMPAPER_LETTER,
    DMPAPER_TABLOID,
    PrinterCapabilities,
)
from caps_agent.printing.engine import PrintSettings
from caps_agent.printing.pdf_renderer import (
    ScalingMode,
    parse_page_range,
)

logger = logging.getLogger("caps_agent.printing.settings_mapper")


# ==============================================================================
# Windows DEVMODE Constants (wingdi.h / winspool.h)
# ==============================================================================

# dmOrientation
DMORIENT_PORTRAIT = 1
DMORIENT_LANDSCAPE = 2

# dmColor
DMCOLOR_MONOCHROME = 1
DMCOLOR_COLOR = 2

# dmDuplex
DMDUP_SIMPLEX = 1
DMDUP_VERTICAL = 2  # Long-edge binding
DMDUP_HORIZONTAL = 3  # Short-edge binding

# dmDefaultSource (Trays / Input Bins)
DMBIN_UPPER = 1
DMBIN_LOWER = 2
DMBIN_MIDDLE = 3
DMBIN_MANUAL = 4
DMBIN_ENVELOPE = 5
DMBIN_ENVMANUAL = 6
DMBIN_AUTO = 7
DMBIN_TRACTOR = 8
DMBIN_SMALLFMT = 9
DMBIN_LARGEFMT = 10
DMBIN_LARGECAPACITY = 11
DMBIN_CASSETTE = 14
DMBIN_FORMSOURCE = 15

# dmCollate
DMCOLLATE_FALSE = 0
DMCOLLATE_TRUE = 1

# dmFields bitmask flags
DM_ORIENTATION = 0x00000001
DM_PAPERSIZE = 0x00000002
DM_PAPERLENGTH = 0x00000004
DM_PAPERWIDTH = 0x00000008
DM_SCALE = 0x00000010
DM_COPIES = 0x00000100
DM_DEFAULTSOURCE = 0x00000200
DM_COLOR = 0x00000800
DM_DUPLEX = 0x00001000
DM_COLLATE = 0x00008000

# Mapping canonical CAPS paper codes to Windows DMPAPER_* IDs
CANONICAL_PAPER_TO_DMPAPER: dict[str, int] = {
    "a4": DMPAPER_A4,
    "a3": DMPAPER_A3,
    "a5": DMPAPER_A5,
    "legal": DMPAPER_LEGAL,
    "letter": DMPAPER_LETTER,
    "tabloid": DMPAPER_TABLOID,
}


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class SettingsError(Exception):
    """Base exception for setting mapping and validation errors."""


class UnsupportedSettingError(SettingsError):
    """Raised when customer requested settings are unsupported by the target printer capabilities."""


class InvalidSettingValueError(SettingsError):
    """Raised when a setting value is malformed or out of permissible ranges."""


class PageCountMismatchError(SettingsError):
    """Raised when requested page range cannot be satisfied by the document."""


# ==============================================================================
# Margin and Scaling Policies
# ==============================================================================


@dataclass(frozen=True)
class PrintMarginPolicy:
    """Explicit margins defining the physical unprintable border or user padding in millimeters."""

    left_mm: float = 5.0
    top_mm: float = 5.0
    right_mm: float = 5.0
    bottom_mm: float = 5.0
    is_borderless: bool = False

    @property
    def left_pts(self) -> float:
        return 0.0 if self.is_borderless else (self.left_mm / 25.4 * 72.0)

    @property
    def top_pts(self) -> float:
        return 0.0 if self.is_borderless else (self.top_mm / 25.4 * 72.0)

    @property
    def right_pts(self) -> float:
        return 0.0 if self.is_borderless else (self.right_mm / 25.4 * 72.0)

    @property
    def bottom_pts(self) -> float:
        return 0.0 if self.is_borderless else (self.bottom_mm / 25.4 * 72.0)


@dataclass(frozen=True)
class ScalingPolicy:
    """Document scaling and orientation policy for mapping page geometry to canvas."""

    mode: ScalingMode = ScalingMode.FIT_PAGE
    auto_rotate: bool = True
    target_dpi: int = 300


# ==============================================================================
# Native DEVMODE and Print Parameter Data Models
# ==============================================================================


@dataclass(frozen=True)
class NativeDevMode:
    """Encapsulation of Windows DEVMODE fields to be submitted to the print subsystem."""

    orientation: int  # DMORIENT_PORTRAIT (1) or DMORIENT_LANDSCAPE (2)
    paper_size: int  # DMPAPER_A4 (9), DMPAPER_A3 (8), etc.
    color: int  # DMCOLOR_MONOCHROME (1) or DMCOLOR_COLOR (2)
    duplex: int  # DMDUP_SIMPLEX (1), DMDUP_VERTICAL (2), DMDUP_HORIZONTAL (3)
    copies: int  # 1..max_copies
    default_source: int  # DMBIN_AUTO, etc.
    collate: int  # DMCOLLATE_TRUE (1) or DMCOLLATE_FALSE (0)
    fields: int  # Active field bitmask

    def to_dict(self) -> dict[str, Any]:
        """Convert DEVMODE properties into a serialized dictionary for auditing and debugging."""
        return {
            "dmOrientation": self.orientation,
            "dmPaperSize": self.paper_size,
            "dmColor": self.color,
            "dmDuplex": self.duplex,
            "dmCopies": self.copies,
            "dmDefaultSource": self.default_source,
            "dmCollate": self.collate,
            "dmFields": self.fields,
        }


@dataclass(frozen=True)
class NativePrintParameters:
    """Fully validated, capability-checked native parameters ready for spooler submission."""

    printer_id: str
    printer_name: str
    canonical_paper_size: str  # 'a4', 'a3', 'legal', 'letter'
    canonical_color_mode: str  # 'bw', 'color'
    canonical_duplex_mode: str  # 'simplex', 'duplex_long', 'duplex_short'
    copies: int
    orientation: str  # 'portrait', 'landscape'
    selected_pages: tuple[int, ...]  # 1-based page numbers to print
    total_sheets_required: int  # Physical sheets based on duplex and pages
    margin_policy: PrintMarginPolicy
    scaling_policy: ScalingPolicy
    devmode: NativeDevMode

    def to_summary_dict(self) -> dict[str, Any]:
        """Summary representation suitable for audit logs and spooler tracking."""
        return {
            "printer_id": self.printer_id,
            "printer_name": self.printer_name,
            "paper_size": self.canonical_paper_size,
            "color_mode": self.canonical_color_mode,
            "duplex_mode": self.canonical_duplex_mode,
            "copies": self.copies,
            "orientation": self.orientation,
            "page_count": len(self.selected_pages),
            "sheets_required": self.total_sheets_required,
            "selected_pages": list(self.selected_pages),
            "devmode": self.devmode.to_dict(),
        }


# ==============================================================================
# DEVMODE Adapter Interface & Implementations
# ==============================================================================


@runtime_checkable
class DevModeAdapter(Protocol):
    """Protocol for applying NativeDevMode parameters to OS DEVMODE structures."""

    def apply_devmode(
        self,
        printer_name: str,
        devmode: NativeDevMode,
        base_devmode: Any = None,
    ) -> Any:
        """Apply native parameters to an operating system or mock DEVMODE handle."""
        ...


class FakeDevModeAdapter:
    """In-memory mock DEVMODE adapter for deterministic unit tests and cross-platform verification."""

    def __init__(self) -> None:
        self.applied_devmodes: list[dict[str, Any]] = []

    def apply_devmode(
        self,
        printer_name: str,
        devmode: NativeDevMode,
        base_devmode: Any = None,
    ) -> dict[str, Any]:
        result = {
            "printer_name": printer_name,
            "devmode": devmode.to_dict(),
            "applied": True,
        }
        self.applied_devmodes.append(result)
        return result


class PyWin32DevModeAdapter:
    """Native Windows pywin32 DEVMODE adapter."""

    def apply_devmode(
        self,
        printer_name: str,
        devmode: NativeDevMode,
        base_devmode: Any = None,
    ) -> Any:
        try:
            import win32print
        except ImportError as err:
            raise RuntimeError(
                "pywin32 is not installed. Use FakeDevModeAdapter for non-Windows testing."
            ) from err

        h_printer = win32print.OpenPrinter(printer_name)
        try:
            if base_devmode is None:
                # Retrieve default DEVMODE level 2
                printer_info = win32print.GetPrinter(h_printer, 2)
                p_devmode = printer_info["pDevMode"]
            else:
                p_devmode = base_devmode

            p_devmode.Orientation = devmode.orientation
            p_devmode.PaperSize = devmode.paper_size
            p_devmode.Color = devmode.color
            p_devmode.Duplex = devmode.duplex
            p_devmode.Copies = devmode.copies
            p_devmode.DefaultSource = devmode.default_source
            p_devmode.Collate = devmode.collate
            p_devmode.Fields |= devmode.fields

            return p_devmode
        finally:
            win32print.ClosePrinter(h_printer)


# ==============================================================================
# Settings Mapper Implementation
# ==============================================================================


class SettingsMapper:
    """Translates user print settings into validated native Windows DEVMODE parameters.

    Ensures unsupported printer options are rejected *before* reaching the Windows
    Spooler subsystem, protecting against driver crashes and silent misprints.
    """

    def __init__(self, devmode_adapter: DevModeAdapter | None = None) -> None:
        self._devmode_adapter = devmode_adapter or FakeDevModeAdapter()

    @property
    def devmode_adapter(self) -> DevModeAdapter:
        return self._devmode_adapter

    def map_settings(
        self,
        settings: PrintSettings,
        capabilities: PrinterCapabilities,
        total_doc_pages: int | None = None,
        margin_policy: PrintMarginPolicy | None = None,
        scaling_policy: ScalingPolicy | None = None,
    ) -> NativePrintParameters:
        """Validate and convert user PrintSettings against target PrinterCapabilities.

        Args:
            settings: High-level print settings from Cloud API / customer job.
            capabilities: Target printer capabilities discovered from Windows driver.
            total_doc_pages: Total number of pages in the validated PDF file.
            margin_policy: Optional custom margins policy (defaults to 5mm standard).
            scaling_policy: Optional geometry scaling policy (defaults to FIT_PAGE).

        Returns:
            NativePrintParameters ready for Windows Spooler submission.

        Raises:
            UnsupportedSettingError: If a requested setting is not supported by the printer.
            InvalidSettingValueError: If a setting value is malformed or out of bounds.
            PageCountMismatchError: If the requested page range is invalid for the document.
        """
        # Handle raw dictionary capabilities fixtures transparently
        if isinstance(capabilities, dict):
            from caps_agent.printing.capabilities import CapabilityDetector
            from caps_agent.printing.printer_discovery import FakeWin32PrintAdapter

            adapter = FakeWin32PrintAdapter()
            printer_name = "Device Under Test"
            for cap_id, val in capabilities.items():
                if isinstance(cap_id, int):
                    adapter.set_capability(printer_name, cap_id, val)
            capabilities = CapabilityDetector(adapter=adapter).detect_capabilities(printer_name)

        # 1. Validate and normalize Paper Size
        raw_paper = settings.paper_size.strip().lower()
        if raw_paper not in CANONICAL_PAPER_TO_DMPAPER:
            raise InvalidSettingValueError(
                f"Unknown paper size '{settings.paper_size}'. Supported formats: "
                f"{list(CANONICAL_PAPER_TO_DMPAPER.keys())}"
            )

        if not capabilities.is_paper_size_supported(raw_paper):
            raise UnsupportedSettingError(
                f"Printer '{capabilities.name}' does not support paper size '{settings.paper_size}'. "
                f"Supported paper sizes: {list(capabilities.supported_paper_sizes)}"
            )
        dm_paper_size = CANONICAL_PAPER_TO_DMPAPER[raw_paper]

        # 2. Validate and normalize Color Mode
        raw_color = settings.color_mode.strip().lower()
        if raw_color in ("bw", "black_and_white", "grayscale", "monochrome"):
            canonical_color = "bw"
            dm_color = DMCOLOR_MONOCHROME
        elif raw_color in ("color", "colour"):
            canonical_color = "color"
            dm_color = DMCOLOR_COLOR
        else:
            raise InvalidSettingValueError(
                f"Invalid color mode '{settings.color_mode}'. Must be 'bw' or 'color'."
            )

        if not capabilities.is_color_mode_supported(canonical_color):
            raise UnsupportedSettingError(
                f"Printer '{capabilities.name}' does not support color mode '{settings.color_mode}'. "
                f"Supported modes: {list(capabilities.supported_color_modes)}"
            )

        # 3. Validate and normalize Duplex Mode
        if isinstance(settings.duplex, bool):
            requested_duplex = "duplex_long" if settings.duplex else "simplex"
        else:
            raw_duplex = str(settings.duplex).strip().lower()
            if raw_duplex in ("true", "duplex", "duplex_long", "long_edge"):
                requested_duplex = "duplex_long"
            elif raw_duplex in ("duplex_short", "short_edge"):
                requested_duplex = "duplex_short"
            elif raw_duplex in ("false", "simplex", "none", "single"):
                requested_duplex = "simplex"
            else:
                raise InvalidSettingValueError(f"Invalid duplex option '{settings.duplex}'.")

        if not capabilities.is_duplex_supported(requested_duplex):
            raise UnsupportedSettingError(
                f"Printer '{capabilities.name}' does not support duplex mode '{requested_duplex}'. "
                f"Supported duplex: {list(capabilities.supported_duplex)}"
            )

        if requested_duplex == "simplex":
            dm_duplex = DMDUP_SIMPLEX
        elif requested_duplex == "duplex_short":
            dm_duplex = DMDUP_HORIZONTAL
        else:
            dm_duplex = DMDUP_VERTICAL

        # 4. Validate Copies
        copies = settings.copies
        if copies < 1:
            raise InvalidSettingValueError(f"Copies must be >= 1; received {copies}.")
        if copies > capabilities.max_copies:
            raise UnsupportedSettingError(
                f"Requested {copies} copies exceeds maximum supported ({capabilities.max_copies}) "
                f"for printer '{capabilities.name}'."
            )

        # 5. Validate Orientation
        raw_orient = settings.orientation.strip().lower()
        if raw_orient == "portrait":
            dm_orient = DMORIENT_PORTRAIT
        elif raw_orient == "landscape":
            dm_orient = DMORIENT_LANDSCAPE
        else:
            raise InvalidSettingValueError(
                f"Invalid orientation '{settings.orientation}'. Must be 'portrait' or 'landscape'."
            )

        # 6. Validate Selected Pages
        if total_doc_pages is not None:
            try:
                selected_pages = tuple(parse_page_range(settings.page_range, total_doc_pages))
            except Exception as err:
                raise PageCountMismatchError(
                    f"Page range '{settings.page_range}' invalid for document with {total_doc_pages} pages: {err}"
                ) from err
        else:
            # Fallback when total doc pages is not yet evaluated: validate range syntax assuming page 1
            if settings.page_range.lower() == "all" or not settings.page_range.strip():
                selected_pages = (1,)
            else:
                try:
                    selected_pages = tuple(parse_page_range(settings.page_range, 9999))
                except Exception as err:
                    raise PageCountMismatchError(f"Invalid page range syntax: {err}") from err

        # Calculate physical sheets required
        pages_count = len(selected_pages)
        sheets_per_copy = (pages_count + 1) // 2 if requested_duplex != "simplex" else pages_count
        total_sheets = sheets_per_copy * copies

        # 7. Construct DEVMODE
        active_fields = (
            DM_ORIENTATION | DM_PAPERSIZE | DM_COLOR | DM_DUPLEX | DM_COPIES | DM_DEFAULTSOURCE
        )
        if capabilities.supports_collate and copies > 1:
            active_fields |= DM_COLLATE
            collate_flag = DMCOLLATE_TRUE
        else:
            collate_flag = DMCOLLATE_FALSE

        native_devmode = NativeDevMode(
            orientation=dm_orient,
            paper_size=dm_paper_size,
            color=dm_color,
            duplex=dm_duplex,
            copies=copies,
            default_source=DMBIN_AUTO,
            collate=collate_flag,
            fields=active_fields,
        )

        # 8. Assemble final parameters
        margins = margin_policy or PrintMarginPolicy()
        scaling = scaling_policy or ScalingPolicy()

        return NativePrintParameters(
            printer_id=capabilities.printer_id,
            printer_name=capabilities.name,
            canonical_paper_size=raw_paper,
            canonical_color_mode=canonical_color,
            canonical_duplex_mode=requested_duplex,
            copies=copies,
            orientation=raw_orient,
            selected_pages=selected_pages,
            total_sheets_required=total_sheets,
            margin_policy=margins,
            scaling_policy=scaling,
            devmode=native_devmode,
        )

    def apply_to_driver(
        self,
        parameters: NativePrintParameters,
        base_devmode: Any = None,
    ) -> Any:
        """Apply the mapped parameters to a driver DEVMODE structure via the configured adapter."""
        return self._devmode_adapter.apply_devmode(
            printer_name=parameters.printer_name,
            devmode=parameters.devmode,
            base_devmode=base_devmode,
        )
