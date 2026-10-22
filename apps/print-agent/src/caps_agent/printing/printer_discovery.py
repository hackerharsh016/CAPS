"""Windows printer enumeration and status normalization for CAPS Print Agent.

Provides discovery of OS-recognized local and network printers via pywin32,
normalizing device identities, display names, default printer selection,
and Windows PRINTER_STATUS_* flags into frozen CAPS contract models.
"""

from __future__ import annotations

import contextlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger("caps_agent.printing.discovery")

# ---------------------------------------------------------------------------
# Windows Spooler Constants (WinSpool.h / win32print)
# Defined directly to allow safe operation in test and cross-platform modes.
# ---------------------------------------------------------------------------

# Win32 EnumPrinters flags
PRINTER_ENUM_DEFAULT = 0x00000001
PRINTER_ENUM_LOCAL = 0x00000002
PRINTER_ENUM_CONNECTIONS = 0x00000004
PRINTER_ENUM_FAVORITE = 0x00000004
PRINTER_ENUM_NAME = 0x00000008
PRINTER_ENUM_REMOTE = 0x00000010
PRINTER_ENUM_SHARED = 0x00000020
PRINTER_ENUM_NETWORK = 0x00000040

# Win32 Printer Attributes flags
PRINTER_ATTRIBUTE_DEFAULT = 0x00000004
PRINTER_ATTRIBUTE_SHARED = 0x00000008
PRINTER_ATTRIBUTE_NETWORK = 0x00000010
PRINTER_ATTRIBUTE_HIDDEN = 0x00000020
PRINTER_ATTRIBUTE_LOCAL = 0x00000040
PRINTER_ATTRIBUTE_ENABLE_DEVQ = 0x00000080
PRINTER_ATTRIBUTE_KEEPPRINTEDJOBS = 0x00000100
PRINTER_ATTRIBUTE_DO_COMPLETE_FIRST = 0x00000200
PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x00000400
PRINTER_ATTRIBUTE_ENABLE_BIDI = 0x00000800
PRINTER_ATTRIBUTE_RAW_ONLY = 0x00001000
PRINTER_ATTRIBUTE_PUBLISHED = 0x00002000

# Win32 Printer Status flags (PRINTER_INFO_2 status field)
PRINTER_STATUS_PAUSED = 0x00000001
PRINTER_STATUS_ERROR = 0x00000002
PRINTER_STATUS_PENDING_DELETION = 0x00000004
PRINTER_STATUS_PAPER_JAM = 0x00000008
PRINTER_STATUS_PAPER_OUT = 0x00000010
PRINTER_STATUS_MANUAL_FEED = 0x00000020
PRINTER_STATUS_PAPER_PROBLEM = 0x00000040
PRINTER_STATUS_OFFLINE = 0x00000080
PRINTER_STATUS_IO_ACTIVE = 0x00000100
PRINTER_STATUS_BUSY = 0x00000200
PRINTER_STATUS_PRINTING = 0x00000400
PRINTER_STATUS_OUTPUT_BIN_FULL = 0x00000800
PRINTER_STATUS_NOT_AVAILABLE = 0x00001000
PRINTER_STATUS_WAITING = 0x00002000
PRINTER_STATUS_PROCESSING = 0x00004000
PRINTER_STATUS_INITIALIZING = 0x00008000
PRINTER_STATUS_WARMING_UP = 0x00010000
PRINTER_STATUS_TONER_LOW = 0x00020000
PRINTER_STATUS_NO_TONER = 0x00040000
PRINTER_STATUS_PAGE_PUNT = 0x00080000
PRINTER_STATUS_USER_INTERVENTION = 0x00100000
PRINTER_STATUS_OUT_OF_MEMORY = 0x00200000
PRINTER_STATUS_DOOR_OPEN = 0x00400000
PRINTER_STATUS_SERVER_UNKNOWN = 0x00800000
PRINTER_STATUS_POWER_SAVE = 0x01000000


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class PrinterDiscoveryError(Exception):
    """Base exception for printer enumeration and discovery failures."""


class Win32PrintNotAvailableError(PrinterDiscoveryError):
    """Raised when pywin32 or win32print is not available on this platform."""


class PrinterNotFoundError(PrinterDiscoveryError):
    """Raised when a specified printer cannot be found on the system."""


# ---------------------------------------------------------------------------
# Normalization Functions
# ---------------------------------------------------------------------------


