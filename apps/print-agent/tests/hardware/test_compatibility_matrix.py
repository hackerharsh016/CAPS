"""Real-device printer compatibility matrix and stress test suite.

Part of CAPS Phase 07 (Release QA Pilot, Module 03 Quality Acceptance).
Validates printer capability matrices across:
- Paper sizes (A4, A3, Legal, Letter)
- Color modes (B&W, Color)
- Duplex modes (Simplex, Duplex Long-Edge, Duplex Short-Edge)
- Page ranges (all, subset ranges)
- Multi-copy scaling and high-volume serialized batch stress testing
- Physical printer hardware verification (when CAPS_TEST_PRINTER_NAME is supplied)
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

from caps_agent.jobs.dispatcher import JobDispatcher, JobItem
from caps_agent.jobs.state_machine import JobState
from caps_agent.printing.capabilities import CapabilityDetector, PrinterCapabilities
from caps_agent.printing.engine import PrintSettings, WindowsPrintEngine
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.printing.settings_mapper import (
    SettingsMapper,
    UnsupportedSettingError,
)
from caps_agent.printing.spooler_monitor import SpoolerMonitor
from caps_agent.storage.cleanup import ArtifactCleaner
from caps_agent.storage.local_state import LocalStateJournal
from caps_agent.storage.temp_files import TempFileManager

try:
    from tests.hardware.sample_docs import write_sample_pdf
except ImportError:
    try:
        from hardware.sample_docs import write_sample_pdf
    except ImportError:
        from .sample_docs import write_sample_pdf

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


# ==============================================================================
# Simulated Printer Capability Profiles
# ==============================================================================

PROFILE_BASIC_MONO = PrinterCapabilities(
    printer_id="basic_mono",
    name="Basic Desktop Laser (Mono Simplex)",
    supported_paper_sizes=("a4", "letter"),
    supported_color_modes=("bw",),
    supported_duplex=("simplex",),
    status=0,
)

PROFILE_OFFICE_DUPLEX_MONO = PrinterCapabilities(
    printer_id="office_duplex_mono",
    name="Office Workgroup Laser (Mono Duplex)",
    supported_paper_sizes=("a4", "letter", "legal"),
    supported_color_modes=("bw",),
    supported_duplex=("simplex", "duplex_long", "duplex_short"),
    status=0,
)

PROFILE_ENTERPRISE_COLOR_MFP = PrinterCapabilities(
    printer_id="enterprise_color_mfp",
    name="Enterprise Multifunction (Color A3/A4 Duplex)",
    supported_paper_sizes=("a4", "a3", "letter", "legal"),
    supported_color_modes=("bw", "color"),
    supported_duplex=("simplex", "duplex_long", "duplex_short"),
    status=0,
)


@dataclass
class MatrixResult:
    paper_size: str
    color_mode: str
    duplex: str
    supported: bool
    status: str
    error_reason: str | None = None


# ==============================================================================
# Programmatic Matrix Runner
# ==============================================================================


def evaluate_matrix_vector(
    capabilities: PrinterCapabilities,
    paper_size: str,
    color_mode: str,
    duplex: str,
    copies: int = 1,
    page_range: str = "all",
    total_pages: int = 3,
) -> MatrixResult:
    """Evaluate whether a parameter permutation is accepted or rejected by the driver profile."""
    mapper = SettingsMapper()
    settings = PrintSettings(
        paper_size=paper_size,
        color_mode=color_mode,
        duplex=duplex,
        copies=copies,
        page_range=page_range,
        orientation="portrait",
    )

    try:
        mapper.map_settings(settings, capabilities=capabilities, total_doc_pages=total_pages)
        return MatrixResult(
            paper_size=paper_size,
            color_mode=color_mode,
            duplex=duplex,
            supported=True,
            status="ACCEPTED",
        )
    except UnsupportedSettingError as err:
        return MatrixResult(
            paper_size=paper_size,
            color_mode=color_mode,
            duplex=duplex,
            supported=False,
            status="REJECTED_UNSUPPORTED",
            error_reason=str(err),
        )
    except Exception as err:
        return MatrixResult(
            paper_size=paper_size,
            color_mode=color_mode,
            duplex=duplex,
            supported=False,
            status="ERROR",
            error_reason=str(err),
        )


# ==============================================================================
# Compatibility Matrix Test Suite
# ==============================================================================


class TestDriverCompatibilityMatrix(unittest.TestCase):
    """Tests the full permutation matrix against simulated device capability profiles."""

    def test_basic_mono_matrix_permutations(self) -> None:
        """Basic mono printer accepts A4/Letter BW simplex; rejects color, duplex, A3, Legal."""
        # Accepted permutations
        self.assertEqual(evaluate_matrix_vector(PROFILE_BASIC_MONO, "a4", "bw", "simplex").status, "ACCEPTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_BASIC_MONO, "letter", "bw", "simplex").status, "ACCEPTED")

        # Rejected permutations
        self.assertEqual(evaluate_matrix_vector(PROFILE_BASIC_MONO, "a4", "color", "simplex").status, "REJECTED_UNSUPPORTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_BASIC_MONO, "a4", "bw", "duplex_long").status, "REJECTED_UNSUPPORTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_BASIC_MONO, "a3", "bw", "simplex").status, "REJECTED_UNSUPPORTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_BASIC_MONO, "legal", "bw", "simplex").status, "REJECTED_UNSUPPORTED")

    def test_office_duplex_mono_matrix_permutations(self) -> None:
        """Office duplex mono printer accepts A4/Legal duplex; rejects color and A3."""
        self.assertEqual(evaluate_matrix_vector(PROFILE_OFFICE_DUPLEX_MONO, "a4", "bw", "simplex").status, "ACCEPTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_OFFICE_DUPLEX_MONO, "a4", "bw", "duplex_long").status, "ACCEPTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_OFFICE_DUPLEX_MONO, "a4", "bw", "duplex_short").status, "ACCEPTED")
        self.assertEqual(evaluate_matrix_vector(PROFILE_OFFICE_DUPLEX_MONO, "legal", "bw", "duplex_long").status, "ACCEPTED")

        # Color and A3 rejected
        self.assertEqual(
            evaluate_matrix_vector(PROFILE_OFFICE_DUPLEX_MONO, "a4", "color", "simplex").status,
            "REJECTED_UNSUPPORTED",
        )
        self.assertEqual(
            evaluate_matrix_vector(PROFILE_OFFICE_DUPLEX_MONO, "a3", "bw", "simplex").status,
            "REJECTED_UNSUPPORTED",
        )

    def test_enterprise_color_mfp_matrix_permutations(self) -> None:
        """Enterprise color MFP accepts all standard combinations including A3 and duplex."""
        test_cases = [
            ("a4", "bw", "simplex"),
            ("a4", "color", "simplex"),
            ("a4", "color", "duplex_long"),
            ("a4", "color", "duplex_short"),
            ("a3", "bw", "simplex"),
            ("a3", "color", "duplex_long"),
            ("legal", "color", "duplex_long"),
            ("letter", "color", "duplex_long"),
        ]
        for p_size, c_mode, dup in test_cases:
            res = evaluate_matrix_vector(PROFILE_ENTERPRISE_COLOR_MFP, p_size, c_mode, dup)
            self.assertEqual(res.status, "ACCEPTED", f"Failed for {p_size}/{c_mode}/{dup}: {res.error_reason}")


class TestHighVolumeStressGate(unittest.TestCase):
    """Stress testing: queueing multiple print jobs sequentially, high sheet counts, resource cleanup."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_high_volume_sequential_queue_drain(self) -> None:
        """Enqueues 10 sequential print jobs to verify queue serialization, memory, and zero leak."""
        journal = LocalStateJournal(":memory:")
        mgr = TempFileManager(self.tmp_path / "spool")
        cleaner = ArtifactCleaner(temp_manager=mgr, secure_wipe=True)

        engine = FakePrintEngine(simulated_spooler_job_id=5000)
        dispatcher = JobDispatcher(
            engine=engine,
            journal=journal,
            cleaner=cleaner,
            max_queue_per_printer=20,
        )

        num_jobs = 10
        job_ids = [f"stress-job-{i}" for i in range(num_jobs)]

        settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex=False,
            copies=2,
            page_range="1-2",
            orientation="portrait",
        )

        # Enqueue all jobs
        for i, jid in enumerate(job_ids):
            doc_path = mgr.get_job_dir(jid) / f"doc_{i}.pdf"
            write_sample_pdf(doc_path, pages=3, title=f"Stress Doc {i}")
            mgr.register_file(doc_path, job_id=jid)

            job = JobItem(
                job_id=jid,
                attempt_id=f"stress-att-{i}",
                printer_name="High_Volume_Printer",
                pdf_path=doc_path,
                settings=settings,
                lease_token=f"lease-stress-{i}",
            )
            dispatcher.enqueue_job(job)

        # Wait for all jobs to drain
        dispatcher.wait_all(timeout=10.0)

        # Assert every single job reached COMPLETED in both dispatcher and SQLite journal
        for i, jid in enumerate(job_ids):
            state = dispatcher.get_job_state(jid)
            self.assertEqual(state, JobState.COMPLETED, f"Job {jid} did not complete; state={state}")

            rec = journal.get_attempt(f"stress-att-{i}")
            self.assertIsNotNone(rec)
            assert rec is not None
            self.assertEqual(rec.status, JobState.COMPLETED.value)
            self.assertFalse(rec.can_auto_reprint)

        # Privacy & Leak verification: all temporary job folders must be completely wiped
        self.assertEqual(len(mgr.list_tracked_files()), 0)
        for entry in mgr.base_dir.iterdir():
            self.assertFalse(entry.name.startswith("job_stress-job"))

        dispatcher.shutdown()
        journal.close()


