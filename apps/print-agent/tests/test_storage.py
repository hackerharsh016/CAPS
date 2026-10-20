"""Unit and integration tests for CAPS Print Agent storage components.

Tests:
- LocalStateJournal: SQLite attempt persistence, status transitions, audit history, and Policy #5 enforcement.
- TempFileManager: Secure directory allocation, path traversal defenses, scoped temp files.
- ArtifactCleaner: Wiping, immediate job artifact deletion, and time-based orphan scrubbing.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import pytest

from caps_agent.jobs.state_machine import JobState
from caps_agent.storage.cleanup import ArtifactCleaner
from caps_agent.storage.local_state import LocalStateJournal
from caps_agent.storage.temp_files import PathTraversalSecurityError, TempFileManager


class TestLocalStateJournal:
    """Tests for SQLite-backed durable attempt journal."""

    def test_in_memory_journal_init(self) -> None:
        journal = LocalStateJournal(":memory:")
        assert journal.get_active_attempts() == []
        journal.close()

    def test_on_disk_journal_init(self, tmp_path: Path) -> None:
        db_file = tmp_path / "subdir" / "agent_state.db"
        journal = LocalStateJournal(db_file)
        assert db_file.exists()

        attempt = journal.record_claim(
            job_id="job-101",
            attempt_id="att-101",
            printer_name="Office_Laser",
            lease_token="lease-token-abc",
            shop_id="shop-1",
        )
        assert attempt.attempt_id == "att-101"
        assert attempt.job_id == "job-101"
        assert attempt.status == JobState.CLAIMED.value
        assert attempt.can_auto_reprint is False

        journal.close()

        # Reopen on-disk database and verify persistence
        reopened = LocalStateJournal(db_file)
        retrieved = reopened.get_attempt("att-101")
        assert retrieved is not None
        assert retrieved.job_id == "job-101"
        reopened.close()

    def test_record_claim_idempotency(self) -> None:
        journal = LocalStateJournal(":memory:")
        att1 = journal.record_claim(
            job_id="job-1",
            attempt_id="att-1",
            printer_name="Receipt_Printer",
            lease_token="token-1",
        )
        att2 = journal.record_claim(
            job_id="job-1",
            attempt_id="att-1",
            printer_name="Receipt_Printer",
            lease_token="token-1",
        )
        assert att1.attempt_id == att2.attempt_id
        journal.close()

    def test_status_transitions_and_history(self) -> None:
        journal = LocalStateJournal(":memory:")
        journal.record_claim(
            job_id="job-2",
            attempt_id="att-2",
            printer_name="HP_LaserJet",
            lease_token="tok-2",
            initial_status=JobState.QUEUED,
        )

        journal.update_status("att-2", JobState.DOWNLOADING, reason="Fetch PDF from cloud")
        journal.update_status("att-2", JobState.VALIDATING, reason="Validate PDF format and page count")
        journal.update_status("att-2", JobState.RENDERING, reason="Rasterize at 300 DPI")
        journal.update_status("att-2", JobState.PRINTING, reason="Submitted to spooler")

        history = journal.get_attempt_history("att-2")
        assert len(history) >= 5

        statuses = [evt.to_status for evt in history]
        assert JobState.QUEUED.value in statuses
        assert JobState.DOWNLOADING.value in statuses
        assert JobState.PRINTING.value in statuses

        journal.close()

    def test_spooler_submission_and_completion(self) -> None:
        journal = LocalStateJournal(":memory:")
        journal.record_claim(
            job_id="job-3",
            attempt_id="att-3",
            printer_name="Canon_TS9000",
            lease_token="tok-3",
        )

        journal.record_spooler_submission(
            attempt_id="att-3",
            spooler_job_id=452,
            pages_submitted=5,
            total_bytes_written=1048576,
        )

        record = journal.get_attempt("att-3")
        assert record is not None
        assert record.spooler_job_id == 452
        assert record.pages_submitted == 5
        assert record.total_bytes_written == 1048576

        journal.record_completion("att-3", details={"pages": 5})
        finished = journal.get_attempt("att-3")
        assert finished is not None
        assert finished.status == JobState.COMPLETED.value
        assert finished.can_auto_reprint is False

        # Should not be in active attempts
        assert journal.get_active_attempts() == []

        journal.close()

    def test_failure_recording(self) -> None:
        journal = LocalStateJournal(":memory:")
        journal.record_claim(
            job_id="job-4",
            attempt_id="att-4",
            printer_name="Epson_EcoTank",
            lease_token="tok-4",
        )

        journal.record_failure(
            attempt_id="att-4",
            error_code="PAPER_JAM",
            error_message="Printer reported hardware paper jam",
            details={"tray": 1},
        )

        failed = journal.get_attempt("att-4")
        assert failed is not None
        assert failed.status == JobState.FAILED.value
        assert failed.error_code == "PAPER_JAM"
        assert "paper jam" in failed.error_message
        assert failed.can_auto_reprint is False
        assert journal.get_active_attempts() == []

        journal.close()

    def test_unknown_requires_review_policy_5(self) -> None:
        """Enforces Non-Negotiable Policy #5 in SQLite records."""
        journal = LocalStateJournal(":memory:")
        journal.record_claim(
            job_id="job-5",
            attempt_id="att-5",
            printer_name="Zebra_Label",
            lease_token="tok-5",
        )

        journal.record_spooler_submission("att-5", spooler_job_id=999)
        journal.record_unknown_requires_review(
            attempt_id="att-5",
            error_code="SPOOLER_TIMEOUT",
            reason="Spooler job disappeared unexpectedly",
        )

        rec = journal.get_attempt("att-5")
        assert rec is not None
        assert rec.status == JobState.UNKNOWN_REQUIRES_REVIEW.value
        assert rec.can_auto_reprint is False
        assert journal.get_active_attempts() == []

        journal.close()

    def test_get_attempts_for_job(self) -> None:
        journal = LocalStateJournal(":memory:")
        journal.record_claim("job-multi", "att-m1", "Printer_A", "tok-1")
        journal.record_failure("att-m1", "TIMEOUT", "First attempt timed out")
        journal.record_claim("job-multi", "att-m2", "Printer_A", "tok-2")

        attempts = journal.get_attempts_for_job("job-multi")
        assert len(attempts) == 2
        assert attempts[0].attempt_id == "att-m1"
        assert attempts[1].attempt_id == "att-m2"

        journal.close()

    def test_concurrent_journal_access(self) -> None:
        """Verify thread-safety and no SQLite locking issues under concurrent claims."""
        journal = LocalStateJournal(":memory:")
        errors: list[Exception] = []

        def worker(idx: int) -> None:
            try:
                for i in range(10):
                    job_id = f"job-th-{idx}-{i}"
                    att_id = f"att-th-{idx}-{i}"
                    journal.record_claim(job_id, att_id, "Printer_Conc", f"tok-{idx}-{i}")
                    journal.update_status(att_id, JobState.RENDERING)
                    journal.record_completion(att_id)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == []
        assert len(journal.get_active_attempts()) == 0
        journal.close()