def normalize_printer_id(printer_name: str) -> str:
    """Derive a URL/contract-safe printer ID slug from an OS printer name.

    Examples:
        'Canon imageRUNNER 2006' -> 'canon-imagerunner-2006'
        'Microsoft Print to PDF' -> 'microsoft-print-to-pdf'
        'HP LaserJet Pro MFP M428fdw (Copy 1)' -> 'hp-laserjet-pro-mfp-m428fdw-copy-1'
    """
    cleaned = printer_name.strip()
    if not cleaned:
        return "printer-device"

    slug = re.sub(r"[^a-zA-Z0-9]+", "-", cleaned.lower()).strip("-")
    return slug or "printer-device"


def map_win32_status(status_flags: int, attribute_flags: int = 0) -> str:
    """Map Windows spooler status and attribute bitmasks to CAPS PrinterStatus enum.

    CAPS schema enum: ['online', 'offline', 'busy', 'error']
    """
    # 1. Error status flags (highest priority)
    error_mask = (
        PRINTER_STATUS_ERROR
        | PRINTER_STATUS_PAPER_JAM
        | PRINTER_STATUS_PAPER_OUT
        | PRINTER_STATUS_PAPER_PROBLEM
        | PRINTER_STATUS_OUTPUT_BIN_FULL
        | PRINTER_STATUS_NO_TONER
        | PRINTER_STATUS_PAGE_PUNT
        | PRINTER_STATUS_USER_INTERVENTION
        | PRINTER_STATUS_OUT_OF_MEMORY
        | PRINTER_STATUS_DOOR_OPEN
    )
    if status_flags & error_mask:
        return "error"

    # 2. Offline / Unavailable flags
    offline_mask = (
        PRINTER_STATUS_OFFLINE
        | PRINTER_STATUS_PAUSED
        | PRINTER_STATUS_PENDING_DELETION
        | PRINTER_STATUS_NOT_AVAILABLE
        | PRINTER_STATUS_SERVER_UNKNOWN
    )
    if (status_flags & offline_mask) or (attribute_flags & PRINTER_ATTRIBUTE_WORK_OFFLINE):
        return "offline"

    # 3. Busy / In-progress flags
    busy_mask = (
        PRINTER_STATUS_BUSY
        | PRINTER_STATUS_PRINTING
        | PRINTER_STATUS_IO_ACTIVE
        | PRINTER_STATUS_MANUAL_FEED
        | PRINTER_STATUS_WAITING
        | PRINTER_STATUS_PROCESSING
        | PRINTER_STATUS_INITIALIZING
        | PRINTER_STATUS_WARMING_UP
    )
    if status_flags & busy_mask:
        return "busy"

    # 4. Normal ready state
    return "online"


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DiscoveredPrinter:
    """Normalized representation of a discovered Windows printer device."""

    printer_id: str
    name: str
    is_default: bool
    status: str  # 'online' | 'offline' | 'busy' | 'error'
    port_name: str | None = None
    driver_name: str | None = None
    raw_status: int = 0
    raw_attributes: int = 0
    comment: str | None = None
    location: str | None = None
    last_seen_at: datetime | None = None

    def to_contract_dict(
        self,
        supported_paper_sizes: list[str] | None = None,
        supported_color_modes: list[str] | None = None,
        supported_duplex: list[str] | None = None,
    ) -> dict[str, Any]:
        """Convert into a dictionary matching packages/print-contracts schema."""
        seen = self.last_seen_at or datetime.now(UTC)
        return {
            "printer_id": self.printer_id,
            "name": self.name,
            "is_default": self.is_default,
            "status": self.status,
            "supported_paper_sizes": supported_paper_sizes or ["a4"],
            "supported_color_modes": supported_color_modes or ["bw"],
            "supported_duplex": supported_duplex or ["simplex"],
            "last_seen_at": seen.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }


# ---------------------------------------------------------------------------
# Win32 Adapter Interface & Implementations
# ---------------------------------------------------------------------------


@runtime_checkable
class Win32PrintAdapter(Protocol):
    """Protocol boundary abstracting pywin32 win32print operations."""

    def enum_printers(self, flags: int) -> list[dict[str, Any]]:
        """Enumerate printers matching the specified Win32 PRINTER_ENUM_* flags."""
        ...

    def get_default_printer(self) -> str | None:
        """Return the name of the system default printer, or None if not set."""
        ...

    def get_printer(self, printer_name: str, level: int = 2) -> dict[str, Any]:
        """Return detailed printer properties for the named device."""
        ...

    def device_capabilities(self, printer_name: str, port_name: str, capability: int) -> Any:
        """Query documented DeviceCapabilities for printer and port."""
        ...


