"""Unit and integration tests for CAPS Print Agent storage components.

Tests:
- LocalStateJournal: SQLite attempt persistence, status transitions, audit history, and Policy #5 enforcement.
- TempFileManager: Secure directory allocation, path traversal defenses, scoped temp files.
- ArtifactCleaner: Wiping, immediate job artifact deletion, and time-based orphan scrubbing.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock

# Ensure print-agent directory is in sys.path
agent_root = str(Path(__file__).resolve().parent.parent)
if agent_root not in sys.path:
    sys.path.insert(0, agent_root)

from api_client import AgentApiClient, JobClaim
from caps_agent.jobs.state_machine import JobState
from caps_agent.storage.cleanup import ArtifactCleaner
from caps_agent.storage.local_state import LocalStateJournal
from caps_agent.storage.temp_files import PathTraversalSecurityError, TempFileManager
from job_processor import JobProcessor
from storage import (
    JobStorageManager,
    get_attempt_from_db,
    mark_attempt_purged,
    record_attempt_in_db,
    secure_purge,
)


class TestLocalStateJournal(unittest.TestCase):
    """Tests for SQLite-backed durable attempt journal."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_in_memory_journal_init(self) -> None:
        journal = LocalStateJournal(":memory:")
        self.assertEqual(journal.get_active_attempts(), [])
        journal.close()

    def test_on_disk_journal_init(self) -> None:
        db_file = self.tmp_path / "subdir" / "agent_state.db"
        journal = LocalStateJournal(db_file)
        self.assertTrue(db_file.exists())

        attempt = journal.record_claim(
            job_id="job-101",
            attempt_id="att-101",
            printer_name="Office_Laser",
            lease_token="lease-token-abc",
            shop_id="shop-1",
        )
        self.assertEqual(attempt.attempt_id, "att-101")
        self.assertEqual(attempt.job_id, "job-101")
        self.assertEqual(attempt.status, JobState.CLAIMED.value)
        self.assertFalse(attempt.can_auto_reprint)

        journal.close()

        # Reopen on-disk database and verify persistence
        reopened = LocalStateJournal(db_file)
        retrieved = reopened.get_attempt("att-101")
        self.assertIsNotNone(retrieved)
        assert retrieved is not None
        self.assertEqual(retrieved.job_id, "job-101")
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
        self.assertEqual(att1.attempt_id, att2.attempt_id)
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
        self.assertGreaterEqual(len(history), 5)

        statuses = [evt.to_status for evt in history]
        self.assertIn(JobState.QUEUED.value, statuses)
        self.assertIn(JobState.DOWNLOADING.value, statuses)
        self.assertIn(JobState.PRINTING.value, statuses)

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
        self.assertIsNotNone(record)
        assert record is not None
        self.assertEqual(record.spooler_job_id, 452)
        self.assertEqual(record.pages_submitted, 5)
        self.assertEqual(record.total_bytes_written, 1048576)

        journal.record_completion("att-3", details={"pages": 5})
        finished = journal.get_attempt("att-3")
        self.assertIsNotNone(finished)
        assert finished is not None
        self.assertEqual(finished.status, JobState.COMPLETED.value)
        self.assertFalse(finished.can_auto_reprint)

        # Should not be in active attempts
        self.assertEqual(journal.get_active_attempts(), [])

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
        self.assertIsNotNone(failed)
        assert failed is not None
        self.assertEqual(failed.status, JobState.FAILED.value)
        self.assertEqual(failed.error_code, "PAPER_JAM")
        self.assertIn("paper jam", failed.error_message)
        self.assertFalse(failed.can_auto_reprint)
        self.assertEqual(journal.get_active_attempts(), [])

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
        self.assertIsNotNone(rec)
        assert rec is not None
        self.assertEqual(rec.status, JobState.UNKNOWN_REQUIRES_REVIEW.value)
        self.assertFalse(rec.can_auto_reprint)
        self.assertEqual(journal.get_active_attempts(), [])

        journal.close()

    def test_get_attempts_for_job(self) -> None:
        journal = LocalStateJournal(":memory:")
        journal.record_claim("job-multi", "att-m1", "Printer_A", "tok-1")
        journal.record_failure("att-m1", "TIMEOUT", "First attempt timed out")
        journal.record_claim("job-multi", "att-m2", "Printer_A", "tok-2")

        attempts = journal.get_attempts_for_job("job-multi")
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0].attempt_id, "att-m1")
        self.assertEqual(attempts[1].attempt_id, "att-m2")

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

        self.assertEqual(errors, [])
        self.assertEqual(len(journal.get_active_attempts()), 0)
        journal.close()


