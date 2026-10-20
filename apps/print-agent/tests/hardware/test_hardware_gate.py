"""Integration gate verification suite for Windows Print Feasibility (Phase 02).

Validates all 8 core subsystems of the Windows feasibility baseline against
frozen contract mocks, simulated driver profiles, and strict non-reprint policies:
1. Capability Matrix Enforcement
2. Multi-printer Dispatching & Serialization
3. Spooler Traces & Status Classification
4. Non-Negotiable Policy #5 (No auto-reprints on ambiguous outcomes)
5. Local SQLite Journaling & Crash Recovery
6. Privacy Protection & Zero-Trace Artifact Shredding
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from caps_agent.jobs.dispatcher import JobDispatcher, JobItem
from caps_agent.jobs.recovery import StartupRecoveryCoordinator
from caps_agent.jobs.state_machine import JobState
from caps_agent.printing.capabilities import PrinterCapabilities
from caps_agent.printing.engine import (
    PrintSettings,
)
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.printing.settings_mapper import (
    SettingsMapper,
)
from caps_agent.printing.settings_mapper import (
    UnsupportedSettingError as MapperUnsupportedSettingError,
)
from caps_agent.printing.spooler_monitor import (
    JOB_STATUS_COMPLETE,
    JOB_STATUS_PRINTED,
    PRINTER_STATUS_PAPER_JAM,
    FakeWin32JobQueryAdapter,
    SpoolerMonitor,
    SpoolerOutcome,
)
from caps_agent.storage.cleanup import ArtifactCleaner
from caps_agent.storage.local_state import LocalStateJournal
from caps_agent.storage.temp_files import TempFileManager


class TestCapabilityMatrixGate(unittest.TestCase):
    """Gate tests for driver capability detection and settings compatibility matrix."""

    def test_simplex_monochrome_driver_profile(self) -> None:
        """Driver supporting only monochrome A4 simplex must reject color and duplex."""
        caps = PrinterCapabilities(
            printer_id="Office_Mono_Laser",
            name="Office Mono Laser",
            supported_paper_sizes=("a4", "letter"),
            supported_color_modes=("bw",),
            supported_duplex=("simplex",),
            status=0,
        )

        mapper = SettingsMapper()

        # 1. Valid settings within profile -> PASS
        valid_settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex=False,
            copies=2,
            page_range="all",
            orientation="portrait",
        )
        params = mapper.map_settings(valid_settings, capabilities=caps, total_doc_pages=5)
        self.assertEqual(params.canonical_paper_size, "a4")
        self.assertEqual(params.canonical_color_mode, "bw")
        self.assertEqual(params.canonical_duplex_mode, "simplex")

        # 2. Reject color request -> FAIL
        color_settings = PrintSettings(
            paper_size="a4",
            color_mode="color",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(MapperUnsupportedSettingError) as cm:
            mapper.map_settings(color_settings, capabilities=caps, total_doc_pages=5)
        self.assertIn("color", str(cm.exception).lower())

        # 3. Reject duplex request -> FAIL
        duplex_settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex="duplex_long",
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(MapperUnsupportedSettingError) as cm:
            mapper.map_settings(duplex_settings, capabilities=caps, total_doc_pages=5)
        self.assertIn("duplex", str(cm.exception).lower())

    def test_color_duplex_driver_profile(self) -> None:
        """Full-featured driver must support color and duplex options."""
        caps = PrinterCapabilities(
            printer_id="Canon_ImageRunner_Color",
            name="Canon ImageRunner Color",
            supported_paper_sizes=("a4", "a3", "letter", "legal"),
            supported_color_modes=("bw", "color"),
            supported_duplex=("simplex", "duplex_long", "duplex_short"),
            status=0,
        )

        mapper = SettingsMapper()
        settings = PrintSettings(
            paper_size="a3",
            color_mode="color",
            duplex="duplex_long",
            copies=5,
            page_range="1-3",
            orientation="landscape",
        )
        params = mapper.map_settings(settings, capabilities=caps, total_doc_pages=10)
        self.assertEqual(params.canonical_paper_size, "a3")
        self.assertEqual(params.canonical_color_mode, "color")
        self.assertEqual(params.canonical_duplex_mode, "duplex_long")
        self.assertEqual(params.orientation, "landscape")
        self.assertEqual(params.copies, 5)


class TestSpoolerOutcomeClassificationGate(unittest.TestCase):
    """Gate tests for Windows Spooler trace classification and Policy #5."""

    def test_spooler_trace_clean_completion(self) -> None:
        """Verify normal completed spooler lifecycle trace."""
        adapter = FakeWin32JobQueryAdapter()
        monitor = SpoolerMonitor(adapter=adapter)

        # Job spools, prints, completes
        adapter.set_job(
            "Printer_Gate",
            101,
            status_flags=JOB_STATUS_COMPLETE | JOB_STATUS_PRINTED,
            pages_printed=2,
            total_pages=2,
        )

        outcome = monitor.poll_job_status("Printer_Gate", 101)
        self.assertEqual(outcome.outcome, SpoolerOutcome.COMPLETED)
        self.assertTrue(outcome.is_terminal)
        self.assertEqual(outcome.pages_printed, 2)
        self.assertFalse(outcome.can_auto_reprint)

    def test_spooler_trace_hardware_paper_jam(self) -> None:
        """Verify explicit driver paper jam detection."""
        adapter = FakeWin32JobQueryAdapter()
        monitor = SpoolerMonitor(adapter=adapter)

        adapter.set_printer_status("Printer_Gate", PRINTER_STATUS_PAPER_JAM)
        outcome = monitor.poll_job_status("Printer_Gate", 102)

        self.assertEqual(outcome.outcome, SpoolerOutcome.FAILED)
        self.assertIn("paper jam", (outcome.failure_reason or "").lower())
        self.assertFalse(outcome.can_auto_reprint)

    def test_spooler_trace_disappearing_job_policy_5(self) -> None:
        """Verify disappearing spooler job is classified as UNKNOWN without auto-reprint."""
        adapter = FakeWin32JobQueryAdapter()
        monitor = SpoolerMonitor(adapter=adapter)

        # Job not present in spooler
        outcome = monitor.poll_job_status("Printer_Gate", 999)
        self.assertEqual(outcome.outcome, SpoolerOutcome.UNKNOWN)
        self.assertTrue(outcome.is_terminal)
        self.assertFalse(outcome.can_auto_reprint)


