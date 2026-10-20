"""Unit tests for CAPS Print Agent authenticated Cloud API client.

Tests cover:
- HttpTransport mocking and request verification
- Bearer auth and custom tenant headers (X-CAPS-Device-Id, X-CAPS-Shop-Id)
- Job claim conforming to JobClaimRequestSchema and JobClaimResponseSchema
- Job status update conforming to JobStatusUpdateRequestSchema
- Tenant isolation enforcement (rejecting mismatched shop_id or HTTP 403)
- Document download with streaming SHA-256 integrity verification and cleanup on mismatch
- Automatic 401 token refresh and single retry loop protection
- Transient 5xx and timeout exponential backoff retry behavior
- Secret redaction and zero-token logging policy
"""

from __future__ import annotations

import hashlib
import json
import logging
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from caps_agent.auth.credentials import AgentCredentials
from caps_agent.cloud.api_client import (
    AuthenticationError,
    ChecksumMismatchError,
    CloudApiClient,
    CloudApiError,
    ContractValidationError,
    HttpResponse,
    JobClaimResponse,
    NetworkTimeoutError,
    TenantMismatchError,
)


class MockHttpTransport:
    """Deterministic in-memory HTTP transport for testing CloudApiClient."""

    def __init__(self) -> None:
        self.recorded_requests: list[dict[str, Any]] = []
        self._responses: list[HttpResponse | Exception] = []
        self._default_response = HttpResponse(200, {"content-type": "application/json"}, b"{}")

    def queue_response(
        self,
        status_code: int = 200,
        body: dict[str, Any] | bytes | str = b"{}",
        headers: dict[str, str] | None = None,
    ) -> None:
        """Queue a specific HttpResponse to be returned on next request."""
        hdrs = headers or {"content-type": "application/json"}
        if isinstance(body, dict):
            body_bytes = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body_bytes = body.encode("utf-8")
        else:
            body_bytes = body
        self._responses.append(HttpResponse(status_code=status_code, headers=hdrs, body=body_bytes))

    def queue_exception(self, exc: Exception) -> None:
        """Queue an exception (e.g. NetworkTimeoutError) to be raised on next request."""
        self._responses.append(exc)

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None = None,
        timeout: float = 10.0,
    ) -> HttpResponse:
        parsed_body = None
        if body:
            try:
                parsed_body = json.loads(body.decode("utf-8"))
            except Exception:
                parsed_body = body

        self.recorded_requests.append({
            "method": method,
            "url": url,
            "headers": headers,
            "body": parsed_body,
            "raw_body": body,
            "timeout": timeout,
        })

        if self._responses:
            next_item = self._responses.pop(0)
            if isinstance(next_item, Exception):
                raise next_item
            return next_item

        return self._default_response


