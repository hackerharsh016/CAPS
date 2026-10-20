"""Unit and scenario tests for CAPS Print Agent startup crash recovery and reconciliation.

Tests:
- Startup reconciliation of jobs interrupted prior to spooler submission -> FAILED
- Startup reconciliation of jobs confirmed completed by Windows Spooler -> COMPLETED
- Startup reconciliation of jobs with unconfirmed/disappeared spooler status -> UNKNOWN_REQUIRES_REVIEW
- Strict adherence to Non-Negotiable Policy #5: can_auto_reprint is False, no blind resubmission
- Residual temp file and orphan scrubbing upon crash restart
- Full end-to-end integration between JobDispatcher, LocalStateJournal, and ArtifactCleaner
"""

from __future__ import annotations

from pathlib import Path

from caps_agent.jobs.dispatcher import JobDispatcher, JobItem
from caps_agent.jobs.recovery import StartupRecoveryCoordinator
from caps_agent.jobs.state_machine import JobState
from caps_agent.printing.engine import PrintResult, PrintSettings
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.printing.spooler_monitor import (
    JOB_STATUS_COMPLETE,
    JOB_STATUS_PRINTED,
    FakeWin32JobQueryAdapter,
)
from caps_agent.storage.cleanup import ArtifactCleaner
from caps_agent.storage.local_state import LocalStateJournal
from caps_agent.storage.temp_files import TempFileManager


class TestStartupCrashRecovery:
    """Tests for StartupRecoveryCoordinator crash recovery logic and Policy #5."""

    def test_reconcile_job_crashed_before_spooler_submission(self, tmp_path: Path) -> None:
        """Jobs interrupted in QUEUED/DOWNLOADING/RENDERING were never spool-submitted -> FAILED."""
        journal = LocalStateJournal(":memory:")
        mock_adapter = FakeWin32JobQueryAdapter()
        cleaner = ArtifactCleaner(base_dir=tmp_path)
        coordinator = StartupRecoveryCoordinator(journal, query_adapter=mock_adapter, cleaner=cleaner)

        # Job 1 interrupted during downloading
        journal.record_claim("job-pre-1", "att-pre-1", "Printer_A", "lease-1")
        journal.update_status("att-pre-1", JobState.DOWNLOADING)

        # Job 2 interrupted during rendering
        journal.record_claim("job-pre-2", "att-pre-2", "Printer_A", "lease-2")
        journal.update_status("att-pre-2", JobState.RENDERING)

        report = coordinator.reconcile_startup()

        assert report.total_interrupted == 2
        assert report.requires_manual_review_count == 0

        # Verify DB states
        rec1 = journal.get_attempt("att-pre-1")
        assert rec1 is not None
        assert rec1.status == JobState.FAILED.value
        assert rec1.can_auto_reprint is False
        assert rec1.error_code == "AGENT_CRASH_BEFORE_SPOOLER"

        rec2 = journal.get_attempt("att-pre-2")
        assert rec2 is not None
        assert rec2.status == JobState.FAILED.value
        assert rec2.can_auto_reprint is False

        # No active attempts remaining
        assert journal.get_active_attempts() == []
        journal.close()

    def test_reconcile_job_spooler_confirmed_completed(self, tmp_path: Path) -> None:
        """If Windows Spooler reports job was completed during crash, mark COMPLETED."""
        journal = LocalStateJournal(":memory:")
        mock_adapter = FakeWin32JobQueryAdapter()
        cleaner = ArtifactCleaner(base_dir=tmp_path)
        coordinator = StartupRecoveryCoordinator(journal, query_adapter=mock_adapter, cleaner=cleaner)

        journal.record_claim("job-spool-ok", "att-spool-ok", "Laser_Office", "lease-ok")
        journal.update_status("att-spool-ok", JobState.PRINTING)
        journal.record_spooler_submission("att-spool-ok", spooler_job_id=201)

        # Configure mock spooler to report job 201 completed
        mock_adapter.set_job(
            printer_name="Laser_Office",
            job_id=201,
            status_flags=JOB_STATUS_COMPLETE | JOB_STATUS_PRINTED,
            pages_printed=3,
            total_pages=3,
        )

        report = coordinator.reconcile_startup()
        assert report.total_interrupted == 1
        assert report.requires_manual_review_count == 0

        rec = journal.get_attempt("att-spool-ok")
        assert rec is not None
        assert rec.status == JobState.COMPLETED.value
        assert rec.can_auto_reprint is False
        assert journal.get_active_attempts() == []
        journal.close()

    def test_reconcile_job_spooler_disappeared_enforces_policy_5(self, tmp_path: Path) -> None:
        """Policy #5: If spooler job disappeared after restart, MUST mark UNKNOWN_REQUIRES_REVIEW.

        Must NOT auto-reprint or resubmit.
        """
        journal = LocalStateJournal(":memory:")
        mock_adapter = FakeWin32JobQueryAdapter()  # Empty: job 777 does not exist in spooler
        cleaner = ArtifactCleaner(base_dir=tmp_path)
        coordinator = StartupRecoveryCoordinator(journal, query_adapter=mock_adapter, cleaner=cleaner)

        journal.record_claim("job-missing", "att-missing", "Laser_Office", "lease-miss")
        journal.update_status("att-missing", JobState.PRINTING)
        journal.record_spooler_submission("att-missing", spooler_job_id=777)

        report = coordinator.reconcile_startup()

        assert report.total_interrupted == 1
        assert report.requires_manual_review_count == 1
        assert len(report.reconciled_jobs) == 1

        reconciled = report.reconciled_jobs[0]
        assert reconciled.job_id == "job-missing"
        assert reconciled.new_status == JobState.UNKNOWN_REQUIRES_REVIEW.value
        assert reconciled.requires_review is True
        assert reconciled.can_auto_reprint is False

        rec = journal.get_attempt("att-missing")
        assert rec is not None
        assert rec.status == JobState.UNKNOWN_REQUIRES_REVIEW.value
        assert rec.can_auto_reprint is False
        assert rec.error_code == "CRASH_RECOVERY_UNKNOWN_OUTCOME"
        assert journal.get_active_attempts() == []
        journal.close()

    def test_reconcile_residual_temp_file_scrubbing(self, tmp_path: Path) -> None:
        """Verifies residual spool files of crashed jobs are safely deleted during startup."""
        journal = LocalStateJournal(":memory:")
        mock_adapter = FakeWin32JobQueryAdapter()
        mgr = TempFileManager(tmp_path / "spool")
        cleaner = ArtifactCleaner(temp_manager=mgr)
        coordinator = StartupRecoveryCoordinator(journal, query_adapter=mock_adapter, cleaner=cleaner)

        # Create crash attempt with physical files
        journal.record_claim("job-residue", "att-residue", "Printer_A", "lease-r")
        journal.update_status("att-residue", JobState.RENDERING)

        job_dir = mgr.get_job_dir("job-residue")
        doc = job_dir / "interrupted_doc.pdf"
        doc.write_bytes(b"residual PDF content")
        bmp = job_dir / "page_1.bmp"
        bmp.write_bytes(b"residual raster")
        mgr.register_file(doc, job_id="job-residue")
        mgr.register_file(bmp, job_id="job-residue")

        assert doc.exists()
        assert bmp.exists()

        report = coordinator.reconcile_startup()
        assert report.total_interrupted == 1
        assert report.cleanup_report.files_deleted >= 2

        # Files should now be purged
        assert not doc.exists()
        assert not bmp.exists()
        assert not job_dir.exists()
        journal.close()


