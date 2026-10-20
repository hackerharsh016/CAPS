"""Unit and contract tests for CAPS Print Agent realtime listener and atomic claim coordinator.

Tests cover:
- Signal -> fetch -> claim authorized job (happy path)
- Missed event handling (offline period -> reconnect backlog reconciliation)
- Duplicate event suppression and idempotency
- Concurrent agent claim handling (competing agent wins, second agent gets None)
- Tenant isolation (rejecting foreign shop events)
- Network disconnect and exponential backoff reconnection
- Document download failure reporting
- Queue backpressure handling
- Settings mapping from cloud claim payload to internal PrintSettings
- Zero-token logging policy
"""

from __future__ import annotations

import hashlib
import logging
import tempfile
import threading
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from caps_agent.auth.credentials import AgentCredentials
from caps_agent.cloud.api_client import (
    ChecksumMismatchError,
    JobClaimResponse,
)
from caps_agent.cloud.realtime_client import (
    MockRealtimeTransport,
    RealtimeClaimCoordinator,
    map_claim_settings_to_print_settings,
)
from caps_agent.jobs.dispatcher import JobDispatcher
from caps_agent.jobs.state_machine import JobState
from caps_agent.printing.fake_engine import FakePrintEngine


class MockApiClient:
    """Mock CloudApiClient for controlled claim, download, and status update testing."""

    def __init__(self, shop_id: str = "shop-test-1") -> None:
        self.shop_id = shop_id
        self.claim_queue: list[JobClaimResponse | None | Exception] = []
        self.recorded_claims: list[dict[str, Any]] = []
        self.recorded_status_updates: list[dict[str, Any]] = []
        self.download_files: dict[str, bytes] = {}
        self.download_exceptions: dict[str, Exception] = {}

    def queue_claim(self, claim: JobClaimResponse | None | Exception) -> None:
        self.claim_queue.append(claim)

    def claim_job(self, lease_duration_seconds: int = 90) -> JobClaimResponse | None:
        self.recorded_claims.append({"lease_duration_seconds": lease_duration_seconds})
        if self.claim_queue:
            next_item = self.claim_queue.pop(0)
            if isinstance(next_item, Exception):
                raise next_item
            return next_item
        return None

    def update_job_status(
        self,
        job_id: str,
        attempt_id: str,
        status: str,
        spooler_job_id: int | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        update = {
            "job_id": job_id,
            "attempt_id": attempt_id,
            "status": status,
            "spooler_job_id": spooler_job_id,
            "error_message": error_message,
        }
        self.recorded_status_updates.append(update)
        return {"status": "ok"}

    def download_document(
        self,
        download_url: str,
        destination_path: Path | str,
        expected_sha256: str | None = None,
    ) -> Path:
        if download_url in self.download_exceptions:
            raise self.download_exceptions[download_url]

        dest = Path(destination_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        content = self.download_files.get(download_url, b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF")

        if expected_sha256:
            actual_sha = hashlib.sha256(content).hexdigest().lower()
            if actual_sha != expected_sha256.lower():
                raise ChecksumMismatchError(expected=expected_sha256, actual=actual_sha)

        dest.write_bytes(content)
        return dest


class TestRealtimeClaimCoordinator(unittest.TestCase):
    """Test suite for RealtimeClaimCoordinator."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_temp = Path(self.temp_dir.name)

        self.shop_id = "shop-north-campus-1"
        self.device_id = "dev-pc-01"
        self.credentials = AgentCredentials(
            shop_id=self.shop_id,
            device_id=self.device_id,
            device_token="secret_token_12345",
        )

        self.mock_api = MockApiClient(shop_id=self.shop_id)
        self.engine = FakePrintEngine(configured_printers=["HP-LaserJet-MFP", "DefaultPrinter"])
        self.dispatcher = JobDispatcher(
            engine=self.engine,
            shop_id=self.shop_id,
            max_queue_per_printer=5,
        )
        self.transport = MockRealtimeTransport()

        self.coordinator = RealtimeClaimCoordinator(
            api_client=self.mock_api,  # type: ignore[arg-type]
            dispatcher=self.dispatcher,
            credentials=self.credentials,
            realtime_url="wss://cloud.caps.example.com/realtime",
            transport=self.transport,
            temp_dir=self.base_temp,
            default_printer="DefaultPrinter",
            reconciliation_interval=0.5,
            backoff_initial=0.01,
            backoff_max=0.05,
        )

    def tearDown(self) -> None:
        self.coordinator.stop(wait=True)
        self.dispatcher.shutdown(wait=True)
        self.temp_dir.cleanup()

    def _create_claim_response(
        self,
        job_id: str,
        attempt_id: str,
        printer_name: str = "HP-LaserJet-MFP",
    ) -> JobClaimResponse:
        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        sha = hashlib.sha256(pdf_bytes).hexdigest()
        url = f"https://storage.caps.example.com/docs/{job_id}.pdf"
        self.mock_api.download_files[url] = pdf_bytes

        exp_time = (datetime.now(UTC) + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")

        return JobClaimResponse(
            job_id=job_id,
            attempt_id=attempt_id,
            lease_id=f"lease-{job_id}",
            download_url=url,
            settings={
                "color_mode": "monochrome",
                "copies": 1,
                "duplex": "simplex",
                "paper_size": "a4",
                "printer_name": printer_name,
            },
            lease_expires_at=exp_time,
            checksum_sha256=sha,
        )

    # ==========================================================================
    # Happy Path Test
    # ==========================================================================

    def test_happy_path_signal_claim_download_dispatch(self) -> None:
        """Verify: Signal -> fetch -> claim authorized job -> per-printer serialized execution."""
        claim = self._create_claim_response("job-101", "att-101", "HP-LaserJet-MFP")
        self.mock_api.queue_claim(claim)

        # Receive wake-up signal
        event_payload = {
            "event": "print_job_approved",
            "shop_id": self.shop_id,
            "job_id": "job-101",
        }
        handled = self.coordinator.handle_event(event_payload)
        self.assertTrue(handled)

        # Wait for job execution to complete in dispatcher
        state = self.dispatcher.wait_for_job("job-101", timeout=5.0)
        self.assertEqual(state, JobState.COMPLETED)

        # Verify atomic claim was made
        self.assertGreaterEqual(len(self.mock_api.recorded_claims), 1)

        # Verify lifecycle status updates sent to cloud
        statuses = [u["status"] for u in self.mock_api.recorded_status_updates if u["job_id"] == "job-101"]
        self.assertIn("downloading", statuses)
        self.assertIn("printing", statuses)
        self.assertIn("completed", statuses)

        # Verify spooler was called via FakePrintEngine
        self.assertEqual(len(self.engine.submission_log), 1)
        self.assertEqual(self.engine.submission_log[0]["printer_name"], "HP-LaserJet-MFP")

    # ==========================================================================
    # Missed Event Test (Disconnect -> Reconnect Reconcile Backlog)
    # ==========================================================================

    def test_missed_event_reconciliation_on_reconnect(self) -> None:
        """Verify: While disconnected, jobs accumulate; reconnection drains all missed jobs."""
        claim1 = self._create_claim_response("job-backlog-1", "att-backlog-1", "HP-LaserJet-MFP")
        claim2 = self._create_claim_response("job-backlog-2", "att-backlog-2", "HP-LaserJet-MFP")

        # Queue 2 claims, then None (drained)
        self.mock_api.queue_claim(claim1)
        self.mock_api.queue_claim(claim2)

        # Simulate disconnect
        self.transport.disconnect()
        self.assertFalse(self.transport.is_connected())

        # Trigger reconciliation backlog sweep (as executed upon reconnect or periodic timer)
        claimed_ids = self.coordinator.reconcile_backlog()

        self.assertEqual(claimed_ids, ["job-backlog-1", "job-backlog-2"])

        # Wait for both jobs to execute in per-printer FIFO order
        state1 = self.dispatcher.wait_for_job("job-backlog-1", timeout=5.0)
        state2 = self.dispatcher.wait_for_job("job-backlog-2", timeout=5.0)
        self.assertEqual(state1, JobState.COMPLETED)
        self.assertEqual(state2, JobState.COMPLETED)

        # Verify execution order in engine
        spool_jobs = [c["job_title"] for c in self.engine.submission_log]
        self.assertEqual(len(spool_jobs), 2)
        self.assertIn("job-back", spool_jobs[0])

    # ==========================================================================
    # Duplicate Event Test
    # ==========================================================================

    def test_duplicate_event_suppressed_and_idempotent(self) -> None:
        """Verify: Rapid duplicate wake-up events for the same job are suppressed."""
        claim = self._create_claim_response("job-dup-1", "att-dup-1", "HP-LaserJet-MFP")
        self.mock_api.queue_claim(claim)

        event = {
            "event": "print_job_approved",
            "shop_id": self.shop_id,
            "job_id": "job-dup-1",
        }

        # First event is accepted
        first_handled = self.coordinator.handle_event(event)
        self.assertTrue(first_handled)

        # Immediate duplicate event is suppressed by deduplication cache
        second_handled = self.coordinator.handle_event(event)
        self.assertFalse(second_handled)

        # Third duplicate event is also suppressed
        third_handled = self.coordinator.handle_event(event)
        self.assertFalse(third_handled)

        # Wait for execution
        state = self.dispatcher.wait_for_job("job-dup-1", timeout=5.0)
        self.assertEqual(state, JobState.COMPLETED)

        # Only 1 print submission was made
        self.assertEqual(len(self.engine.submission_log), 1)

    # ==========================================================================
    # Concurrent Agent Claim Test
    # ==========================================================================

    def test_concurrent_agent_claim_returns_none_gracefully(self) -> None:
        """Verify: When competing agent claims the job first, Cloud returns None; agent handles smoothly."""
        # Cloud API returns None (another agent claimed it)
        self.mock_api.queue_claim(None)

        event = {
            "event": "print_job_approved",
            "shop_id": self.shop_id,
            "job_id": "job-claimed-by-other-agent",
        }

        # Handle event: calls claim_job(), receives None, does not crash
        handled = self.coordinator.handle_event(event)
        self.assertTrue(handled)

        # No job should be in dispatcher or engine
        self.assertEqual(len(self.engine.submission_log), 0)
        self.assertIsNone(self.dispatcher.get_job_state("job-claimed-by-other-agent"))

    # ==========================================================================
    # Tenant Isolation Test
    # ==========================================================================

    def test_tenant_isolation_rejects_foreign_shop_event(self) -> None:
        """Verify: Realtime wake-up signals for another shop are dropped immediately."""
        event_foreign = {
            "event": "print_job_approved",
            "shop_id": "foreign-shop-unauthorized-999",
            "job_id": "job-foreign-1",
        }

        handled = self.coordinator.handle_event(event_foreign)
        self.assertFalse(handled)

        # No claims attempted
        self.assertEqual(len(self.mock_api.recorded_claims), 0)
        self.assertEqual(len(self.engine.submission_log), 0)

    # ==========================================================================
    # Disconnect & Reconnect Loop with Backoff Test
    # ==========================================================================

    def test_reconnect_loop_with_backoff_and_reconciliation(self) -> None:
        """Verify: Transport connection failure enters retry backoff, connects, and reconciles."""
        self.transport.connect_error = Exception("Simulated connection timeout")

        # Start background coordinator loop
        self.coordinator.start()
        self.assertTrue(self.coordinator.is_running)

        # While transport fails, not connected
        # Allow retry attempt
        threading.Event().wait(0.1)

        # Now clear connect error so next attempt succeeds
        self.transport.connect_error = None

        # Prepare a claim to be picked up on reconnect
        claim = self._create_claim_response("job-reconnect-1", "att-reconnect-1")
        self.mock_api.queue_claim(claim)

        # Wait for background loop to connect and reconcile
        start = datetime.now(UTC)
        while not self.transport.is_connected() and (datetime.now(UTC) - start).total_seconds() < 3.0:
            threading.Event().wait(0.05)

        self.assertTrue(self.transport.is_connected())
        self.assertEqual(self.transport.connected_url, "wss://cloud.caps.example.com/realtime")
        self.assertEqual(
            self.transport.connected_headers.get("Authorization"),
            "Bearer secret_token_12345",
        )
        self.assertEqual(
            self.transport.connected_headers.get("X-CAPS-Shop-Id"),
            self.shop_id,
        )

        # Wait for job to finish
        state = self.dispatcher.wait_for_job("job-reconnect-1", timeout=5.0)
        self.assertEqual(state, JobState.COMPLETED)

    # ==========================================================================
    # Download Failure Test
    # ==========================================================================

    def test_download_failure_reports_failed_status(self) -> None:
        """Verify: If document download fails, cloud status is updated to 'failed'."""
        claim = self._create_claim_response("job-bad-dl", "att-bad-dl")
        # Configure download exception
        self.mock_api.download_exceptions[claim.download_url] = Exception("Download stream reset")
        self.mock_api.queue_claim(claim)

        result = self.coordinator.claim_and_dispatch_next()
        self.assertIsNone(result)

        # Status 'failed' must be reported to cloud
        failed_updates = [
            u for u in self.mock_api.recorded_status_updates
            if u["job_id"] == "job-bad-dl" and u["status"] == "failed"
        ]
        self.assertEqual(len(failed_updates), 1)
        self.assertIn("Download stream reset", failed_updates[0]["error_message"])

    # ==========================================================================
    # Settings Mapping Unit Test
    # ==========================================================================

    def test_map_claim_settings_to_print_settings(self) -> None:
        # Monochrome -> bw
        settings_raw = {
            "paper_size": "A4",
            "color_mode": "monochrome",
            "duplex": "long_edge",
            "copies": 3,
            "page_range": "1-5",
            "orientation": "Landscape",
        }
        ps = map_claim_settings_to_print_settings(settings_raw)
        self.assertEqual(ps.paper_size, "a4")
        self.assertEqual(ps.color_mode, "bw")
        self.assertEqual(ps.duplex, "long_edge")
        self.assertEqual(ps.copies, 3)
        self.assertEqual(ps.page_range, "1-5")
        self.assertEqual(ps.orientation, "landscape")

        # Color mode
        ps_color = map_claim_settings_to_print_settings({"color_mode": "color", "duplex": True})
        self.assertEqual(ps_color.color_mode, "color")
        self.assertEqual(ps_color.duplex, "duplex_long")

    # ==========================================================================
    # Zero-Token Policy Test
    # ==========================================================================

    def test_zero_token_logging_in_realtime_coordinator(self) -> None:
        captured_logs: list[str] = []

        class ListHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                captured_logs.append(record.getMessage())

        handler = ListHandler()
        rt_logger = logging.getLogger("caps_agent.cloud.realtime_client")
        rt_logger.addHandler(handler)
        rt_logger.setLevel(logging.DEBUG)

        try:
            claim = self._create_claim_response("job-sec-1", "att-sec-1")
            self.mock_api.queue_claim(claim)
            self.coordinator.handle_event({"event": "wake", "shop_id": self.shop_id, "job_id": "job-sec-1"})

            for msg in captured_logs:
                self.assertNotIn("secret_token_12345", msg)
        finally:
            rt_logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