class TestFeasibilityEndToEndGate(unittest.TestCase):
    """Full end-to-end integration test exercising all components in concert."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_end_to_end_job_lifecycle_with_privacy_and_audit(self) -> None:
        """Execute full lifecycle:

        Claim -> SQLite Journal -> Protected Temp -> Dispatcher Execution -> Spooler -> Cleanup.
        """
        journal = LocalStateJournal(":memory:")
        mgr = TempFileManager(self.tmp_path / "spool")
        cleaner = ArtifactCleaner(temp_manager=mgr, secure_wipe=True)

        engine = FakePrintEngine(simulated_spooler_job_id=8888)
        dispatcher = JobDispatcher(
            engine=engine,
            journal=journal,
            cleaner=cleaner,
        )

        job_dir = mgr.get_job_dir("gate-job-1")
        sample_doc = job_dir / "confidential_gate.pdf"
        sample_doc.write_bytes(b"%PDF-1.4 mock gate test document")
        mgr.register_file(sample_doc, job_id="gate-job-1")

        settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        job = JobItem(
            job_id="gate-job-1",
            attempt_id="gate-att-1",
            printer_name="Office_Gate_Printer",
            pdf_path=sample_doc,
            settings=settings,
            lease_token="lease-gate-token",
        )

        sm = dispatcher.enqueue_job(job)
        self.assertEqual(sm.job_id, "gate-job-1")

        terminal = dispatcher.wait_for_job("gate-job-1", timeout=5.0)
        self.assertEqual(terminal, JobState.COMPLETED)

        # 1. Journal assertion
        rec = journal.get_attempt("gate-att-1")
        self.assertIsNotNone(rec)
        assert rec is not None
        self.assertEqual(rec.status, JobState.COMPLETED.value)
        self.assertEqual(rec.spooler_job_id, 8888)
        self.assertFalse(rec.can_auto_reprint)

        # 2. Privacy & cleanup assertion: document must not linger on disk
        self.assertFalse(sample_doc.exists())
        self.assertFalse(job_dir.exists())

        dispatcher.shutdown()
        journal.close()

    def test_crash_recovery_reconciliation_gate(self) -> None:
        """Verify crash recovery coordinator reconciles interrupted attempts correctly."""
        journal = LocalStateJournal(":memory:")
        adapter = FakeWin32JobQueryAdapter()
        cleaner = ArtifactCleaner(base_dir=self.tmp_path)
        coordinator = StartupRecoveryCoordinator(journal, query_adapter=adapter, cleaner=cleaner)

        # 1. Job interrupted in rendering before spooler
        journal.record_claim("crash-job-1", "crash-att-1", "Printer_A", "lease-c1")
        journal.update_status("crash-att-1", JobState.RENDERING)

        # 2. Job interrupted in printing with spooler ID (disappeared from spooler)
        journal.record_claim("crash-job-2", "crash-att-2", "Printer_A", "lease-c2")
        journal.update_status("crash-att-2", JobState.PRINTING)
        journal.record_spooler_submission("crash-att-2", spooler_job_id=404)

        report = coordinator.reconcile_startup()
        self.assertEqual(report.total_interrupted, 2)
        self.assertEqual(report.requires_manual_review_count, 1)

        rec1 = journal.get_attempt("crash-att-1")
        self.assertIsNotNone(rec1)
        assert rec1 is not None
        self.assertEqual(rec1.status, JobState.FAILED.value)
        self.assertFalse(rec1.can_auto_reprint)

        rec2 = journal.get_attempt("crash-att-2")
        self.assertIsNotNone(rec2)
        assert rec2 is not None
        self.assertEqual(rec2.status, JobState.UNKNOWN_REQUIRES_REVIEW.value)
        self.assertFalse(rec2.can_auto_reprint)

        journal.close()


if __name__ == "__main__":
    unittest.main()
