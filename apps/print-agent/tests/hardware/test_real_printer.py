"""Native physical Windows printer test suite for CAPS Print Agent.

This test harness requires genuine physical printer hardware and Windows Spooler drivers.
If no physical printer is designated via CAPS_TEST_PRINTER_NAME or if the host is non-Windows,
tests are explicitly marked SKIPPED (not fake PASS), faithfully reporting physical verification
as BLOCKED until live hardware is attached.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import pytest

from caps_agent.printing.capabilities import CapabilityDetector
from caps_agent.printing.engine import PrintSettings, WindowsPrintEngine
from caps_agent.printing.printer_discovery import PrinterDiscovery
from caps_agent.printing.spooler_monitor import SpoolerMonitor

TEST_PRINTER_NAME = os.environ.get("CAPS_TEST_PRINTER_NAME")
IS_WINDOWS = sys.platform == "win32"

HAS_PYWIN32 = False
if IS_WINDOWS:
    try:
        import win32print  # noqa: F401

        HAS_PYWIN32 = True
    except ImportError:
        HAS_PYWIN32 = False

REAL_PRINTER_AVAILABLE = bool(TEST_PRINTER_NAME and IS_WINDOWS and HAS_PYWIN32)


def get_available_real_printers() -> list[str]:
    """Enumerate genuine printers installed on this Windows host."""
    if not (IS_WINDOWS and HAS_PYWIN32):
        return []
    try:
        discovery = PrinterDiscovery()
        devices = discovery.enumerate_local_printers()
        return [p.name for p in devices]
    except Exception:
        return []


def generate_sample_pdf(output_path: Path) -> Path:
    """Generate a minimal valid single-page PDF document for physical printer tests."""
    pdf_content = (
        b"%PDF-1.4\n"
        b"1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n"
        b"2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj\n"
        b"3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <<>>>> endobj\n"
        b"4 0 obj <</Length 44>> stream\n"
        b"BT /F1 24 Tf 100 700 Td (CAPS Hardware Gate Test) ET\n"
        b"endstream\n"
        b"endobj\n"
        b"xref\n"
        b"0 5\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"0000000216 00000 n \n"
        b"trailer <</Size 5 /Root 1 0 R>>\n"
        b"startxref\n"
        b"310\n"
        b"%%EOF\n"
    )
    output_path.write_bytes(pdf_content)
    return output_path


class TestPhysicalPrinterHardware:
    """Physical hardware integration test suite.

    Requires live hardware. Does NOT fake pass.
    """

    @pytest.mark.skipif(
        not REAL_PRINTER_AVAILABLE,
        reason=(
            "Physical printer hardware verification BLOCKED: "
            "Requires Windows OS, pywin32, and CAPS_TEST_PRINTER_NAME environment variable."
        ),
    )
    def test_real_printer_capability_query(self) -> None:
        """Query DeviceCapabilities from the real Windows printer driver."""
        assert TEST_PRINTER_NAME is not None
        detector = CapabilityDetector()
        caps = detector.get_capabilities(TEST_PRINTER_NAME)

        assert caps is not None
        assert caps.printer_id == TEST_PRINTER_NAME
        assert caps.supports_color in (True, False)
        assert caps.supports_duplex in (True, False)
        assert len(caps.supported_paper_sizes) > 0

    @pytest.mark.skipif(
        not REAL_PRINTER_AVAILABLE,
        reason=(
            "Physical printer hardware submission BLOCKED: "
            "Requires Windows OS, pywin32, and CAPS_TEST_PRINTER_NAME environment variable."
        ),
    )
    def test_real_printer_submission_and_spooler_tracking(self, tmp_path: Path) -> None:
        """Submit a rasterized test page to real Windows Spooler and monitor completion."""
        assert TEST_PRINTER_NAME is not None
        pdf_path = generate_sample_pdf(tmp_path / "hardware_gate_test.pdf")

        settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1",
            orientation="portrait",
        )

        engine = WindowsPrintEngine()
        result = engine.print_document(
            pdf_path=pdf_path,
            printer_name=TEST_PRINTER_NAME,
            settings=settings,
            job_title="CAPS Feasibility Gate Hardware Verification",
            attempt_id="hardware-gate-attempt-1",
        )

        assert result.accepted is True
        assert result.spooler_job_id is not None
        assert result.can_auto_reprint is False

        # Monitor spooler until job completes or watchdog triggers
        monitor = SpoolerMonitor()
        outcome = monitor.monitor_until_terminal(
            printer_name=TEST_PRINTER_NAME,
            job_id=result.spooler_job_id,
            timeout_seconds=30.0,
            poll_interval_seconds=0.5,
        )

        assert outcome.is_terminal is True
        assert outcome.can_auto_reprint is False


def get_hardware_status_summary() -> dict[str, Any]:
    """Report actual detected hardware status for the integration gate report."""
    real_printers = get_available_real_printers()
    return {
        "is_windows": IS_WINDOWS,
        "has_pywin32": HAS_PYWIN32,
        "designated_printer": TEST_PRINTER_NAME,
        "discovered_printers": real_printers,
        "hardware_test_ready": REAL_PRINTER_AVAILABLE,
        "status": "PASS" if REAL_PRINTER_AVAILABLE else "BLOCKED (needs physical printer hardware)",
    }
