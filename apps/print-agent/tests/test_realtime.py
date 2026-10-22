"""Unit and Integration Tests for Realtime WebSocket & Coordinator (INT-D4-03).

Validates:
1. Authenticated handshake on channel `caps:shop:<shopId>` with device secret.
2. Immediate wake-up wire on `job.approved` and `job.created`.
3. Tenant isolation rejecting foreign shop notifications.
4. Exponential backoff reconnection sequence with jitter (1s, 2s, 4s, ..., max 30s).
5. Disconnect recovery without agent process crash.
6. Full end-to-end coordinator execution from wake-up to COMPLETED status.
7. Graceful failure handling and workspace purging on error.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import time
import unittest
from typing import Any
from unittest.mock import MagicMock

from api_client import JobClaim
from coordinator import Coordinator
from job_download import SecurePdfDownloader
from realtime_client import (
    MockRealtimeTransport,
    RealtimeClient,
    RealtimeConnectionError,
)
from storage import JobStorageManager


class FakeHttpOpener:
    """Mock URL opener simulating HTTPS download from signed URLs."""

    def __init__(self, content: bytes = b"%PDF-1.4\nTest PDF content\n%%EOF") -> None:
        self.content = content
        self.requested_urls: list[str] = []

    def open(self, request: Any, timeout: float = 30.0) -> Any:
        url = request.get_full_url() if hasattr(request, "get_full_url") else str(request)
        self.requested_urls.append(url)

        class MockResponse:
            def __init__(self, data: bytes) -> None:
                self.data = data
                self.offset = 0
                self.headers = {
                    "Content-Type": "application/pdf",
                    "Content-Length": str(len(data)),
                }

            def read(self, size: int = -1) -> bytes:
                if self.offset >= len(self.data):
                    return b""
                if size < 0:
                    chunk = self.data[self.offset :]
                    self.offset = len(self.data)
                    return chunk
                chunk = self.data[self.offset : self.offset + size]
                self.offset += len(chunk)
                return chunk

            def info(self) -> Any:
                return self

            def get(self, key: str, default: Any = None) -> Any:
                return self.headers.get(key, default)

            def __enter__(self) -> MockResponse:
                return self

            def __exit__(self, *args: Any) -> None:
                pass

        return MockResponse(self.content)


class TestRealtimeClient(unittest.TestCase):
    """Test suite for RealtimeClient protocol, backoff, and event dispatching."""

    def setUp(self) -> None:
        self.shop_id = "shop-test-123"
        self.device_token = "caps_agent_sec_testtoken123"
        self.device_id = "device-uuid-999"
        self.ws_url = "wss://supabase.example.com/realtime/v1/websocket"

    def test_handshake_and_headers_construction(self) -> None:
        """Verify headers include auth token, device id, and shop id."""
        transport = MockRealtimeTransport()
        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id=self.shop_id,
            device_token=self.device_token,
            device_id=self.device_id,
            transport=transport,
        )

        headers = client._build_headers()
        self.assertEqual(headers["Authorization"], f"Bearer {self.device_token}")
        self.assertEqual(headers["apikey"], self.device_token)
        self.assertEqual(headers["X-CAPS-Device-Id"], self.device_id)
        self.assertEqual(headers["X-CAPS-Shop-Id"], self.shop_id)

        join_msg = client.build_join_message()
        self.assertEqual(join_msg["topic"], f"realtime:caps:shop:{self.shop_id}")
        self.assertEqual(join_msg["event"], "phx_join")
        self.assertEqual(join_msg["ref"], "1")

    def test_exponential_backoff_sequence(self) -> None:
        """Verify exponential backoff doubles up to max_backoff (1s, 2s, 4s, 8s, 16s, 30s)."""
        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id=self.shop_id,
            base_backoff=1.0,
            max_backoff=30.0,
            jitter=0.0,  # Zero jitter for exact sequence assertion
        )

        expected_sequence = [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0, 30.0]
        for attempt, expected in enumerate(expected_sequence):
            delay = client.get_backoff_delay(attempt)
            self.assertEqual(delay, expected, f"Backoff at attempt {attempt} failed")

    def test_exponential_backoff_jitter_bounds(self) -> None:
        """Verify jitter is added within expected [base, base + jitter] bounds."""
        jitter_val = 0.5
        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id=self.shop_id,
            base_backoff=1.0,
            max_backoff=30.0,
            jitter=jitter_val,
        )

        for attempt in range(5):
            base_val = min(30.0, 1.0 * (2**attempt))
            delay = client.get_backoff_delay(attempt)
            self.assertGreaterEqual(delay, base_val)
            self.assertLessEqual(delay, base_val + jitter_val)

    def test_immediate_wakeup_job_approved(self) -> None:
        """Verify receiving 'job.approved' immediately calls coordinator.poll_and_execute_now()."""
        mock_coordinator = MagicMock()
        wake_calls: list[tuple[str, dict[str, Any]]] = []

        def on_wake(event: str, payload: dict[str, Any]) -> None:
            wake_calls.append((event, payload))

        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id=self.shop_id,
            coordinator=mock_coordinator,
            on_wake=on_wake,
        )

        phoenix_frame = {
            "topic": f"realtime:caps:shop:{self.shop_id}",
            "event": "broadcast",
            "payload": {
                "type": "broadcast",
                "event": "job.approved",
                "payload": {"jobId": "job-101", "shopId": self.shop_id, "status": "QUEUED"},
            },
            "ref": None,
        }

        result = client.handle_message(json.dumps(phoenix_frame))
        self.assertIsNotNone(result)
        self.assertEqual(result["event"], "job.approved")
        mock_coordinator.poll_and_execute_now.assert_called_once()
        self.assertEqual(len(wake_calls), 1)
        self.assertEqual(wake_calls[0][0], "job.approved")
        self.assertEqual(wake_calls[0][1]["jobId"], "job-101")

    def test_immediate_wakeup_job_created(self) -> None:
        """Verify receiving 'job.created' immediately calls coordinator.poll_and_execute_now()."""
        mock_coordinator = MagicMock()
        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id=self.shop_id,
            coordinator=mock_coordinator,
        )

        direct_payload = {
            "type": "broadcast",
            "event": "job.created",
            "payload": {"jobId": "job-202", "shopId": self.shop_id},
            "channel": f"caps:shop:{self.shop_id}",
        }

        result = client.handle_message(direct_payload)
        self.assertIsNotNone(result)
        self.assertEqual(result["event"], "job.created")
        mock_coordinator.poll_and_execute_now.assert_called_once()

    def test_tenant_isolation_rejects_foreign_shop_events(self) -> None:
        """Verify events addressed to foreign shops are discarded without triggering wake-up."""
        mock_coordinator = MagicMock()
        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id="shop-alpha",
            coordinator=mock_coordinator,
        )

        # Message targeting shop-beta via payload
        foreign_payload = {
            "type": "broadcast",
            "event": "job.approved",
            "payload": {"jobId": "job-303", "shopId": "shop-beta"},
        }
        res1 = client.handle_message(foreign_payload)
        self.assertIsNone(res1)
        mock_coordinator.poll_and_execute_now.assert_not_called()

        # Message targeting shop-beta via topic
        foreign_topic = {
            "topic": "realtime:caps:shop:shop-beta",
            "event": "broadcast",
            "payload": {
                "event": "job.created",
                "payload": {"jobId": "job-304"},
            },
        }
        res2 = client.handle_message(foreign_topic)
        self.assertIsNone(res2)
        mock_coordinator.poll_and_execute_now.assert_not_called()

    def test_disconnect_triggers_backoff_without_process_crash(self) -> None:
        """Simulate transport disconnect and verify backoff loop handles it cleanly."""
        transport = MockRealtimeTransport()
        client = RealtimeClient(
            ws_url=self.ws_url,
            shop_id=self.shop_id,
            transport=transport,
            base_backoff=0.01,
            max_backoff=0.05,
            jitter=0.0,
        )

        client.start()
        # Wait for initial connection
        time.sleep(0.05)
        self.assertTrue(client.is_connected)

        # Inject transport disconnect error
        transport.push_error(RealtimeConnectionError("Simulated socket drop"))

        # Wait for reconnection loop to execute backoff and reconnect
        time.sleep(0.1)
        self.assertGreaterEqual(client.reconnect_count, 1)

        client.stop()
        self.assertFalse(client.is_connected)


class TestCoordinatorLifecycle(unittest.TestCase):
    """Test suite for Coordinator execution and status progression."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage_manager = JobStorageManager(base_dir=self.temp_dir.name)
        self.shop_id = "shop-coord-1"
        self.pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Title (Coordinator Test PDF) >>\nendobj\n%%EOF"
        self.valid_sha256 = hashlib.sha256(self.pdf_bytes).hexdigest()

        self.custom_opener = FakeHttpOpener(self.pdf_bytes)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_coordinator_full_execution_flow(self) -> None:
        """Test full claim -> download -> printing -> completed lifecycle."""
        # Setup mock API client
        recorded_updates: list[dict[str, Any]] = []

        class MockApi:
            def __init__(self, claim_obj: JobClaim) -> None:
                self.claim_obj: JobClaim | None = claim_obj

            def claim_jobs(self) -> JobClaim | None:
                item = self.claim_obj
                self.claim_obj = None
                return item

            def update_job_status(self, **kwargs: Any) -> dict[str, Any]:
                recorded_updates.append(kwargs)
                return {"status": "ok"}

        claim = JobClaim(
            job_id="job-coord-001",
            attempt_id="att-coord-001",
            lease_token="lease-token-12345678",
            lease_expires_at="2026-10-22T08:00:00Z",
            shop_id=self.shop_id,
            printer_id="printer-1",
            download_url="https://supabase.example.com/storage/v1/customer-documents/job-coord-001.pdf",
            checksum_sha256=self.valid_sha256,
            content_type="application/pdf",
            file_size_bytes=len(self.pdf_bytes),
            settings={"copies": 2, "duplex": "duplex_long"},
            created_at="2026-10-22T07:00:00Z",
        )

        mock_api = MockApi(claim)
        downloader = SecurePdfDownloader(
            api_client=mock_api,  # type: ignore
            storage_manager=self.storage_manager,
            custom_opener=self.custom_opener,
        )

        coordinator = Coordinator(
            api_client=mock_api,  # type: ignore
            downloader=downloader,
            storage_manager=self.storage_manager,
            poll_interval=0,  # disable background thread for deterministic test
        )

        res = coordinator.poll_and_execute_now()
        self.assertIsNotNone(res)
        self.assertEqual(res["status"], "COMPLETED")
        self.assertEqual(res["job_id"], "job-coord-001")
        self.assertEqual(res["pages_printed"], 2)

        # Verify status transitions: DOWNLOADING -> PRINTING -> COMPLETED
        statuses = [u["status"] for u in recorded_updates]
        self.assertEqual(statuses, ["DOWNLOADING", "PRINTING", "COMPLETED"])

        # Check all statuses are uppercase
        for s in statuses:
            self.assertEqual(s, s.upper())

    def test_coordinator_handles_checksum_mismatch_and_purges(self) -> None:
        """Test that checksum mismatch reports FAILED and purges local files."""
        recorded_updates: list[dict[str, Any]] = []

        class MockApi:
            def __init__(self, claim_obj: JobClaim) -> None:
                self.claim_obj: JobClaim | None = claim_obj

            def claim_jobs(self) -> JobClaim | None:
                item = self.claim_obj
                self.claim_obj = None
                return item

            def update_job_status(self, **kwargs: Any) -> dict[str, Any]:
                recorded_updates.append(kwargs)
                return {"status": "ok"}

        # Claim with mismatched hash
        claim = JobClaim(
            job_id="job-bad-hash",
            attempt_id="att-bad-001",
            lease_token="lease-token-12345678",
            lease_expires_at="2026-10-22T08:00:00Z",
            shop_id=self.shop_id,
            printer_id="printer-1",
            download_url="https://supabase.example.com/storage/v1/customer-documents/job-bad-hash.pdf",
            checksum_sha256="ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            content_type="application/pdf",
            file_size_bytes=len(self.pdf_bytes),
            settings={"copies": 1},
            created_at="2026-10-22T07:00:00Z",
        )

        mock_api = MockApi(claim)
        downloader = SecurePdfDownloader(
            api_client=mock_api,  # type: ignore
            storage_manager=self.storage_manager,
            custom_opener=self.custom_opener,
        )

        coordinator = Coordinator(
            api_client=mock_api,  # type: ignore
            downloader=downloader,
            storage_manager=self.storage_manager,
            poll_interval=0,
        )

        res = coordinator.poll_and_execute_now()
        self.assertIsNotNone(res)
        self.assertEqual(res["status"], "FAILED")
        self.assertEqual(res["error_code"], "CHECKSUM_MISMATCH")

        # Verify FAILED status was reported to cloud
        failed_update = [u for u in recorded_updates if u.get("status") == "FAILED"]
        self.assertEqual(len(failed_update), 1)
        self.assertEqual(failed_update[0]["error_code"], "CHECKSUM_MISMATCH")

        # Verify job workspace was purged
        job_dir = self.storage_manager.base_dir / "job-bad-hash"
        self.assertFalse(job_dir.exists())

    def test_realtime_to_coordinator_integration(self) -> None:
        """Verify RealtimeClient wake-up event triggers full Coordinator execution."""
        recorded_updates: list[dict[str, Any]] = []

        class MockApi:
            def __init__(self, claim_obj: JobClaim) -> None:
                self.claim_obj: JobClaim | None = claim_obj

            def claim_jobs(self) -> JobClaim | None:
                item = self.claim_obj
                self.claim_obj = None
                return item

            def update_job_status(self, **kwargs: Any) -> dict[str, Any]:
                recorded_updates.append(kwargs)
                return {"status": "ok"}

        claim = JobClaim(
            job_id="job-rt-integrated",
            attempt_id="att-rt-001",
            lease_token="lease-token-12345678",
            lease_expires_at="2026-10-22T08:00:00Z",
            shop_id=self.shop_id,
            printer_id="printer-1",
            download_url="https://supabase.example.com/storage/v1/customer-documents/job-rt-integrated.pdf",
            checksum_sha256=self.valid_sha256,
            content_type="application/pdf",
            file_size_bytes=len(self.pdf_bytes),
            settings={"copies": 1},
            created_at="2026-10-22T07:00:00Z",
        )

        mock_api = MockApi(claim)
        downloader = SecurePdfDownloader(
            api_client=mock_api,  # type: ignore
            storage_manager=self.storage_manager,
            custom_opener=self.custom_opener,
        )

        transport = MockRealtimeTransport()
        client = RealtimeClient(
            ws_url="wss://supabase.example.com/realtime/v1/websocket",
            shop_id=self.shop_id,
            device_token="test_token",
            transport=transport,
            base_backoff=0.01,
            max_backoff=0.05,
        )

        coordinator = Coordinator(
            api_client=mock_api,  # type: ignore
            downloader=downloader,
            storage_manager=self.storage_manager,
            realtime_client=client,
            poll_interval=0,
        )

        coordinator.start()
        time.sleep(0.05)

        # Inject wake-up message
        wake_message = {
            "topic": f"realtime:caps:shop:{self.shop_id}",
            "event": "broadcast",
            "payload": {
                "type": "broadcast",
                "event": "job.approved",
                "payload": {"jobId": "job-rt-integrated", "shopId": self.shop_id},
            },
        }
        transport.push_message(json.dumps(wake_message))

        # Give small window for thread to process
        time.sleep(0.1)

        coordinator.stop()

        # Check job was processed to COMPLETED
        self.assertEqual(len(coordinator.processed_jobs), 1)
        self.assertEqual(coordinator.processed_jobs[0]["job_id"], "job-rt-integrated")
        self.assertEqual(coordinator.processed_jobs[0]["status"], "COMPLETED")


if __name__ == "__main__":
    unittest.main()