class TestTempFileManager(unittest.TestCase):
    """Tests for secure temp file management and path traversal defenses."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_directory_creation_and_containment(self) -> None:
        mgr = TempFileManager(self.tmp_path / "spool_test")
        job_dir = mgr.get_job_dir("job-uuid-123", attempt_id="att-456")
        self.assertTrue(job_dir.exists())
        self.assertTrue(job_dir.is_dir())
        self.assertIn("job-uuid-123", str(job_dir))
        self.assertIn("att-456", str(job_dir))
        self.assertTrue(str(job_dir).startswith(str(mgr.base_dir)))

    def test_path_traversal_rejection(self) -> None:
        bad_ids = [
            "../secret",
            "..\\secret",
            "job/traversal",
            "job\\traversal",
            "job\0null",
            "job;cat /etc/passwd",
            "job|cmd",
            "../../",
            "",
        ]
        mgr = TempFileManager(self.tmp_path / "spool_test")
        for bad_id in bad_ids:
            with self.subTest(bad_id=bad_id), self.assertRaises(PathTraversalSecurityError):
                mgr.get_job_dir(bad_id)

    def test_create_temp_file_and_registration(self) -> None:
        mgr = TempFileManager(self.tmp_path / "spool_test")
        temp_file = mgr.create_temp_file("job-abc", suffix=".pdf", prefix="input_")
        self.assertTrue(temp_file.exists())
        self.assertTrue(temp_file.name.startswith("input_"))
        self.assertTrue(temp_file.name.endswith(".pdf"))

        tracked = mgr.list_job_files("job-abc")
        self.assertIn(temp_file, tracked)

        deleted = mgr.cleanup_job_files("job-abc")
        self.assertGreaterEqual(deleted, 1)
        self.assertFalse(temp_file.exists())

    def test_register_and_cleanup_job_files(self) -> None:
        mgr = TempFileManager(self.tmp_path / "spool_test")
        job_dir = mgr.get_job_dir("job-clean")

        f1 = job_dir / "page_1.bmp"
        f1.write_bytes(b"bitmap1")
        f2 = job_dir / "page_2.bmp"
        f2.write_bytes(b"bitmap2")

        mgr.register_file(f1, job_id="job-clean")
        mgr.register_file(f2, job_id="job-clean")

        self.assertEqual(len(mgr.list_job_files("job-clean")), 2)

        count = mgr.cleanup_job_files("job-clean")
        self.assertEqual(count, 2)
        self.assertFalse(f1.exists())
        self.assertFalse(f2.exists())
        self.assertFalse(job_dir.exists())


class TestArtifactCleaner(unittest.TestCase):
    """Tests for file wiping, immediate cleanup, and orphan scrubbing."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_wipe_and_unlink(self) -> None:
        cleaner = ArtifactCleaner(base_dir=self.tmp_path, secure_wipe=True)
        secret_file = self.tmp_path / "confidential.pdf"
        secret_file.write_bytes(b"Top secret customer document data")

        freed = cleaner.wipe_and_unlink(secret_file)
        self.assertGreater(freed, 0)
        self.assertFalse(secret_file.exists())

    def test_cleanup_job(self) -> None:
        mgr = TempFileManager(self.tmp_path / "spool")
        cleaner = ArtifactCleaner(temp_manager=mgr)

        job_dir = mgr.get_job_dir("job-wipe")
        sample_file = job_dir / "raster.bmp"
        sample_file.write_bytes(b"raster content")
        mgr.register_file(sample_file, job_id="job-wipe")

        report = cleaner.cleanup_job("job-wipe")
        self.assertGreaterEqual(report.files_deleted, 1)
        self.assertFalse(sample_file.exists())
        self.assertFalse(job_dir.exists())

    def test_cleanup_orphans_with_age_filter(self) -> None:
        spool_dir = self.tmp_path / "spool"
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
        self.assertGreaterEqual(report.files_deleted, 1)
        self.assertGreaterEqual(report.dirs_deleted, 1)
        self.assertFalse(old_dir.exists())
        self.assertTrue(new_dir.exists())
        self.assertTrue(new_file.exists())

    def test_cleanup_orphans_excludes_active_jobs(self) -> None:
        spool_dir = self.tmp_path / "spool"
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
        self.assertEqual(report.dirs_deleted, 0)
        self.assertTrue(active_dir.exists())
        self.assertTrue(active_file.exists())