class PyWin32PrintAdapter(Win32PrintAdapter):
    """Production adapter using pywin32 win32print APIs."""

    def __init__(self) -> None:
        try:
            import win32print

            self._win32print = win32print
        except ImportError as err:
            raise Win32PrintNotAvailableError(
                "pywin32 (win32print) is not installed or available on this platform"
            ) from err

    def enum_printers(self, flags: int) -> list[dict[str, Any]]:
        try:
            raw_printers = self._win32print.EnumPrinters(flags, None, 2)
            results: list[dict[str, Any]] = []
            for item in raw_printers:
                # EnumPrinters level 2 returns a tuple of 21 elements or dictionary
                if isinstance(item, dict):
                    results.append(
                        {
                            "server_name": item.get("pServerName"),
                            "printer_name": item.get("pPrinterName", ""),
                            "port_name": item.get("pPortName"),
                            "driver_name": item.get("pDriverName"),
                            "comment": item.get("pComment"),
                            "location": item.get("pLocation"),
                            "attributes": item.get("Attributes", 0),
                            "status": item.get("Status", 0),
                            "jobs_count": item.get("cJobs", 0),
                        }
                    )
                elif isinstance(item, (tuple, list)) and len(item) >= 19:
                    results.append(
                        {
                            "server_name": item[0],
                            "printer_name": item[1] or "",
                            "port_name": item[3],
                            "driver_name": item[4],
                            "comment": item[5],
                            "location": item[6],
                            "attributes": item[13] if len(item) > 13 else 0,
                            "status": item[18] if len(item) > 18 else 0,
                            "jobs_count": item[19] if len(item) > 19 else 0,
                        }
                    )
            return results
        except Exception as err:
            logger.error("Failed to enumerate Win32 printers: %s", err)
            raise PrinterDiscoveryError(f"Failed to enumerate Win32 printers: {err}") from err

    def get_default_printer(self) -> str | None:
        try:
            default_name = self._win32print.GetDefaultPrinter()
            return default_name.strip() if default_name else None
        except Exception as err:
            # Code 127 / ERROR_PROC_NOT_FOUND or no default printer configured
            logger.debug("No default printer returned by win32print: %s", err)
            return None

    def get_printer(self, printer_name: str, level: int = 2) -> dict[str, Any]:
        handle = None
        try:
            handle = self._win32print.OpenPrinter(printer_name)
            data = self._win32print.GetPrinter(handle, level)
            if isinstance(data, dict):
                return data
            return {"raw": data}
        except Exception as err:
            raise PrinterDiscoveryError(
                f"Failed to inspect printer '{printer_name}': {err}"
            ) from err
        finally:
            if handle is not None:
                with contextlib.suppress(Exception):
                    self._win32print.ClosePrinter(handle)

    def device_capabilities(self, printer_name: str, port_name: str, capability: int) -> Any:
        try:
            return self._win32print.DeviceCapabilities(printer_name, port_name or "", capability)
        except Exception as err:
            logger.debug(
                "DeviceCapabilities(%s, %s, %s) failed: %s",
                printer_name,
                port_name,
                capability,
                err,
            )
            raise PrinterDiscoveryError(
                f"DeviceCapabilities({capability}) failed for '{printer_name}': {err}"
            ) from err