class TestTempFileManager:
    """Tests for secure temp file management and path traversal defenses."""

    def test_directory_creation_and_containment(self, tmp_path: Path) -> None:
        mgr = TempFileManager(tmp_path / "spool_test")
        job_dir = mgr.get_job_dir("job-uuid-123", attempt_id="att-456")
        assert job_dir.exists()
        assert job_dir.is_dir()
        assert "job-uuid-123" in str(job_dir)
        assert "att-456" in str(job_dir)
        assert str(job_dir).startswith(str(mgr.base_dir))

    @pytest.mark.parametrize(
        "bad_id",
        [
            "../secret",
            "..\\secret",
            "job/traversal",
            "job\\traversal",
            "job\0null",
            "job;cat /etc/passwd",
            "job|cmd",
            "../../",
            "",
        ],
    )
    def test_path_traversal_rejection(self, tmp_path: Path, bad_id: str) -> None:
        mgr = TempFileManager(tmp_path / "spool_test")
        with pytest.raises(PathTraversalSecurityError):
            mgr.get_job_dir(bad_id)

    def test_create_temp_file_and_registration(self, tmp_path: Path) -> None:
        mgr = TempFileManager(tmp_path / "spool_test")
        temp_file = mgr.create_temp_file("job-abc", suffix=".pdf", prefix="input_")
        assert temp_file.exists()
        assert temp_file.name.startswith("input_")
        assert temp_file.name.endswith(".pdf")

        tracked = mgr.list_job_files("job-abc")
        assert temp_file in tracked

        deleted = mgr.cleanup_job_files("job-abc")
        assert deleted >= 1
        assert not temp_file.exists()

    def test_register_and_cleanup_job_files(self, tmp_path: Path) -> None:
        mgr = TempFileManager(tmp_path / "spool_test")
        job_dir = mgr.get_job_dir("job-clean")

        f1 = job_dir / "page_1.bmp"
        f1.write_bytes(b"bitmap1")
        f2 = job_dir / "page_2.bmp"
        f2.write_bytes(b"bitmap2")

        mgr.register_file(f1, job_id="job-clean")
        mgr.register_file(f2, job_id="job-clean")

        assert len(mgr.list_job_files("job-clean")) == 2

        count = mgr.cleanup_job_files("job-clean")
        assert count == 2
        assert not f1.exists()
        assert not f2.exists()
        assert not job_dir.exists()