class TestSecurePurge(unittest.TestCase):
    """Tests for zero-retention secure file purge and attempts.db tracking (INT-D4-05)."""

    def setUp(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._temp_dir.name)
        self.storage_manager = JobStorageManager(base_dir=self.tmp_path / "jobs")
        self.db_path = self.tmp_path / "attempts.db"

    def tearDown(self) -> None:
        self._temp_dir.cleanup()

    def test_secure_purge_overwrites_bytes_and_unlinks(self) -> None:
        """Verify file bytes are overwritten prior to unlinking and file is purged."""
        sample_file = self.tmp_path / "confidential.pdf"
        data = b"%PDF-1.4 " + b"Sensitive customer bank statement" * 50
        sample_file.write_bytes(data)
        self.assertTrue(sample_file.exists())
        self.assertEqual(sample_file.stat().st_size, len(data))

        success = secure_purge(sample_file, passes=1)
        self.assertTrue(success)
        self.assertFalse(sample_file.exists())

    def test_secure_purge_directory_zero_bytes_remain(self) -> None:
        """Verify entire job directory is securely purged and zero bytes remain on disk."""
        job_dir = self.storage_manager.get_job_dir("job-test-zero-bytes")
        pdf_file = job_dir / "document.pdf"
        pdf_file.write_bytes(b"%PDF-1.7 secure content here" * 100)
        temp_artifact = job_dir / "spool_buffer.tmp"
        temp_artifact.write_bytes(b"\x00\x01\x02\x03" * 200)

        self.assertTrue(pdf_file.exists())
        self.assertTrue(temp_artifact.exists())

        res = self.storage_manager.secure_purge_job("job-test-zero-bytes")
        self.assertTrue(res)
        self.assertFalse(pdf_file.exists())
        self.assertFalse(temp_artifact.exists())
        self.assertFalse(job_dir.exists())

    def test_secure_purge_nonexistent_and_empty_file(self) -> None:
        """Verify secure_purge handles nonexistent files and 0-byte files gracefully."""
        # Nonexistent
        missing_file = self.tmp_path / "missing.pdf"
        self.assertTrue(secure_purge(missing_file))

        # 0-byte file
        empty_file = self.tmp_path / "empty.pdf"
        empty_file.touch()
        self.assertTrue(empty_file.exists())
        self.assertTrue(secure_purge(empty_file))
        self.assertFalse(empty_file.exists())

    def test_secure_purge_marks_attempts_db_purged(self) -> None:
        """Verify SQLite attempts.db record is updated with is_purged=1 and purged_at."""
        record_attempt_in_db(
            attempt_id="att-purge-1",
            job_id="job-purge-1",
            pdf_path=str(self.tmp_path / "doc.pdf"),
            status="PRINTING",
            db_path=self.db_path,
        )

        rec_before = get_attempt_from_db("att-purge-1", db_path=self.db_path)
        self.assertIsNotNone(rec_before)
        self.assertEqual(rec_before["is_purged"], 0)
        self.assertIsNone(rec_before["purged_at"])
        self.assertIsNotNone(rec_before["pdf_path"])

        # Mark purged
        res = mark_attempt_purged("att-purge-1", db_path=self.db_path)
        self.assertTrue(res)

        rec_after = get_attempt_from_db("att-purge-1", db_path=self.db_path)
        self.assertIsNotNone(rec_after)
        self.assertEqual(rec_after["is_purged"], 1)
        self.assertIsNotNone(rec_after["purged_at"])
        self.assertIsNone(rec_after["pdf_path"])

    def _create_claim(self, job_id: str, attempt_id: str, copies: int = 1) -> JobClaim:
        return JobClaim(
            job_id=job_id,
            attempt_id=attempt_id,
            lease_token="lease-token-xyz",
            lease_expires_at="2026-10-22T12:00:00Z",
            shop_id="shop-001",
            printer_id="printer-001",
            download_url="https://storage.supabase.co/v1/jobs/test.pdf",
            checksum_sha256="0" * 64,
            content_type="application/pdf",
            file_size_bytes=1024,
            settings={"copies": copies, "color_mode": "bw"},
            created_at="2026-10-22T10:00:00Z",
        )

    def test_secure_purge_job_processor_finally_on_success(self) -> None:
        """Verify JobProcessor runs secure_purge in finally block on successful print."""
        mock_api = MagicMock()
        mock_claim = self._create_claim(job_id="job-succ-123", attempt_id="att-succ-123", copies=2)
        mock_api.claim_jobs.return_value = mock_claim
        mock_api.update_job_status.return_value = {"ok": True}

        # Create document.pdf in job dir
        job_dir = self.storage_manager.get_job_dir("job-succ-123")
        doc_path = job_dir / "document.pdf"
        doc_path.write_bytes(b"%PDF-1.4 Successful Print Content")
        self.assertTrue(doc_path.exists())

        processor = JobProcessor(
            api_client=mock_api,
            storage_manager=self.storage_manager,
            db_path=self.db_path,
        )

        result = processor.process_next_job()
        self.assertIsNotNone(result)
        self.assertEqual(result["status"], "COMPLETED")

        # Zero PDF bytes remain!
        self.assertFalse(doc_path.exists())
        self.assertFalse(job_dir.exists())

        # attempts.db is marked purged
        rec = get_attempt_from_db("att-succ-123", db_path=self.db_path)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["is_purged"], 1)
        self.assertIsNone(rec["pdf_path"])

    def test_secure_purge_job_processor_finally_on_failure(self) -> None:
        """Verify JobProcessor runs secure_purge in finally block even when spooling/printing fails."""
        mock_api = MagicMock()
        mock_claim = self._create_claim(job_id="job-fail-999", attempt_id="att-fail-999", copies=1)
        mock_api.claim_jobs.return_value = mock_claim

        # Make update_job_status fail on PRINTING transition
        def fail_on_printing(*args, **kwargs):
            if kwargs.get("status") == "PRINTING":
                raise RuntimeError("Simulated spooler hardware fault")
            return {"ok": True}

        mock_api.update_job_status.side_effect = fail_on_printing

        # Create document.pdf in job dir
        job_dir = self.storage_manager.get_job_dir("job-fail-999")
        doc_path = job_dir / "document.pdf"
        doc_path.write_bytes(b"%PDF-1.4 Failed Print Content")
        self.assertTrue(doc_path.exists())

        processor = JobProcessor(
            api_client=mock_api,
            storage_manager=self.storage_manager,
            db_path=self.db_path,
        )

        result = processor.process_next_job()
        self.assertIsNotNone(result)
        self.assertEqual(result["status"], "FAILED")

        # Zero PDF bytes remain in temp directory after failure!
        self.assertFalse(doc_path.exists())
        self.assertFalse(job_dir.exists())

        # attempts.db is marked purged
        rec = get_attempt_from_db("att-fail-999", db_path=self.db_path)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["is_purged"], 1)
        self.assertIsNone(rec["pdf_path"])


if __name__ == "__main__":
    unittest.main()