class TestCloudApiClient(unittest.TestCase):
    """Test suite for CloudApiClient operations and error taxonomy."""

    def setUp(self) -> None:
        self.transport = MockHttpTransport()
        self.credentials = AgentCredentials(
            shop_id="shop-test-111",
            device_id="dev-test-222",
            device_token="secret-tok-333",
            refresh_token="secret-ref-444",
        )
        self.client = CloudApiClient(
            base_url="https://cloud.caps.example.com",
            credentials=self.credentials,
            transport=self.transport,
            backoff_factor=0.01,  # Fast backoff for unit tests
        )

    def test_headers_contain_auth_and_tenant_metadata(self) -> None:
        self.transport.queue_response(200, {"status": "ok"})
        self.client.get("/api/v1/test")

        self.assertEqual(len(self.transport.recorded_requests), 1)
        req = self.transport.recorded_requests[0]
        self.assertEqual(req["headers"]["Authorization"], "Bearer secret-tok-333")
        self.assertEqual(req["headers"]["X-CAPS-Device-Id"], "dev-test-222")
        self.assertEqual(req["headers"]["X-CAPS-Shop-Id"], "shop-test-111")
        self.assertEqual(req["url"], "https://cloud.caps.example.com/api/v1/test")

    def test_claim_job_happy_path(self) -> None:
        lease_exp = (datetime.now(UTC) + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        response_payload = {
            "job_id": "job-abc-1",
            "attempt_id": "att-xyz-2",
            "lease_id": "lease-3",
            "download_url": "https://storage.caps.example.com/docs/test.pdf",
            "settings": {
                "color_mode": "monochrome",
                "copies": 2,
                "duplex": "long_edge",
                "paper_size": "a4",
            },
            "lease_expires_at": lease_exp,
            "checksum_sha256": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            "shop_id": "shop-test-111",
        }
        self.transport.queue_response(200, response_payload)

        claim = self.client.claim_job(lease_duration_seconds=90)

        self.assertIsNotNone(claim)
        self.assertIsInstance(claim, JobClaimResponse)
        self.assertEqual(claim.job_id, "job-abc-1")
        self.assertEqual(claim.attempt_id, "att-xyz-2")
        self.assertEqual(claim.lease_id, "lease-3")
        self.assertEqual(claim.download_url, "https://storage.caps.example.com/docs/test.pdf")
        self.assertEqual(claim.settings["copies"], 2)
        self.assertEqual(claim.checksum_sha256, response_payload["checksum_sha256"])

        # Verify request body matched JobClaimRequestSchema
        req = self.transport.recorded_requests[0]
        self.assertEqual(req["method"], "POST")
        self.assertEqual(req["url"], "https://cloud.caps.example.com/api/v1/agent/jobs/claim")
        self.assertEqual(req["body"]["agent_device_id"], "dev-test-222")
        self.assertEqual(req["body"]["shop_id"], "shop-test-111")
        self.assertEqual(req["body"]["lease_duration_seconds"], 90)

    def test_claim_job_empty_when_no_jobs(self) -> None:
        self.transport.queue_response(200, {})
        claim = self.client.claim_job()
        self.assertIsNone(claim)

    def test_claim_job_rejects_missing_contract_fields(self) -> None:
        # Missing lease_id and settings
        self.transport.queue_response(200, {
            "job_id": "job-1",
            "attempt_id": "att-1",
            "download_url": "https://example.com/doc.pdf",
        })
        with self.assertRaises(ContractValidationError) as ctx:
            self.client.claim_job()
        self.assertIn("missing fields", str(ctx.exception))

    def test_claim_job_tenant_isolation_mismatch_raises(self) -> None:
        lease_exp = (datetime.now(UTC) + timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        response_payload = {
            "job_id": "job-wrong-shop",
            "attempt_id": "att-1",
            "lease_id": "lease-1",
            "download_url": "https://storage.example.com/doc.pdf",
            "settings": {"copies": 1},
            "lease_expires_at": lease_exp,
            "shop_id": "different-shop-unauthorized-999",  # Conflicts with shop-test-111
        }
        self.transport.queue_response(200, response_payload)

        with self.assertRaises(TenantMismatchError) as ctx:
            self.client.claim_job()
        self.assertIn("belonging to shop 'different-shop-unauthorized-999'", str(ctx.exception))

    def test_claim_job_already_expired_lease_raises_contract_error(self) -> None:
        past_exp = (datetime.now(UTC) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        response_payload = {
            "job_id": "job-pre-expired",
            "attempt_id": "att-1",
            "lease_id": "lease-1",
            "download_url": "https://storage.example.com/doc.pdf",
            "settings": {"copies": 1},
            "lease_expires_at": past_exp,
            "shop_id": "shop-test-111",
        }
        self.transport.queue_response(200, response_payload)

        with self.assertRaises(ContractValidationError) as ctx:
            self.client.claim_job()
        self.assertIn("lease expired immediately upon receipt", str(ctx.exception))

    def test_update_job_status_happy_path(self) -> None:
        self.transport.queue_response(200, {"status": "recorded"})

        resp = self.client.update_job_status(
            job_id="job-100",
            attempt_id="att-200",
            status="printing",
            spooler_job_id=42,
        )
        self.assertEqual(resp, {"status": "recorded"})

        req = self.transport.recorded_requests[0]
        self.assertEqual(req["url"], "https://cloud.caps.example.com/api/v1/agent/jobs/status")
        self.assertEqual(req["body"]["job_id"], "job-100")
        self.assertEqual(req["body"]["attempt_id"], "att-200")
        self.assertEqual(req["body"]["status"], "printing")
        self.assertEqual(req["body"]["spooler_job_id"], 42)

    def test_update_job_status_rejects_invalid_status(self) -> None:
        with self.assertRaises(ContractValidationError) as ctx:
            self.client.update_job_status("j1", "a1", "random_unsupported_status")
        self.assertIn("Status 'random_unsupported_status' invalid", str(ctx.exception))

    def test_heartbeat_payload(self) -> None:
        self.transport.queue_response(200, {"signal": "idle"})
        resp = self.client.heartbeat()
        self.assertEqual(resp, {"signal": "idle"})

        req = self.transport.recorded_requests[0]
        self.assertEqual(req["url"], "https://cloud.caps.example.com/api/v1/agent/heartbeat")
        self.assertEqual(req["body"]["device_id"], "dev-test-222")
        self.assertEqual(req["body"]["shop_id"], "shop-test-111")
        self.assertIn("timestamp", req["body"])

    def test_sync_printers_payload(self) -> None:
        self.transport.queue_response(200, {"synced": 1})
        printers = [{"name": "Brother-HL-L2321D", "status": "online"}]
        resp = self.client.sync_printers(printers)
        self.assertEqual(resp, {"synced": 1})

        req = self.transport.recorded_requests[0]
        self.assertEqual(req["url"], "https://cloud.caps.example.com/api/v1/agent/printers/sync")
        self.assertEqual(req["body"]["printers"], printers)

    def test_tenant_mismatch_on_http_403(self) -> None:
        self.transport.queue_response(403, {"message": "Tenant forbidden"})
        with self.assertRaises(TenantMismatchError):
            self.client.get("/api/v1/protected")

    def test_401_triggers_token_refresh_hook_and_retries(self) -> None:
        # First request returns 401 Unauthorized
        self.transport.queue_response(401, {"message": "Token expired"})
        # Second request after refresh returns 200 OK
        self.transport.queue_response(200, {"data": "success_after_refresh"})

        refresh_called = False

        def mock_refresh() -> AgentCredentials:
            nonlocal refresh_called
            refresh_called = True
            return AgentCredentials(
                shop_id="shop-test-111",
                device_id="dev-test-222",
                device_token="new-refreshed-token-999",
            )

        self.client.token_refresh_hook = mock_refresh

        result = self.client.get("/api/v1/resource")
        self.assertEqual(result, {"data": "success_after_refresh"})
        self.assertTrue(refresh_called)
        self.assertEqual(len(self.transport.recorded_requests), 2)

        # Check that the second request used the new bearer token
        second_req = self.transport.recorded_requests[1]
        self.assertEqual(second_req["headers"]["Authorization"], "Bearer new-refreshed-token-999")

    def test_401_without_refresh_hook_raises_auth_error(self) -> None:
        self.transport.queue_response(401, {"message": "Unauthorized"})
        self.client.token_refresh_hook = None
        with self.assertRaises(AuthenticationError):
            self.client.get("/api/v1/resource")

    def test_401_refresh_fails_once_does_not_loop(self) -> None:
        # Both requests return 401
        self.transport.queue_response(401, {"message": "Token expired"})
        self.transport.queue_response(401, {"message": "New token also rejected"})

        def mock_refresh() -> AgentCredentials:
            return AgentCredentials(
                shop_id="shop-test-111",
                device_id="dev-test-222",
                device_token="still-invalid-token",
            )

        self.client.token_refresh_hook = mock_refresh

        with self.assertRaises(CloudApiError):
            self.client.get("/api/v1/resource")

        # Must not retry indefinitely: exactly 2 attempts
        self.assertEqual(len(self.transport.recorded_requests), 2)

    def test_transient_502_503_retries_and_succeeds(self) -> None:
        # 503 Service Unavailable, followed by 200 OK
        self.transport.queue_response(503, {"message": "Service unavailable"})
        self.transport.queue_response(200, {"result": "recovered"})

        res = self.client.get("/api/v1/flaky")
        self.assertEqual(res, {"result": "recovered"})
        self.assertEqual(len(self.transport.recorded_requests), 2)

    def test_network_timeout_retries_and_raises(self) -> None:
        self.client.max_retries = 2
        self.transport.queue_exception(NetworkTimeoutError("Connection timed out"))
        self.transport.queue_exception(NetworkTimeoutError("Connection timed out"))
        self.transport.queue_exception(NetworkTimeoutError("Connection timed out"))

        with self.assertRaises(NetworkTimeoutError):
            self.client.get("/api/v1/slow")

        self.assertEqual(len(self.transport.recorded_requests), 3)

    def test_download_document_happy_path_with_sha256(self) -> None:
        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        expected_hash = hashlib.sha256(pdf_bytes).hexdigest()

        self.transport.queue_response(200, pdf_bytes, headers={"content-type": "application/pdf"})

        with tempfile.TemporaryDirectory() as tmp_dir:
            dest_file = (Path(tmp_dir) / "downloaded.pdf").resolve()
            result_path = self.client.download_document(
                download_url="https://cloud.caps.example.com/files/test.pdf",
                destination_path=dest_file,
                expected_sha256=expected_hash,
            )

            self.assertEqual(result_path.resolve(), dest_file.resolve())
            self.assertTrue(dest_file.exists())
            self.assertEqual(dest_file.read_bytes(), pdf_bytes)

    def test_download_document_sha256_mismatch_deletes_file(self) -> None:
        actual_bytes = b"%PDF-corrupted-or-tampered"
        expected_hash = "0000000000000000000000000000000000000000000000000000000000000000"

        self.transport.queue_response(200, actual_bytes)

        with tempfile.TemporaryDirectory() as tmp_dir:
            dest_file = Path(tmp_dir) / "corrupted.pdf"
            with self.assertRaises(ChecksumMismatchError) as ctx:
                self.client.download_document(
                    download_url="https://cloud.caps.example.com/files/corrupted.pdf",
                    destination_path=dest_file,
                    expected_sha256=expected_hash,
                )

            self.assertEqual(ctx.exception.expected, expected_hash)
            # Integrity requirement: file must be immediately deleted on mismatch
            self.assertFalse(dest_file.exists())

    def test_download_document_http_failure_deletes_file(self) -> None:
        self.transport.queue_response(404, b"Not Found")

        with tempfile.TemporaryDirectory() as tmp_dir:
            dest_file = Path(tmp_dir) / "missing.pdf"
            with self.assertRaises(CloudApiError):
                self.client.download_document(
                    download_url="https://cloud.caps.example.com/files/missing.pdf",
                    destination_path=dest_file,
                )

            self.assertFalse(dest_file.exists())


class TestLoggingZeroTokenPolicy(unittest.TestCase):
    """Verify that credentials and client logs never leak tokens."""

    def test_credentials_token_never_in_log_records(self) -> None:
        secret_token = "secret-super-sensitive-token-12345"
        creds = AgentCredentials("shop-1", "dev-1", secret_token)

        log_capture: list[logging.LogRecord] = []

        class CaptureHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                log_capture.append(record)

        handler = CaptureHandler()
        auth_logger = logging.getLogger("caps_agent.auth")
        auth_logger.addHandler(handler)
        auth_logger.setLevel(logging.DEBUG)

        try:
            auth_logger.info("Current credentials representation: %s", creds)
            for record in log_capture:
                message = record.getMessage()
                self.assertNotIn(secret_token, message)
        finally:
            auth_logger.removeHandler(handler)


if __name__ == "__main__":
    unittest.main()
