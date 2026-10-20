"""Unit and contract tests for CAPS Print Agent attempt status sync and durable retry journal.

Tests cover:
- StatusSyncItem representation and serialization conforming to JobStatusUpdateRequestSchema
- StatusSyncJournal SQLite persistence, FIFO retrieval, acknowledgement, and retries
- Status deduplication (preventing duplicate status submissions for the same attempt)
- Offline retry behavior (queueing during cloud outage and chronological flushing upon recovery)
- Status validation (rejecting non-contract statuses)
- Background worker thread lifecycle
- Dispatcher binding (automatic state machine transition forwarding)
"""

from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from caps_agent.cloud.api_client import CloudApiError
from caps_agent.cloud.status_sync import (
    StatusSyncError,
    StatusSyncJournal,
    StatusSyncManager,
    bind_status_sync_to_dispatcher,
)
from caps_agent.jobs.dispatcher import JobDispatcher, JobItem
from caps_agent.printing.engine import PrintSettings
from caps_agent.printing.fake_engine import FakePrintEngine


class TestStatusSyncJournal(unittest.TestCase):
    """Test SQLite durable retry journal for status updates."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "status_sync.db"
        self.journal = StatusSyncJournal(self.db_path)

    def tearDown(self) -> None:
        self.journal.close()
        self.temp_dir.cleanup()

    def test_enqueue_and_retrieve_pending(self) -> None:
        self.journal.enqueue_sync(
            job_id="job-1",
            attempt_id="att-1",
            status="downloading",
        )
        self.journal.enqueue_sync(
            job_id="job-1",
            attempt_id="att-1",
            status="printing",
            spooler_job_id=42,
        )

        self.assertEqual(self.journal.get_pending_count(), 2)
        pending = self.journal.get_pending_syncs()
        self.assertEqual(len(pending), 2)

        self.assertEqual(pending[0].attempt_id, "att-1")
        self.assertEqual(pending[0].status, "downloading")
        self.assertIsNone(pending[0].spooler_job_id)

        self.assertEqual(pending[1].attempt_id, "att-1")
        self.assertEqual(pending[1].status, "printing")
        self.assertEqual(pending[1].spooler_job_id, 42)

    def test_mark_acknowledged_removes_from_pending(self) -> None:
        item = self.journal.enqueue_sync("job-1", "att-1", "completed")
        self.assertEqual(self.journal.get_pending_count(), 1)

        self.assertIsNotNone(item.id)
        self.journal.mark_acknowledged(item.id, "att-1", "completed")
        self.assertEqual(self.journal.get_pending_count(), 0)

        # After acknowledgement, deduplication check returns True
        self.assertTrue(self.journal.is_acknowledged_or_queued("att-1", "completed"))

    def test_increment_retry_updates_count_and_timestamp(self) -> None:
        item = self.journal.enqueue_sync("job-2", "att-2", "failed", error_message="Paper jam")
        self.assertIsNotNone(item.id)

        self.journal.increment_retry(item.id)
        pending = self.journal.get_pending_syncs()
        self.assertEqual(pending[0].retry_count, 1)
        self.assertIsNotNone(pending[0].last_attempt_at)

    def test_deduplication_detection(self) -> None:
        self.assertFalse(self.journal.is_acknowledged_or_queued("att-99", "printing"))

        self.journal.enqueue_sync("job-99", "att-99", "printing")
        self.assertTrue(self.journal.is_acknowledged_or_queued("att-99", "printing"))
        self.assertFalse(self.journal.is_acknowledged_or_queued("att-99", "completed"))


class TestStatusSyncManager(unittest.TestCase):
    """Test StatusSyncManager delivery, offline retries, and deduplication."""

    def setUp(self) -> None:
        self.mock_api = MagicMock()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "sync_manager.db"
        self.journal = StatusSyncJournal(self.db_path)
        self.manager = StatusSyncManager(
            api_client=self.mock_api,
            journal=self.journal,
            retry_interval=0.05,
        )

    def tearDown(self) -> None:
        self.manager.stop(wait=True)
        self.temp_dir.cleanup()

    def test_status_validation_rejects_invalid_status(self) -> None:
        with self.assertRaises(StatusSyncError) as ctx:
            self.manager.record_status("job-1", "att-1", "invalid_random_status")
        self.assertIn("Status 'invalid_random_status' invalid", str(ctx.exception))

    def test_happy_path_direct_delivery(self) -> None:
        self.mock_api.update_job_status.return_value = {"status": "ok"}

        delivered = self.manager.record_status(
            job_id="job-100",
            attempt_id="att-100",
            status="printing",
            spooler_job_id=12,
        )
        self.assertTrue(delivered)
        self.mock_api.update_job_status.assert_called_once_with(
            job_id="job-100",
            attempt_id="att-100",
            status="printing",
            spooler_job_id=12,
            error_message=None,
        )
        # Pending queue should remain empty
        self.assertEqual(self.journal.get_pending_count(), 0)

    def test_status_duplicate_suppressed_idempotently(self) -> None:
        """Verify: Identical status submissions for the same attempt are de-duplicated."""
        self.mock_api.update_job_status.return_value = {"status": "ok"}

        # First call delivers
        first_call = self.manager.record_status("job-1", "att-1", "completed")
        self.assertTrue(first_call)
        self.assertEqual(self.mock_api.update_job_status.call_count, 1)

        # Duplicate call suppressed without second API invocation
        second_call = self.manager.record_status("job-1", "att-1", "completed")
        self.assertTrue(second_call)
        self.assertEqual(self.mock_api.update_job_status.call_count, 1)

    def test_offline_retry_enqueues_and_flushes_chronologically(self) -> None:
        """Verify: Offline failure queues in SQLite; subsequent flush delivers updates in order."""
        # 1. Simulate Cloud API failure (network down / 503)
        self.mock_api.update_job_status.side_effect = CloudApiError("Network unreachable")

        delivered1 = self.manager.record_status("job-1", "att-1", "downloading")
        delivered2 = self.manager.record_status("job-1", "att-1", "printing", spooler_job_id=5)
        delivered3 = self.manager.record_status("job-1", "att-1", "completed")

        self.assertFalse(delivered1)
        self.assertFalse(delivered2)
        self.assertFalse(delivered3)
        self.assertEqual(self.journal.get_pending_count(), 3)

        # 2. Network restored: reset side_effect to succeed
        self.mock_api.update_job_status.side_effect = None
        self.mock_api.update_job_status.return_value = {"status": "ok"}

        # Flush pending
        flushed = self.manager.flush_pending()
        self.assertEqual(flushed, 3)
        self.assertEqual(self.journal.get_pending_count(), 0)

        # Verify calls were delivered in strict chronological sequence
        calls = self.mock_api.update_job_status.call_args_list
        # First 3 were failed attempts during record_status, next 3 were from flush_pending
        successful_calls = calls[-3:]
        self.assertEqual(successful_calls[0].kwargs["status"], "downloading")
        self.assertEqual(successful_calls[1].kwargs["status"], "printing")
        self.assertEqual(successful_calls[1].kwargs["spooler_job_id"], 5)
        self.assertEqual(successful_calls[2].kwargs["status"], "completed")

    def test_flush_pending_halts_on_failure_to_preserve_order(self) -> None:
        # Pre-enqueue 2 items
        self.journal.enqueue_sync("j1", "a1", "printing")
        self.journal.enqueue_sync("j1", "a1", "completed")

        # Mock API fails on first attempt
        self.mock_api.update_job_status.side_effect = CloudApiError("Server 500")

        flushed = self.manager.flush_pending()
        self.assertEqual(flushed, 0)
        # Both items must remain pending so order is preserved
        self.assertEqual(self.journal.get_pending_count(), 2)

    def test_background_worker_auto_flushes(self) -> None:
        # Queue item directly in journal
        self.journal.enqueue_sync("job-bg", "att-bg", "completed")
        self.mock_api.update_job_status.return_value = {"status": "ok"}

        self.manager.start()
        self.assertTrue(self.manager.is_running)

        # Wait for worker flush
        threading.Event().wait(0.2)
        self.assertEqual(self.journal.get_pending_count(), 0)
        self.mock_api.update_job_status.assert_called_once_with(
            job_id="job-bg",
            attempt_id="att-bg",
            status="completed",
            spooler_job_id=None,
            error_message=None,
        )


class TestDispatcherStatusBinding(unittest.TestCase):
    """Test binding between JobDispatcher state transitions and StatusSyncManager."""

    def setUp(self) -> None:
        self.engine = FakePrintEngine(configured_printers=["TestPrinter"])
        self.dispatcher = JobDispatcher(engine=self.engine)
        self.mock_sync = MagicMock()

    def tearDown(self) -> None:
        self.dispatcher.shutdown(wait=True)

    def test_binding_forwards_printing_and_completed_transitions(self) -> None:
        bind_status_sync_to_dispatcher(self.dispatcher, self.mock_sync)

        job = JobItem(
            job_id="job-bind-1",
            attempt_id="att-bind-1",
            printer_name="TestPrinter",
            pdf_path=Path("dummy.pdf"),
            settings=PrintSettings("a4", "bw", "simplex", 1, "all", "portrait"),
            lease_token="lease-1",
        )

        self.dispatcher.enqueue_job(job)
        self.dispatcher.wait_for_job("job-bind-1", timeout=5.0)

        # Check recorded calls on mock_sync
        calls = self.mock_sync.record_status.call_args_list
        statuses = [c.kwargs["status"] for c in calls]
        self.assertIn("printing", statuses)
        self.assertIn("completed", statuses)


if __name__ == "__main__":
    unittest.main()
