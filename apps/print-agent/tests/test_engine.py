"""Unit, contract, and error-injection tests for PrintEngine and FakePrintEngine.

Tests cover:
- Protocol conformance for PrintEngine, WindowsPrintEngine, and FakePrintEngine
- Happy-path rasterization and spooler submission pipeline
- Fake no-paper, paper jam, and offline hardware failure cases
- Fake no-printer / unknown printer rejection
- Document validation errors (missing file, corrupted PDF, password protected)
- Customer settings validation against printer capabilities (unsupported paper size, color, duplex)
- Page range out-of-bounds error handling
- Shop / tenant isolation and access control enforcement
- Idempotency and duplicate/replayed attempt ID protection
- Windows Spooler error translation (access denied, offline, spooler RPC disconnect)
- Strict compliance with Non-Negotiable Policy #5 (can_auto_reprint=False)
- Tests fakes package exports (tests/fakes)
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from caps_agent.printing.capabilities import (
    CapabilityDetector,
    PrinterCapabilities,
)
from caps_agent.printing.engine import (
    DocumentNotFoundError,
    PrintEngine,
    PrinterNotFoundError,
    PrinterPaperOutError,
    PrintSettings,
    ShopAuthorizationError,
    StandardPrintEngine,
    WindowsPrintEngine,
)
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.printing.pdf_renderer import BuiltinPdfBackend, PdfRenderer
from caps_agent.printing.printer_discovery import FakeWin32PrintAdapter
from caps_agent.printing.settings_mapper import (
    FakeDevModeAdapter,
    SettingsMapper,
)
from caps_agent.printing.spooler_monitor import (
    JOB_STATUS_OFFLINE,
    JOB_STATUS_PAPEROUT,
)
from caps_agent.printing.windows_spooler import (
    FakeWin32SpoolerAdapter,
    WindowsSpooler,
)
from tests.fakes import FakePrintEngine as ReexportedFakeEngine
from tests.fakes.fake_engine import FakePrintEngine as DirectReexportedFakeEngine

# Synthetic test printer capabilities
SAMPLE_HP_CAPS = PrinterCapabilities(
    printer_id="hp-laserjet",
    name="HP LaserJet Pro MFP",
    supported_paper_sizes=("a4", "letter"),
    supported_color_modes=("bw",),
    supported_duplex=("simplex", "duplex_long"),
    max_copies=99,
)

SAMPLE_CANON_COLOR_CAPS = PrinterCapabilities(
    printer_id="canon-color",
    name="Canon imageRUNNER Color",
    supported_paper_sizes=("a4", "a3", "legal", "letter"),
    supported_color_modes=("bw", "color"),
    supported_duplex=("simplex", "duplex_long", "duplex_short"),
    max_copies=999,
)


def _create_minimal_valid_pdf(num_pages: int = 2) -> bytes:
    """Generate a syntactically valid PDF binary with the specified page count."""
    lines = [b"%PDF-1.4", b"%\xe2\xe3\xcf\xd3"]
    objects = [b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"]
    kid_refs = " ".join(f"{i + 3} 0 R" for i in range(num_pages))
    objects.append(
        f"2 0 obj\n<< /Type /Pages /Kids [{kid_refs}] /Count {num_pages} >>\nendobj".encode("ascii")
    )

    for i in range(num_pages):
        obj_num = i + 3
        stream_content = b"BT /F1 12 Tf 100 700 Td (Page Content) Tj ET"
        stream_len = len(stream_content)
        objects.append(
            f"{obj_num} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Contents {obj_num + num_pages} 0 R >>\nendobj".encode("ascii")
        )

    for i in range(num_pages):
        obj_num = i + 3 + num_pages
        stream_content = b"BT /F1 12 Tf 100 700 Td (Page Content) Tj ET"
        stream_len = len(stream_content)
        objects.append(
            f"{obj_num} 0 obj\n<< /Length {stream_len} >>\nstream\n".encode("ascii")
            + stream_content
            + b"\nendstream\nendobj"
        )

    body = b"\n".join(lines) + b"\n"
    xref_offsets = [0]
    for obj in objects:
        xref_offsets.append(len(body))
        body += obj + b"\n"

    xref_pos = len(body)
    total_objs = len(objects) + 1
    xref = f"xref\n0 {total_objs}\n0000000000 65535 f \n".encode("ascii")
    for off in xref_offsets[1:]:
        xref += f"{off:010d} 00000 n \n".encode("ascii")

    trailer = (
        f"trailer\n<< /Size {total_objs} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
    ).encode("ascii")

    return body + xref + trailer


# ==============================================================================
# 1. FakePrintEngine Unit & Scenario Tests
# ==============================================================================


class TestFakePrintEngine(unittest.TestCase):
    """Verifies that FakePrintEngine correctly models protocol, edge cases, and errors."""

    def setUp(self) -> None:
        self.settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        self.doc_path = Path("/tmp/mock_invoice.pdf")

    def test_protocol_conformance(self) -> None:
        engine = FakePrintEngine()
        self.assertIsInstance(engine, PrintEngine)
        self.assertIsInstance(ReexportedFakeEngine(), PrintEngine)
        self.assertIsInstance(DirectReexportedFakeEngine(), PrintEngine)

    def test_happy_path_submission(self) -> None:
        engine = FakePrintEngine(simulated_spooler_job_id=2001)
        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=self.settings,
            job_title="Test Job 1",
            attempt_id="att-001",
        )

        self.assertTrue(result.accepted)
        self.assertEqual(result.spooler_job_id, 2001)
        self.assertIsNone(result.error)
        self.assertIsNone(result.error_code)
        self.assertEqual(result.printer_name, "HP LaserJet Pro MFP")
        self.assertEqual(result.job_title, "Test Job 1")
        self.assertEqual(result.attempt_id, "att-001")
        self.assertFalse(result.can_auto_reprint)  # Policy #5

        # Subsequent submission increments job ID
        result2 = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=self.settings,
        )
        self.assertEqual(result2.spooler_job_id, 2002)

        # Submission log
        self.assertEqual(len(engine.submission_log), 2)
        self.assertEqual(engine.submission_log[0]["attempt_id"], "att-001")

    def test_fake_no_printer_failure_case(self) -> None:
        engine = FakePrintEngine(configured_printers={"HP LaserJet Pro MFP"})

        # Querying an unknown printer returns PRINTER_NOT_FOUND
        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="Unknown Brother Printer",
            settings=self.settings,
        )
        self.assertFalse(result.accepted)
        self.assertIsNone(result.spooler_job_id)
        self.assertEqual(result.error_code, "PRINTER_NOT_FOUND")
        self.assertIn("not found", result.error or "")
        self.assertFalse(result.can_auto_reprint)

        # When raise_on_error is True, raises typed exception
        engine_strict = FakePrintEngine(
            configured_printers={"HP LaserJet Pro MFP"},
            raise_on_error=True,
        )
        with self.assertRaises(PrinterNotFoundError):
            engine_strict.print_document(
                pdf_path=self.doc_path,
                printer_name="Unknown Brother Printer",
                settings=self.settings,
            )

    def test_fake_no_paper_failure_case(self) -> None:
        engine = FakePrintEngine(no_paper_printers={"Canon IR2006"})

        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="Canon IR2006",
            settings=self.settings,
        )
        self.assertFalse(result.accepted)
        self.assertIsNone(result.spooler_job_id)
        self.assertEqual(result.error_code, "PRINTER_PAPER_OUT")
        self.assertIn("out of paper", result.error or "")
        self.assertFalse(result.can_auto_reprint)

        # Strict exception mode
        engine_strict = FakePrintEngine(
            no_paper_printers={"Canon IR2006"},
            raise_on_error=True,
        )
        with self.assertRaises(PrinterPaperOutError):
            engine_strict.print_document(
                pdf_path=self.doc_path,
                printer_name="Canon IR2006",
                settings=self.settings,
            )

    def test_fake_paper_jam_failure_case(self) -> None:
        engine = FakePrintEngine(paper_jam_printers={"Epson L805"})

        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="Epson L805",
            settings=self.settings,
        )
        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PRINTER_PAPER_JAM")
        self.assertIn("paper jam", result.error or "")
        self.assertFalse(result.can_auto_reprint)

    def test_fake_offline_failure_case(self) -> None:
        engine = FakePrintEngine(offline_printers={"HP P1102"})

        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP P1102",
            settings=self.settings,
        )
        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PRINTER_OFFLINE")
        self.assertIn("offline", result.error or "")
        self.assertFalse(result.can_auto_reprint)

    def test_validation_rejection(self) -> None:
        engine = FakePrintEngine(simulate_validation_failure=True)

        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=self.settings,
        )
        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "DOCUMENT_INVALID")
        self.assertIn("validation failure", result.error or "")

    def test_shop_authorization_rejection(self) -> None:
        engine = FakePrintEngine(
            authorized_shops={
                "shop-101": {"HP LaserJet Pro MFP"},
                "shop-102": {"Canon IR2006"},
            }
        )

        # shop-101 asking for Canon IR2006 (unauthorized)
        result = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="Canon IR2006",
            settings=self.settings,
            shop_id="shop-101",
        )
        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "FORBIDDEN_SHOP")
        self.assertIn("not authorized for shop", result.error or "")

        # Strict exception mode
        engine_strict = FakePrintEngine(
            authorized_shops={"shop-101": {"HP LaserJet Pro MFP"}},
            raise_on_error=True,
        )
        with self.assertRaises(ShopAuthorizationError):
            engine_strict.print_document(
                pdf_path=self.doc_path,
                printer_name="Canon IR2006",
                settings=self.settings,
                shop_id="shop-101",
            )

    def test_duplicate_replayed_call_handling(self) -> None:
        engine = FakePrintEngine(simulated_spooler_job_id=3001)

        # First attempt
        res1 = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=self.settings,
            attempt_id="stable-attempt-xyz",
        )
        self.assertTrue(res1.accepted)
        self.assertEqual(res1.spooler_job_id, 3001)

        # Replay same attempt ID
        res2 = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=self.settings,
            attempt_id="stable-attempt-xyz",
        )
        # Idempotently returns identical result without new spooler job
        self.assertEqual(res2.spooler_job_id, 3001)
        self.assertEqual(engine.simulated_spooler_job_id, 3002)  # was only incremented once

    def test_unsupported_settings_simulation(self) -> None:
        engine = FakePrintEngine(unsupported_settings={"HP LaserJet Pro MFP": {"color", "a3"}})

        color_settings = PrintSettings(
            paper_size="A4",
            color_mode="color",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        res = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=color_settings,
        )
        self.assertFalse(res.accepted)
        self.assertEqual(res.error_code, "UNSUPPORTED_SETTING")

    def test_spooler_disconnect_simulation(self) -> None:
        engine = FakePrintEngine(simulate_spooler_disconnect=True)

        res = engine.print_document(
            pdf_path=self.doc_path,
            printer_name="HP LaserJet Pro MFP",
            settings=self.settings,
        )
        self.assertFalse(res.accepted)
        self.assertEqual(res.error_code, "SPOOLER_DISCONNECTED")
        self.assertIn("RPC service unreachable", res.error or "")


# ==============================================================================
# 2. WindowsPrintEngine Full Pipeline & Error Injection Tests
# ==============================================================================


class TestWindowsPrintEnginePipeline(unittest.TestCase):
    """Tests the production WindowsPrintEngine orchestrating the complete print pipeline."""

    def setUp(self) -> None:
        # 1. Setup mock Win32 Spooler adapter
        self.spooler_adapter = FakeWin32SpoolerAdapter(starting_job_id=5001)
        self.spooler = WindowsSpooler(adapter=self.spooler_adapter)

        # 2. Setup mock Win32 Print adapter & Capability Detector
        self.print_adapter = FakeWin32PrintAdapter()
        self.print_adapter.add_printer(
            SAMPLE_HP_CAPS.name,
            attributes=0,
            status=0,
        )
        self.print_adapter.add_printer(
            SAMPLE_CANON_COLOR_CAPS.name,
            attributes=0,
            status=0,
        )
        self.detector = CapabilityDetector(adapter=self.print_adapter)
        # Register capabilities
        self.detector.register_known_printer(SAMPLE_HP_CAPS.name, SAMPLE_HP_CAPS)
        self.detector.register_known_printer(SAMPLE_CANON_COLOR_CAPS.name, SAMPLE_CANON_COLOR_CAPS)

        # 3. Setup mock DEVMODE adapter & SettingsMapper
        self.devmode_adapter = FakeDevModeAdapter()
        self.mapper = SettingsMapper(devmode_adapter=self.devmode_adapter)

        # 4. Setup PDF Renderer with builtin backend
        self.pdf_backend = BuiltinPdfBackend()
        self.pdf_renderer = PdfRenderer(backend=self.pdf_backend)

        # 5. Assemble WindowsPrintEngine
        self.engine = WindowsPrintEngine(
            pdf_renderer=self.pdf_renderer,
            settings_mapper=self.mapper,
            windows_spooler=self.spooler,
            capability_detector=self.detector,
            dpi=150,
            raise_on_error=False,
        )

        # 6. Generate synthetic 2-page PDF
        self.temp_dir = tempfile.TemporaryDirectory()
        self.valid_pdf_path = Path(self.temp_dir.name) / "contract_test.pdf"
        self.valid_pdf_path.write_bytes(_create_minimal_valid_pdf(num_pages=2))

        self.valid_settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_protocol_and_alias_conformance(self) -> None:
        self.assertIsInstance(self.engine, PrintEngine)
        self.assertEqual(WindowsPrintEngine, StandardPrintEngine)

    def test_full_pipeline_happy_path(self) -> None:
        """PDF validation -> Settings mapping -> Raster rendering -> Spooler submission."""
        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
            job_title="Paid Customer Order #4421",
            attempt_id="att-happy-001",
        )

        self.assertTrue(result.accepted)
        self.assertEqual(result.spooler_job_id, 5001)
        self.assertIsNone(result.error)
        self.assertIsNone(result.error_code)
        self.assertEqual(result.pages_submitted, 2)
        self.assertGreater(result.total_bytes_written, 1000)
        self.assertEqual(result.printer_name, SAMPLE_HP_CAPS.name)
        self.assertEqual(result.job_title, "Paid Customer Order #4421")
        self.assertEqual(result.attempt_id, "att-happy-001")
        self.assertFalse(result.can_auto_reprint)  # Non-Negotiable Policy #5

        # Check Spooler received actual raster pages
        self.assertEqual(len(self.spooler_adapter.submitted_jobs), 1)
        recorded_job = self.spooler_adapter.submitted_jobs[0]
        self.assertEqual(recorded_job["job_id"], 5001)
        self.assertEqual(len(recorded_job["pages_data"]), 2)
        for page_data in recorded_job["pages_data"]:
            self.assertTrue(page_data.startswith(b"BM"))  # Valid BMP rasters

    def test_missing_document_rejection(self) -> None:
        missing_path = Path(self.temp_dir.name) / "nonexistent.pdf"
        result = self.engine.print_document(
            pdf_path=missing_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
        )

        self.assertFalse(result.accepted)
        self.assertIsNone(result.spooler_job_id)
        self.assertEqual(result.error_code, "DOCUMENT_NOT_FOUND")
        self.assertIn("not found", result.error or "")

        # Strict exception mode
        strict_engine = WindowsPrintEngine(
            pdf_renderer=self.pdf_renderer,
            settings_mapper=self.mapper,
            windows_spooler=self.spooler,
            capability_detector=self.detector,
            raise_on_error=True,
        )
        with self.assertRaises(DocumentNotFoundError):
            strict_engine.print_document(
                pdf_path=missing_path,
                printer_name=SAMPLE_HP_CAPS.name,
                settings=self.valid_settings,
            )

    def test_corrupted_document_rejection(self) -> None:
        corrupted_path = Path(self.temp_dir.name) / "corrupt.pdf"
        corrupted_path.write_bytes(b"%PDF-1.4\nCorrupted binary payload\x00\xff")

        result = self.engine.print_document(
            pdf_path=corrupted_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
        )

        self.assertFalse(result.accepted)
        self.assertIn(result.error_code, ("DOCUMENT_INVALID", "DOCUMENT_CORRUPTED"))

    def test_unknown_printer_rejection(self) -> None:
        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name="Nonexistent Kyocera Printer",
            settings=self.valid_settings,
        )

        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PRINTER_NOT_FOUND")
        self.assertIn("not found", result.error or "")

    def test_offline_printer_rejection(self) -> None:
        # Register an offline printer
        offline_caps = PrinterCapabilities(
            printer_id="offline-printer",
            name="Offline HP Printer",
            supported_paper_sizes=("a4",),
            supported_color_modes=("bw",),
            supported_duplex=("simplex",),
            status=JOB_STATUS_OFFLINE,
        )
        self.print_adapter.add_printer(offline_caps.name, status=JOB_STATUS_OFFLINE)
        self.detector.register_known_printer(offline_caps.name, offline_caps)

        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=offline_caps.name,
            settings=self.valid_settings,
        )

        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PRINTER_OFFLINE")
        self.assertIn("offline", result.error or "")

    def test_paper_out_rejection(self) -> None:
        # Register a printer with paper-out status
        paper_out_caps = PrinterCapabilities(
            printer_id="paperout-printer",
            name="Paper Out HP Printer",
            supported_paper_sizes=("a4",),
            supported_color_modes=("bw",),
            supported_duplex=("simplex",),
            status=JOB_STATUS_PAPEROUT,
        )
        self.print_adapter.add_printer(paper_out_caps.name, status=JOB_STATUS_PAPEROUT)
        self.detector.register_known_printer(paper_out_caps.name, paper_out_caps)

        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=paper_out_caps.name,
            settings=self.valid_settings,
        )

        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PRINTER_PAPER_OUT")
        self.assertIn("out of paper", result.error or "")

    def test_unsupported_setting_rejection(self) -> None:
        # HP LaserJet does not support Color
        color_settings = PrintSettings(
            paper_size="A4",
            color_mode="color",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )

        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=color_settings,
        )

        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "UNSUPPORTED_SETTING")
        self.assertIn("does not support color mode", result.error or "")

    def test_invalid_page_range_rejection(self) -> None:
        # Document only has 2 pages; request pages 5-10
        out_of_bounds_settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="5-10",
            orientation="portrait",
        )

        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=out_of_bounds_settings,
        )

        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PAGE_RANGE_OUT_OF_BOUNDS")

    def test_spooler_access_denied_handling(self) -> None:
        # Simulate OS PermissionError opening printer
        self.spooler_adapter.simulate_access_denied = True

        result = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
        )

        self.assertFalse(result.accepted)
        self.assertEqual(result.error_code, "PRINTER_ACCESS_DENIED")

    def test_shop_tenant_isolation_enforcement(self) -> None:
        engine_with_shop = WindowsPrintEngine(
            pdf_renderer=self.pdf_renderer,
            settings_mapper=self.mapper,
            windows_spooler=self.spooler,
            capability_detector=self.detector,
            shop_id="shop-campus-north",
            authorized_printers={SAMPLE_HP_CAPS.name},
        )

        # 1. Shop ID mismatch
        res1 = engine_with_shop.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
            shop_id="shop-campus-south",
        )
        self.assertFalse(res1.accepted)
        self.assertEqual(res1.error_code, "FORBIDDEN_SHOP")

        # 2. Printer not authorized for this shop
        res2 = engine_with_shop.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_CANON_COLOR_CAPS.name,
            settings=self.valid_settings,
            shop_id="shop-campus-north",
        )
        self.assertFalse(res2.accepted)
        self.assertEqual(res2.error_code, "FORBIDDEN_SHOP")

    def test_idempotency_and_replay_protection(self) -> None:
        # First call: succeeds and submits to spooler
        res1 = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
            attempt_id="stable-lease-999",
        )
        self.assertTrue(res1.accepted)
        self.assertEqual(res1.spooler_job_id, 5001)
        self.assertEqual(len(self.spooler_adapter.submitted_jobs), 1)

        # Replay identical attempt ID
        res2 = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
            attempt_id="stable-lease-999",
        )
        # Returns cached result without submitting a second job
        self.assertEqual(res2.spooler_job_id, 5001)
        self.assertEqual(len(self.spooler_adapter.submitted_jobs), 1)

    def test_result_to_dict_contract(self) -> None:
        res = self.engine.print_document(
            pdf_path=self.valid_pdf_path,
            printer_name=SAMPLE_HP_CAPS.name,
            settings=self.valid_settings,
            attempt_id="att-dict-01",
        )
        d = res.to_dict()
        self.assertTrue(d["accepted"])
        self.assertEqual(d["spooler_job_id"], 5001)
        self.assertEqual(d["attempt_id"], "att-dict-01")
        self.assertFalse(d["can_auto_reprint"])
        self.assertIn("submission_timestamp", d)


if __name__ == "__main__":
    unittest.main()