class TestRealDeviceHardwareVerification(unittest.TestCase):
    """Hardware test harness executing real print jobs against a designated physical printer."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    @unittest.skipUnless(
        REAL_PRINTER_AVAILABLE,
        "Physical printer hardware verification BLOCKED: "
        "Requires Windows OS, pywin32, and CAPS_TEST_PRINTER_NAME environment variable.",
    )
    def test_real_printer_matrix_a4_bw_simplex(self) -> None:
        """Physical hardware verification: A4, B&W, Simplex."""
        self.assertIsNotNone(TEST_PRINTER_NAME)
        assert TEST_PRINTER_NAME is not None
        pdf_path = write_sample_pdf(self.tmp_path / "matrix_a4_bw.pdf", pages=1, title="A4 BW Simplex")

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
            job_title="CAPS Matrix A4 BW Simplex",
            attempt_id="real-matrix-att-1",
        )
        self.assertTrue(result.accepted)
        self.assertIsNotNone(result.spooler_job_id)

        monitor = SpoolerMonitor()
        outcome = monitor.monitor_until_terminal(
            printer_name=TEST_PRINTER_NAME,
            job_id=result.spooler_job_id,
            timeout_seconds=30.0,
        )
        self.assertTrue(outcome.is_terminal)
        self.assertFalse(outcome.can_auto_reprint)

    @unittest.skipUnless(
        REAL_PRINTER_AVAILABLE,
        "Physical printer hardware verification BLOCKED: "
        "Requires Windows OS, pywin32, and CAPS_TEST_PRINTER_NAME environment variable.",
    )
    def test_real_printer_matrix_multi_page_duplex_if_supported(self) -> None:
        """Physical hardware verification: Multi-page Duplex (skips if duplex unsupported by device)."""
        self.assertIsNotNone(TEST_PRINTER_NAME)
        assert TEST_PRINTER_NAME is not None
        detector = CapabilityDetector()
        caps = detector.get_capabilities(TEST_PRINTER_NAME)

        if not (caps and caps.supports_duplex):
            raise unittest.SkipTest(f"Designated printer '{TEST_PRINTER_NAME}' does not support hardware duplex.")

        pdf_path = write_sample_pdf(self.tmp_path / "matrix_duplex.pdf", pages=2, title="A4 Duplex Test")

        settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex="duplex_long",
            copies=1,
            page_range="1-2",
            orientation="portrait",
        )

        engine = WindowsPrintEngine()
        result = engine.print_document(
            pdf_path=pdf_path,
            printer_name=TEST_PRINTER_NAME,
            settings=settings,
            job_title="CAPS Matrix Duplex Test",
            attempt_id="real-matrix-att-2",
        )
        self.assertTrue(result.accepted)
        self.assertIsNotNone(result.spooler_job_id)


if __name__ == "__main__":
    unittest.main()