class TestArtifactCleaner:
    """Tests for file wiping, immediate cleanup, and orphan scrubbing."""

    def test_wipe_and_unlink(self, tmp_path: Path) -> None:
        cleaner = ArtifactCleaner(base_dir=tmp_path, secure_wipe=True)
        secret_file = tmp_path / "confidential.pdf"
        secret_file.write_bytes(b"Top secret customer document data")

        freed = cleaner.wipe_and_unlink(secret_file)
        assert freed > 0
        assert not secret_file.exists()

    def test_cleanup_job(self, tmp_path: Path) -> None:
        mgr = TempFileManager(tmp_path / "spool")
        cleaner = ArtifactCleaner(temp_manager=mgr)

        job_dir = mgr.get_job_dir("job-wipe")
        sample_file = job_dir / "raster.bmp"
        sample_file.write_bytes(b"raster content")
        mgr.register_file(sample_file, job_id="job-wipe")

        report = cleaner.cleanup_job("job-wipe")
        assert report.files_deleted >= 1
        assert not sample_file.exists()
        assert not job_dir.exists()

    def test_cleanup_orphans_with_age_filter(self, tmp_path: Path) -> None:
        spool_dir = tmp_path / "spool"
        spool_dir.mkdir()
        cleaner = ArtifactCleaner(base_dir=spool_dir)

        # 1. Stale directory (older than 10s)
        old_dir = spool_dir / "job_old123"
        old_dir.mkdir()
        old_file = old_dir / "old_doc.pdf"
        old_file.write_bytes(b"stale data")

        # 2. Fresh directory (recent)
        new_dir = spool_dir / "job_new456"
        new_dir.mkdir()
        new_file = new_dir / "new_doc.pdf"
        new_file.write_bytes(b"fresh data")

        # Backdate old file and dir modified time
        past_time = time.time() - 3600
        os.utime(old_file, (past_time, past_time))
        os.utime(old_dir, (past_time, past_time))

        report = cleaner.cleanup_orphans(max_age_seconds=60.0)
        assert report.files_deleted >= 1
        assert report.dirs_deleted >= 1
        assert not old_dir.exists()
        assert new_dir.exists()
        assert new_file.exists()

    def test_cleanup_orphans_excludes_active_jobs(self, tmp_path: Path) -> None:
        spool_dir = tmp_path / "spool"
        spool_dir.mkdir()
        cleaner = ArtifactCleaner(base_dir=spool_dir)

        # Directory for an active job that is theoretically old
        active_dir = spool_dir / "job_active999"
        active_dir.mkdir()
        active_file = active_dir / "in_flight.pdf"
        active_file.write_bytes(b"in flight print job")

        past_time = time.time() - 7200
        os.utime(active_file, (past_time, past_time))
        os.utime(active_dir, (past_time, past_time))

        # Pass active999 in exclusion set
        report = cleaner.cleanup_orphans(max_age_seconds=60.0, exclude_active_job_ids={"active999"})
        assert report.dirs_deleted == 0
        assert active_dir.exists()
        assert active_file.exists()
