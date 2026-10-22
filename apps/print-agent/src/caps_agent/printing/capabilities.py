"""Printer capability detection and normalization for CAPS Print Agent.

Queries documented Win32 driver DEVMODE and DeviceCapabilities data to extract:
- Supported paper sizes (mapped to CAPS common schema: 'a4', 'a3', 'legal', 'letter')
- Supported color modes ('bw', 'color')
- Supported duplex modes ('simplex', 'duplex_long', 'duplex_short')
- Supported input bins / trays
- Maximum copies and collation support
- Diagnostics for unknown support states and owner-visible explanation reasons
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from caps_agent.printing.printer_discovery import (
    PyWin32PrintAdapter,
    Win32PrintAdapter,
    Win32PrintNotAvailableError,
    normalize_printer_id,
)

logger = logging.getLogger("caps_agent.printing.capabilities")

# ---------------------------------------------------------------------------
# Win32 DeviceCapabilities Constants (wingdi.h / winspool.h)
# ---------------------------------------------------------------------------
DC_FIELDS = 1
DC_PAPERS = 2
DC_PAPERSIZE = 3
DC_MINEXTENT = 4
DC_MAXEXTENT = 5
DC_BINS = 6
DC_DUPLEX = 7
DC_SIZE = 8
DC_EXTRA = 9
DC_VERSION = 10
DC_DRIVER = 11
DC_BINNAMES = 12
DC_ENUMRESOLUTIONS = 13
DC_FILEDEPENDENCIES = 14
DC_TRUETYPE = 15
DC_PAPERNAMES = 16
DC_ORIENTATION = 17
DC_COPIES = 18
DC_BINADJUST = 19
DC_EMBDD_COLOR_PROFILE = 20
DC_COLLATE = 22
DC_MANUFACTURER = 23
DC_MODEL = 24
DC_COLORDEVICE = 32
DC_NUP = 33

# Windows Paper IDs (DMPAPER_*)
DMPAPER_LETTER = 1
DMPAPER_LETTERSMALL = 2
DMPAPER_TABLOID = 3
DMPAPER_LEDGER = 4
DMPAPER_LEGAL = 5
DMPAPER_STATEMENT = 6
DMPAPER_EXECUTIVE = 7
DMPAPER_A3 = 8
DMPAPER_A4 = 9
DMPAPER_A4SMALL = 10
DMPAPER_A5 = 11
DMPAPER_B4 = 12
DMPAPER_B5 = 13

# Canonical CAPS Paper Sizes supported by common schema
CAPS_PAPER_SIZES = ("a4", "a3", "legal", "letter")

# Paper ID mapping to CAPS paper sizes
PAPER_ID_MAP: dict[int, str] = {
    DMPAPER_A4: "a4",
    DMPAPER_A4SMALL: "a4",
    DMPAPER_A3: "a3",
    DMPAPER_LEGAL: "legal",
    DMPAPER_LETTER: "letter",
    DMPAPER_LETTERSMALL: "letter",
}

# Regex patterns for name-based paper recognition
PAPER_NAME_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\ba4\b", re.IGNORECASE), "a4"),
    (re.compile(r"\ba3\b", re.IGNORECASE), "a3"),
    (re.compile(r"\blegal\b", re.IGNORECASE), "legal"),
    (re.compile(r"\bletter\b", re.IGNORECASE), "letter"),
)


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PrinterCapabilities:
    """Normalized capabilities profile for a single Windows printer device."""

    printer_id: str
    name: str
    supported_paper_sizes: tuple[str, ...]
    supported_color_modes: tuple[str, ...]
    supported_duplex: tuple[str, ...]
    supported_trays: tuple[str, ...] = ()
    max_copies: int = 99
    supports_collate: bool = True
    raw_paper_names: tuple[str, ...] = ()
    raw_paper_ids: tuple[int, ...] = ()
    unknown_features: tuple[str, ...] = ()
    diagnostic_reasons: tuple[str, ...] = ()
    status: int = 0

    def is_paper_size_supported(self, paper_size: str) -> bool:
        """Check if a specified paper size (e.g. 'a4', 'a3') is supported."""
        return paper_size.strip().lower() in self.supported_paper_sizes

    def is_color_mode_supported(self, color_mode: str) -> bool:
        """Check if a specified color mode ('bw', 'color') is supported."""
        return color_mode.strip().lower() in self.supported_color_modes

    def is_duplex_supported(self, duplex: str | bool) -> bool:
        """Check if duplex mode is supported."""
        if isinstance(duplex, bool):
            return (
                "duplex_long" in self.supported_duplex
                if duplex
                else "simplex" in self.supported_duplex
            )
        val = duplex.strip().lower()
        return val in self.supported_duplex

    def to_contract_dict(
        self,
        is_default: bool = False,
        status: str = "online",
        last_seen_at: datetime | None = None,
    ) -> dict[str, Any]:
        """Convert into a dictionary conforming to capabilities.schema.json."""
        seen = last_seen_at or datetime.now(UTC)
        return {
            "printer_id": self.printer_id,
            "name": self.name,
            "is_default": is_default,
            "status": status,
            "supported_paper_sizes": list(self.supported_paper_sizes),
            "supported_color_modes": list(self.supported_color_modes),
            "supported_duplex": list(self.supported_duplex),
            "last_seen_at": seen.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }


# ---------------------------------------------------------------------------
# Normalization Functions
# ---------------------------------------------------------------------------


def map_paper_sizes(
    paper_ids: Iterable[int] | None,
    paper_names: Iterable[str] | None,
) -> tuple[list[str], list[str]]:
    """Map raw driver paper IDs and paper names to recognized CAPS paper sizes."""
    recognized: set[str] = set()
    reasons: list[str] = []

    # 1. Match from numeric paper IDs
    if paper_ids:
        for pid in paper_ids:
            if pid in PAPER_ID_MAP:
                recognized.add(PAPER_ID_MAP[pid])

    # 2. Match from human-readable paper names
    if paper_names:
        for name in paper_names:
            for pattern, size_code in PAPER_NAME_PATTERNS:
                if pattern.search(name):
                    recognized.add(size_code)

    # 3. Deterministic order according to canonical list
    result = [s for s in CAPS_PAPER_SIZES if s in recognized]

    # Fallback to safe minimum if driver returned nothing recognized
    if not result:
        result = ["a4"]
        reasons.append(
            "Driver did not report standard CAPS paper sizes (A4/A3/Legal/Letter); "
            "defaulted to ['a4'] for baseline compatibility"
        )

    return result, reasons


def map_color_modes(
    color_device: int | None,
) -> tuple[list[str], list[str], list[str]]:
    """Map DC_COLORDEVICE result to supported color modes."""
    unknown: list[str] = []
    reasons: list[str] = []

    if color_device == 1:
        return ["bw", "color"], unknown, reasons
    if color_device == 0:
        reasons.append(
            "Driver reports monochrome device only (DC_COLORDEVICE=0); color printing is disabled"
        )
        return ["bw"], unknown, reasons

    # Unknown or failed query
    unknown.append("color")
    reasons.append(
        "Driver did not report DC_COLORDEVICE; defaulting to monochrome ['bw'] for safety"
    )
    return ["bw"], unknown, reasons


def map_duplex_modes(
    duplex_support: int | None,
) -> tuple[list[str], list[str], list[str]]:
    """Map DC_DUPLEX result to supported duplex modes."""
    unknown: list[str] = []
    reasons: list[str] = []

    if duplex_support == 1:
        return ["simplex", "duplex_long", "duplex_short"], unknown, reasons
    if duplex_support == 0:
        reasons.append(
            "Duplex unit absent or not reported (DC_DUPLEX=0); limited to single-sided ['simplex']"
        )
        return ["simplex"], unknown, reasons

    # Unknown or failed query
    unknown.append("duplex")
    reasons.append(
        "Driver did not report DC_DUPLEX; defaulting to single-sided ['simplex'] for safety"
    )
    return ["simplex"], unknown, reasons


def map_trays(bin_names: Iterable[str] | None) -> list[str]:
    """Clean and normalize input tray / bin names."""
    if not bin_names:
        return ["Auto"]

    cleaned: list[str] = []
    for b in bin_names:
        b_str = str(b).strip()
        if b_str and b_str not in cleaned:
            cleaned.append(b_str)

    return cleaned if cleaned else ["Auto"]


# ---------------------------------------------------------------------------
# Capability Detector Service
# ---------------------------------------------------------------------------


class CapabilityDetector:
    """Discovers and evaluates device capabilities for installed Windows printers."""

    def __init__(self, adapter: Win32PrintAdapter | None = None) -> None:
        self._known_printers: dict[str, PrinterCapabilities] = {}
        if adapter is not None:
            self._adapter = adapter
        else:
            try:
                self._adapter = PyWin32PrintAdapter()
            except Win32PrintNotAvailableError:
                from caps_agent.printing.printer_discovery import FakeWin32PrintAdapter

                self._adapter = FakeWin32PrintAdapter()

    @property
    def adapter(self) -> Win32PrintAdapter:
        return self._adapter

    def register_known_printer(self, printer_name: str, capabilities: PrinterCapabilities) -> None:
        """Register pre-computed capabilities for a printer device."""
        self._known_printers[printer_name] = capabilities

    def detect_capabilities(
        self,
        printer_name: str,
        port_name: str = "",
    ) -> PrinterCapabilities:
        """Query documented driver capabilities for the named printer device."""
        printer_id = normalize_printer_id(printer_name)
        if printer_name in self._known_printers:
            return self._known_printers[printer_name]
        # Capture hardware status if available
        printer_status = 0
        try:
            printer_info = self._adapter.get_printer(printer_name)
            if isinstance(printer_info, dict):
                printer_status = printer_info.get("status", 0)
        except Exception as err:
            logger.debug("Failed to query get_printer for %s: %s", printer_name, err)

        reasons: list[str] = []
        unknown_features: list[str] = []

        # 1. Query Paper IDs (DC_PAPERS)
        raw_paper_ids: tuple[int, ...] = ()
        try:
            papers_val = self._adapter.device_capabilities(printer_name, port_name, DC_PAPERS)
            if isinstance(papers_val, (tuple, list)):
                raw_paper_ids = tuple(int(x) for x in papers_val)
        except Exception as err:
            logger.debug("Failed to query DC_PAPERS for %s: %s", printer_name, err)
            unknown_features.append("paper_ids")
            reasons.append(f"Failed to query DC_PAPERS: {err}")

        # 2. Query Paper Names (DC_PAPERNAMES)
        raw_paper_names: tuple[str, ...] = ()
        try:
            names_val = self._adapter.device_capabilities(printer_name, port_name, DC_PAPERNAMES)
            if isinstance(names_val, (tuple, list)):
                raw_paper_names = tuple(str(x).strip() for x in names_val if str(x).strip())
        except Exception as err:
            logger.debug("Failed to query DC_PAPERNAMES for %s: %s", printer_name, err)
            unknown_features.append("paper_names")
            reasons.append(f"Failed to query DC_PAPERNAMES: {err}")

        # Map paper sizes
        supported_papers, paper_reasons = map_paper_sizes(raw_paper_ids, raw_paper_names)
        reasons.extend(paper_reasons)

        # 3. Query Color Capability (DC_COLORDEVICE)
        color_val: int | None = None
        try:
            raw_color = self._adapter.device_capabilities(printer_name, port_name, DC_COLORDEVICE)
            if raw_color is not None:
                color_val = int(raw_color)
        except Exception as err:
            logger.debug("Failed to query DC_COLORDEVICE for %s: %s", printer_name, err)

        supported_colors, color_unknown, color_reasons = map_color_modes(color_val)
        unknown_features.extend(color_unknown)
        reasons.extend(color_reasons)

        # 4. Query Duplex Capability (DC_DUPLEX)
        duplex_val: int | None = None
        try:
            raw_duplex = self._adapter.device_capabilities(printer_name, port_name, DC_DUPLEX)
            if raw_duplex is not None:
                duplex_val = int(raw_duplex)
        except Exception as err:
            logger.debug("Failed to query DC_DUPLEX for %s: %s", printer_name, err)

        supported_duplex, duplex_unknown, duplex_reasons = map_duplex_modes(duplex_val)
        unknown_features.extend(duplex_unknown)
        reasons.extend(duplex_reasons)

        # 5. Query Trays / Bins (DC_BINNAMES)
        raw_bin_names: list[str] = []
        try:
            bins_val = self._adapter.device_capabilities(printer_name, port_name, DC_BINNAMES)
            if isinstance(bins_val, (tuple, list)):
                raw_bin_names = [str(x).strip() for x in bins_val if str(x).strip()]
        except Exception as err:
            logger.debug("Failed to query DC_BINNAMES for %s: %s", printer_name, err)

        supported_trays = map_trays(raw_bin_names)

        # 6. Query Max Copies (DC_COPIES)
        max_copies = 99
        try:
            copies_val = self._adapter.device_capabilities(printer_name, port_name, DC_COPIES)
            if copies_val is not None and int(copies_val) > 0:
                max_copies = min(int(copies_val), 100)
        except Exception:
            pass

        # 7. Query Collation (DC_COLLATE)
        supports_collate = True
        try:
            collate_val = self._adapter.device_capabilities(printer_name, port_name, DC_COLLATE)
            if collate_val is not None:
                supports_collate = bool(int(collate_val))
        except Exception:
            pass

        return PrinterCapabilities(
            printer_id=printer_id,
            name=printer_name,
            supported_paper_sizes=tuple(supported_papers),
            supported_color_modes=tuple(supported_colors),
            supported_duplex=tuple(supported_duplex),
            supported_trays=tuple(supported_trays),
            max_copies=max_copies,
            supports_collate=supports_collate,
            raw_paper_names=raw_paper_names,
            raw_paper_ids=raw_paper_ids,
            unknown_features=tuple(unknown_features),
            diagnostic_reasons=tuple(reasons),
            status=printer_status,
        )


# ---------------------------------------------------------------------------
# Reusable Device Fixtures for Non-Hardware Iteration & Tests
# ---------------------------------------------------------------------------

CANON_IR2006_CAPABILITIES = {
    DC_PAPERS: (DMPAPER_A3, DMPAPER_A4, DMPAPER_LETTER),
    DC_PAPERNAMES: ("A3", "A4", "Letter"),
    DC_COLORDEVICE: 0,  # Monochrome only
    DC_DUPLEX: 1,  # Duplex supported
    DC_BINNAMES: ("Auto Select", "Drawer 1", "Drawer 2", "Bypass Tray"),
    DC_COPIES: 99,
    DC_COLLATE: 1,
}

EPSON_L805_CAPABILITIES = {
    DC_PAPERS: (DMPAPER_LETTER, DMPAPER_A4),
    DC_PAPERNAMES: ("Letter", "A4"),
    DC_COLORDEVICE: 1,  # Color supported
    DC_DUPLEX: 0,  # Simplex only
    DC_BINNAMES: ("Rear Paper Feed",),
    DC_COPIES: 99,
    DC_COLLATE: 1,
}

HP_LASERJET_P1102_CAPABILITIES = {
    DC_PAPERS: (DMPAPER_LETTER, DMPAPER_LEGAL, DMPAPER_A4),
    DC_PAPERNAMES: ("Letter", "Legal", "A4"),
    DC_COLORDEVICE: 0,  # Monochrome only
    DC_DUPLEX: 0,  # Simplex only (no auto duplex)
    DC_BINNAMES: ("Main Tray", "Priority Feed Slot"),
    DC_COPIES: 99,
    DC_COLLATE: 0,
}