class FakeWin32PrintAdapter(Win32PrintAdapter):
    """In-memory test double modeling the Win32 print subsystem."""

    def __init__(
        self,
        printers: list[dict[str, Any]] | None = None,
        default_printer: str | None = None,
        simulated_error: Exception | None = None,
        capabilities: dict[tuple[str, int], Any] | None = None,
    ) -> None:
        self.printers: list[dict[str, Any]] = printers or []
        self.default_printer: str | None = default_printer
        self.simulated_error: Exception | None = simulated_error
        self.capabilities: dict[tuple[str, int], Any] = capabilities or {}

    def enum_printers(self, flags: int) -> list[dict[str, Any]]:
        if self.simulated_error:
            raise self.simulated_error
        return list(self.printers)

    def get_default_printer(self) -> str | None:
        if self.simulated_error:
            raise self.simulated_error
        return self.default_printer

    def get_printer(self, printer_name: str, level: int = 2) -> dict[str, Any]:
        if self.simulated_error:
            raise self.simulated_error
        for p in self.printers:
            if p.get("printer_name") == printer_name:
                return p
        raise PrinterNotFoundError(f"Printer '{printer_name}' not found in fake spooler")

    def add_printer(
        self,
        name: str,
        port: str = "USB001",
        driver: str = "Generic Driver",
        attributes: int = PRINTER_ATTRIBUTE_LOCAL,
        status: int = 0,
        comment: str | None = None,
        location: str | None = None,
    ) -> None:
        self.printers.append(
            {
                "printer_name": name,
                "port_name": port,
                "driver_name": driver,
                "attributes": attributes,
                "status": status,
                "comment": comment,
                "location": location,
                "jobs_count": 0,
            }
        )

    def set_capability(self, printer_name: str, capability: int, value: Any) -> None:
        """Configure mock capability response for a printer and DC_* index."""
        self.capabilities[(printer_name, capability)] = value

    def device_capabilities(self, printer_name: str, port_name: str, capability: int) -> Any:
        if self.simulated_error:
            raise self.simulated_error
        key = (printer_name, capability)
        if key in self.capabilities:
            val = self.capabilities[key]
            if isinstance(val, Exception):
                raise val
            return val
        return None


# ---------------------------------------------------------------------------
# Discovery Service
# ---------------------------------------------------------------------------


class PrinterDiscovery:
    """Service that discovers and normalizes Windows printer devices."""

    def __init__(self, adapter: Win32PrintAdapter | None = None) -> None:
        if adapter is not None:
            self._adapter = adapter
        else:
            try:
                self._adapter = PyWin32PrintAdapter()
            except Win32PrintNotAvailableError:
                logger.warning("pywin32 not available; falling back to empty FakeWin32PrintAdapter")
                self._adapter = FakeWin32PrintAdapter()

    @property
    def adapter(self) -> Win32PrintAdapter:
        """Underlying Win32 adapter."""
        return self._adapter

    def enumerate_printers(
        self,
        flags: int = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
    ) -> list[DiscoveredPrinter]:
        """Enumerate installed local and network printers.

        Results are normalized, tagged with default status, and sorted so that
        the system default printer appears first, followed by remaining printers
        in alphabetical order.
        """
        raw_list = self._adapter.enum_printers(flags)
        default_name = self._adapter.get_default_printer()

        discovered: list[DiscoveredPrinter] = []
        now = datetime.now(UTC)

        for item in raw_list:
            name = item.get("printer_name", "").strip()
            if not name:
                continue

            status_flags = item.get("status", 0)
            attr_flags = item.get("attributes", 0)

            # Check if this printer is the default device
            is_default = bool(
                (default_name and name.lower() == default_name.lower())
                or (attr_flags & PRINTER_ATTRIBUTE_DEFAULT)
            )

            normalized_status = map_win32_status(status_flags, attr_flags)
            printer_id = normalize_printer_id(name)

            discovered.append(
                DiscoveredPrinter(
                    printer_id=printer_id,
                    name=name,
                    is_default=is_default,
                    status=normalized_status,
                    port_name=item.get("port_name"),
                    driver_name=item.get("driver_name"),
                    raw_status=status_flags,
                    raw_attributes=attr_flags,
                    comment=item.get("comment"),
                    location=item.get("location"),
                    last_seen_at=now,
                )
            )

        # Sort: default printer first, then alphabetically by name
        discovered.sort(key=lambda p: (not p.is_default, p.name.lower()))
        return discovered

    def get_default_printer(self) -> DiscoveredPrinter | None:
        """Find and return the default printer, or None if none found."""
        printers = self.enumerate_printers()
        for p in printers:
            if p.is_default:
                return p
        return printers[0] if printers else None

    def get_printer_by_id(self, printer_id: str) -> DiscoveredPrinter | None:
        """Find a printer by its normalized ID."""
        target = printer_id.strip().lower()
        for p in self.enumerate_printers():
            if p.printer_id == target:
                return p
        return None

    def get_printer_by_name(self, name: str) -> DiscoveredPrinter | None:
        """Find a printer by its exact or case-insensitive display name."""
        target = name.strip().lower()
        for p in self.enumerate_printers():
            if p.name.lower() == target:
                return p
        return None
