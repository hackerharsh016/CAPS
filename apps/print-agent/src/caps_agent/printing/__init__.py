"""Printing subsystem interfaces and adapters."""

from caps_agent.printing.engine import PrintEngine, PrintResult, PrintSettings
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.printing.printer_discovery import (
    DiscoveredPrinter,
    FakeWin32PrintAdapter,
    PrinterDiscovery,
    PrinterDiscoveryError,
    PrinterNotFoundError,
    PyWin32PrintAdapter,
    Win32PrintAdapter,
    Win32PrintNotAvailableError,
    map_win32_status,
    normalize_printer_id,
)

__all__ = [
    "PrintEngine",
    "PrintResult",
    "PrintSettings",
    "FakePrintEngine",
    "DiscoveredPrinter",
    "PrinterDiscovery",
    "PrinterDiscoveryError",
    "PrinterNotFoundError",
    "Win32PrintAdapter",
    "PyWin32PrintAdapter",
    "FakeWin32PrintAdapter",
    "Win32PrintNotAvailableError",
    "map_win32_status",
    "normalize_printer_id",
]
