"""Unit and integration tests for Windows Spooler raster submission.

Tests cover:
- Dialog-free raster page submission to Windows print spooler
- DEVMODE driver parameter transmission during printer handle acquisition
- Execution of StartDocPrinter / StartPagePrinter / WritePrinter / EndPagePrinter / EndDocPrinter
- Spooler job ID assignment and tracking
- Error classification: access denied (PrinterAccessDeniedError), offline (PrinterOfflineError), write failure (SpoolerSubmissionError)
- Validation of empty payloads / invalid printer names (InvalidJobDataError)
- Guaranteed cleanup of printer handles and spool doc sessions in finally blocks
- End-to-end pipeline test: PdfRenderer -> SettingsMapper -> WindowsSpooler
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from caps_agent.printing.capabilities import (
    PrinterCapabilities,
)
from caps_agent.printing.engine import PrintSettings
from caps_agent.printing.pdf_renderer import (
    BuiltinPdfBackend,
    PdfRenderer,
    RenderedPage,
)
from caps_agent.printing.settings_mapper import (
    DMPAPER_A4,
    SettingsMapper,
)
from caps_agent.printing.windows_spooler import (
    FakeWin32SpoolerAdapter,
    InvalidJobDataError,
    PrinterAccessDeniedError,
    PrinterOfflineError,
    PyWin32SpoolerAdapter,
    SpoolerJobSubmission,
    SpoolerSubmissionError,
    Win32SpoolerAdapter,
    WindowsSpooler,
)

# Standard mock capabilities
HP_P1102_CAPS = PrinterCapabilities(
    printer_id="hp-p1102",
    name="HP LaserJet Professional P1102",
    supported_paper_sizes=("a4", "legal", "letter"),
    supported_color_modes=("bw",),
    supported_duplex=("simplex",),
    max_copies=99,
)


def _generate_synthetic_pdf(num_pages: int = 2) -> bytes:
    """Generate minimal valid PDF stream for end-to-end test."""
    lines = [b"%PDF-1.4", b"%\xe2\xe3\xcf\xd3"]
    objects = [b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"]
    kid_refs = " ".join(f"{i + 3} 0 R" for i in range(num_pages))
    objects.append(
        f"2 0 obj\n<< /Type /Pages /Kids [{kid_refs}] /Count {num_pages} >>\nendobj".encode("ascii")
    )
    for i in range(num_pages):
        objects.append(
            f"{i + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>\nendobj".encode(
                "ascii"
            )
        )
    body = b"\n".join(lines) + b"\n"
    offsets = [0]
    for obj in objects:
        offsets.append(len(body))
        body += obj + b"\n"
    startxref = len(body)
    xref = f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii")
    for off in offsets[1:]:
        xref += f"{off:010d} 00000 n \n".encode("ascii")
    body += xref
    trailer = (
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return body + trailer


def _create_mock_raster_page(page_number: int = 1, size_bytes: int = 5000) -> RenderedPage:
    """Create a synthetic RenderedPage for unit testing."""
    bmp_dummy = b"BM" + (b"\x00" * (size_bytes - 2))
    return RenderedPage(
        page_number=page_number,
        width_px=1000,
        height_px=1500,
        dpi=150,
        color_mode="bw",
        format="bmp",
        image_bytes=bmp_dummy,
    )


class TestWindowsSpoolerSubmissionHappyPath(unittest.TestCase):
    """Tests successful spooler submission and job ID capture."""

    def setUp(self) -> None:
        self.adapter = FakeWin32SpoolerAdapter(starting_job_id=2001)
        self.spooler = WindowsSpooler(adapter=self.adapter)
        self.mapper = SettingsMapper()

    def test_single_page_submission(self) -> None:
        """Submits a single raster page to Windows Spooler."""
        page = _create_mock_raster_page(page_number=1, size_bytes=4096)
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1",
            orientation="portrait",
        )
        params = self.mapper.map_settings(settings, HP_P1102_CAPS, total_doc_pages=1)

        result = self.spooler.submit_raster_pages(
            printer_name=HP_P1102_CAPS.name,
            pages=[page],
            parameters=params,
            job_title="CAPS Test Job 001",
        )

        self.assertTrue(result.accepted)
        self.assertEqual(result.spooler_job_id, 2001)
        self.assertEqual(result.pages_submitted, 1)
        self.assertEqual(result.total_bytes_written, 4096)
        self.assertEqual(result.printer_name, HP_P1102_CAPS.name)
        self.assertEqual(result.job_title, "CAPS Test Job 001")
        self.assertIsNone(result.error)

        # Protocol conversion
        pr = result.to_print_result()
        self.assertTrue(pr.accepted)
        self.assertEqual(pr.spooler_job_id, 2001)
        self.assertIsNone(pr.error)

        # Inspect adapter recording
        self.assertEqual(len(self.adapter.submitted_jobs), 1)
        record = self.adapter.submitted_jobs[0]
        self.assertEqual(record["job_id"], 2001)
        self.assertEqual(record["job_title"], "CAPS Test Job 001")
        self.assertEqual(record["page_count"], 1)
        self.assertEqual(record["total_bytes"], 4096)
        self.assertIn("devmode", record)
        self.assertEqual(record["devmode"]["dmPaperSize"], DMPAPER_A4)

    def test_multi_page_submission(self) -> None:
        """Submits 3 pages and verifies sequential page streaming."""
        pages = [
            _create_mock_raster_page(page_number=1, size_bytes=3000),
            _create_mock_raster_page(page_number=2, size_bytes=3000),
            _create_mock_raster_page(page_number=3, size_bytes=3000),
        ]
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        params = self.mapper.map_settings(settings, HP_P1102_CAPS, total_doc_pages=3)

        result = self.spooler.submit_raster_pages(
            printer_name=HP_P1102_CAPS.name,
            pages=pages,
            parameters=params,
            job_title="CAPS Multi-Page Document",
        )

        self.assertTrue(result.accepted)
        self.assertEqual(result.spooler_job_id, 2001)
        self.assertEqual(result.pages_submitted, 3)
        self.assertEqual(result.total_bytes_written, 9000)

        # Verify second submission receives incremented job ID
        result2 = self.spooler.submit_raster_pages(
            printer_name=HP_P1102_CAPS.name,
            pages=[pages[0]],
            parameters=params,
            job_title="CAPS Second Job",
        )
        self.assertEqual(result2.spooler_job_id, 2002)

    def test_to_dict_serialization(self) -> None:
        """Verifies dictionary representation for audit logging."""
        page = _create_mock_raster_page(page_number=1, size_bytes=1024)
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1",
            orientation="portrait",
        )
        params = self.mapper.map_settings(settings, HP_P1102_CAPS)
        result = self.spooler.submit_raster_pages(HP_P1102_CAPS.name, [page], params)

        d = result.to_dict()
        self.assertTrue(d["accepted"])
        self.assertEqual(d["spooler_job_id"], 2001)
        self.assertEqual(d["pages_submitted"], 1)
        self.assertEqual(d["total_bytes_written"], 1024)
        self.assertIn("submission_timestamp", d)


class TestWindowsSpoolerErrorClassification(unittest.TestCase):
    """Tests failure injection and structured error handling."""

    def setUp(self) -> None:
        self.adapter = FakeWin32SpoolerAdapter()
        self.spooler = WindowsSpooler(adapter=self.adapter)
        self.mapper = SettingsMapper()
        self.params = self.mapper.map_settings(
            PrintSettings("A4", "bw", False, 1, "all", "portrait"),
            HP_P1102_CAPS,
        )

    def test_empty_printer_name_rejected(self) -> None:
        """Empty printer name raises InvalidJobDataError."""
        page = _create_mock_raster_page()
        with self.assertRaises(InvalidJobDataError) as ctx:
            self.spooler.submit_raster_pages("   ", [page], self.params)
        self.assertIn("Printer name cannot be empty", str(ctx.exception))

    def test_empty_pages_rejected(self) -> None:
        """Submitting 0 pages raises InvalidJobDataError."""
        with self.assertRaises(InvalidJobDataError) as ctx:
            self.spooler.submit_raster_pages(HP_P1102_CAPS.name, [], self.params)
        self.assertIn("0 pages", str(ctx.exception))

    def test_access_denied_classification(self) -> None:
        """Access denied (Error 5) translates to PrinterAccessDeniedError."""
        self.adapter.simulate_access_denied = True
        page = _create_mock_raster_page()

        with self.assertRaises(PrinterAccessDeniedError) as ctx:
            self.spooler.submit_raster_pages(HP_P1102_CAPS.name, [page], self.params)
        self.assertIn("Access denied", str(ctx.exception))

    def test_printer_offline_classification(self) -> None:
        """Printer offline translates to PrinterOfflineError."""
        self.adapter.simulate_offline = True
        page = _create_mock_raster_page()

        with self.assertRaises(PrinterOfflineError) as ctx:
            self.spooler.submit_raster_pages(HP_P1102_CAPS.name, [page], self.params)
        self.assertIn("offline", str(ctx.exception))

    def test_write_printer_failure_cleanup(self) -> None:
        """Failure during WritePrinter raises SpoolerSubmissionError and closes handle."""
        self.adapter.simulate_write_failure = True
        page = _create_mock_raster_page()

        with self.assertRaises(SpoolerSubmissionError) as ctx:
            self.spooler.submit_raster_pages(HP_P1102_CAPS.name, [page], self.params)
        self.assertIn("Error writing job", str(ctx.exception))
        # Ensure open handle was cleaned up
        self.assertEqual(len(self.adapter._open_handles), 0)

    def test_zero_job_id_raises_submission_error(self) -> None:
        """StartDocPrinter returning 0 raises SpoolerSubmissionError."""
        self.adapter.simulate_zero_job_id = True
        page = _create_mock_raster_page()

        with self.assertRaises(SpoolerSubmissionError) as ctx:
            self.spooler.submit_raster_pages(HP_P1102_CAPS.name, [page], self.params)
        self.assertIn("invalid job ID", str(ctx.exception))


class TestAdapterProtocolCompliance(unittest.TestCase):
    """Verifies adapter protocol compatibility."""

    def test_fake_adapter_implements_protocol(self) -> None:
        """FakeWin32SpoolerAdapter satisfies Win32SpoolerAdapter runtime protocol."""
        adapter = FakeWin32SpoolerAdapter()
        self.assertIsInstance(adapter, Win32SpoolerAdapter)

    def test_pywin32_adapter_implements_protocol(self) -> None:
        """PyWin32SpoolerAdapter satisfies Win32SpoolerAdapter runtime protocol."""
        try:
            adapter = PyWin32SpoolerAdapter()
            self.assertIsInstance(adapter, Win32SpoolerAdapter)
        except RuntimeError as err:
            if "pywin32 is not installed" in str(err):
                self.skipTest("pywin32 is not installed or available on this platform")
            raise


class TestEndToEndRenderingAndSpoolerPipeline(unittest.TestCase):
    """Integration test connecting PdfRenderer -> SettingsMapper -> WindowsSpooler."""

    def setUp(self) -> None:
        self.pdf_renderer = PdfRenderer(backend=BuiltinPdfBackend())
        self.mapper = SettingsMapper()
        self.adapter = FakeWin32SpoolerAdapter(starting_job_id=5001)
        self.spooler = WindowsSpooler(adapter=self.adapter)

    def test_complete_pdf_to_spooler_flow(self) -> None:
        """Synthesizes a PDF, renders raster BMPs, maps settings, and submits to spooler."""
        pdf_bytes = _generate_synthetic_pdf(num_pages=2)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(pdf_bytes)
            pdf_path = Path(f.name)

        try:
            # 1. Validate PDF
            val = self.pdf_renderer.validate_pdf(pdf_path)
            self.assertEqual(val.total_pages, 2)

            # 2. Render pages to raster BMPs
            rendered_pages = self.pdf_renderer.render_pages(
                file_path=pdf_path,
                page_range="all",
                dpi=150,
                color_mode="bw",
            )
            self.assertEqual(len(rendered_pages), 2)
            for page in rendered_pages:
                self.assertTrue(page.image_bytes.startswith(b"BM"))

            # 3. Map customer settings against target capabilities
            settings = PrintSettings(
                paper_size="A4",
                color_mode="bw",
                duplex=False,
                copies=1,
                page_range="all",
                orientation="portrait",
            )
            params = self.mapper.map_settings(
                settings=settings,
                capabilities=HP_P1102_CAPS,
                total_doc_pages=val.total_pages,
            )
            self.assertEqual(params.canonical_paper_size, "a4")

            # 4. Submit to Windows Spooler
            result = self.spooler.submit_job(
                SpoolerJobSubmission(
                    job_title="End-to-End Invoice Print",
                    printer_name=HP_P1102_CAPS.name,
                    pages=rendered_pages,
                    parameters=params,
                )
            )

            self.assertTrue(result.accepted)
            self.assertEqual(result.spooler_job_id, 5001)
            self.assertEqual(result.pages_submitted, 2)
            self.assertGreater(result.total_bytes_written, 10000)

            # Verify spooler recorded payload
            self.assertEqual(len(self.adapter.submitted_jobs), 1)
            job_record = self.adapter.submitted_jobs[0]
            self.assertEqual(job_record["job_id"], 5001)
            self.assertEqual(job_record["job_title"], "End-to-End Invoice Print")
            self.assertEqual(len(job_record["pages_data"]), 2)
            for page_data in job_record["pages_data"]:
                self.assertTrue(page_data.startswith(b"BM"))
        finally:
            if pdf_path.exists():
                pdf_path.unlink()


if __name__ == "__main__":
    unittest.main()