class TestDispatcherStorageIntegration:
    """Integration tests verifying JobDispatcher writes to LocalStateJournal and cleans up artifacts."""

    def test_dispatcher_with_journal_successful_job(self, tmp_path: Path) -> None:
        journal = LocalStateJournal(":memory:")
        mgr = TempFileManager(tmp_path / "spool")
        cleaner = ArtifactCleaner(temp_manager=mgr)

        engine = FakePrintEngine(simulated_spooler_job_id=987)
        dispatcher = JobDispatcher(
            engine=engine,
            journal=journal,
            cleaner=cleaner,
        )

        # Create dummy job file
        job_dir = mgr.get_job_dir("job-int-1")
        pdf_path = job_dir / "sample.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 mock")
        mgr.register_file(pdf_path, job_id="job-int-1")

        settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1",
            orientation="portrait",
        )
        job_item = JobItem(
            job_id="job-int-1",
            attempt_id="att-int-1",
            printer_name="Fake_Laser",
            pdf_path=pdf_path,
            settings=settings,
            lease_token="lease-int-1",
        )

        sm = dispatcher.enqueue_job(job_item)
        assert sm.job_id == "job-int-1"
        terminal_state = dispatcher.wait_for_job("job-int-1", timeout=5.0)

        assert terminal_state == JobState.COMPLETED

        # Verify SQLite journal
        record = journal.get_attempt("att-int-1")
        assert record is not None
        assert record.status == JobState.COMPLETED.value
        assert record.spooler_job_id == 987
        assert record.can_auto_reprint is False

        # Verify audit history
        history = journal.get_attempt_history("att-int-1")
        to_statuses = [h.to_status for h in history]
        assert JobState.QUEUED.value in to_statuses
        assert JobState.PRINTING.value in to_statuses
        assert JobState.COMPLETED.value in to_statuses

        # Verify artifacts cleaned up by cleaner
        assert not pdf_path.exists()
        assert not job_dir.exists()

        dispatcher.shutdown()
        journal.close()

    def test_dispatcher_with_journal_unknown_outcome_policy_5(self, tmp_path: Path) -> None:
        """When engine returns ambiguous outcome, journal records UNKNOWN_REQUIRES_REVIEW."""
        journal = LocalStateJournal(":memory:")
        engine = FakePrintEngine()
        # Mock engine to simulate UNKNOWN outcome
        engine.print_document = lambda **kwargs: PrintResult(  # type: ignore[method-assign]
            accepted=False,
            spooler_job_id=555,
            error="Spooler communication timeout",
            error_code="SPOOLER_TIMEOUT",
            can_auto_reprint=False,
        )

        dispatcher = JobDispatcher(
            engine=engine,
            journal=journal,
        )

        settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        job_item = JobItem(
            job_id="job-unknown",
            attempt_id="att-unknown",
            printer_name="Fake_Zebra",
            pdf_path=tmp_path / "dummy.pdf",
            settings=settings,
            lease_token="lease-unk",
        )

        dispatcher.enqueue_job(job_item)
        terminal_state = dispatcher.wait_for_job("job-unknown", timeout=5.0)

        assert terminal_state == JobState.UNKNOWN_REQUIRES_REVIEW

        record = journal.get_attempt("att-unknown")
        assert record is not None
        assert record.status == JobState.UNKNOWN_REQUIRES_REVIEW.value
        assert record.can_auto_reprint is False

        dispatcher.shutdown()
        journal.close()
