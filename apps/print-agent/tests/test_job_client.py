"""Unit and contract tests for CAPS Print Agent JobClient and document download.

Tests cover:
- Secure scoped PDF download with isolated per-job directories
- Expired download URL handling (HTTP 403/410, lease expiration)
- Partial download handling (truncated streams, Content-Length mismatch, corrupt headers)
- Checksum mismatch handling (immediate cleanup on tamper/corruption)
- End-to-end execute_job lifecycle (downloading -> submit -> printing -> completed)
- Queue backpressure handling and failure status sync
- Automatic temp file cleanup on terminal outcomes
"""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from caps_agent.cloud.api_client import (
    ChecksumMismatchError,
    HttpResponse,
    JobClaimResponse,
)
from caps_agent.cloud.job_client import (
    ExpiredDownloadUrlError,
    JobClient,
    PartialDownloadError,
)
from caps_agent.cloud.status_sync import StatusSyncManager
from caps_agent.jobs.dispatcher import JobDispatcher
from caps_agent.jobs.state_machine import JobState
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.storage.temp_files import TempFileManager


class MockHttpTransport:
    """Mock transport for controlled HTTP responses."""

    def __init__(self) -> None:
        self.responses: dict[str, HttpResponse | Exception] = {}
        self.recorded_requests: list[dict[str, Any]] = []

    def queue_response(
        self,
        url: str,
        status_code: int = 200,
        body: bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
        headers: dict[str, str] | None = None,
    ) -> None:
        hdrs = headers or {"content-type": "application/pdf"}
        self.responses[url] = HttpResponse(status_code=status_code, headers=hdrs, body=body)

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None = None,
        timeout: float = 10.0,
    ) -> HttpResponse:
        self.recorded_requests.append({"method": method, "url": url, "headers": headers})
        resp = self.responses.get(url)
        if isinstance(resp, Exception):
            raise resp
        if resp is not None:
            return resp
        # Default response
        return HttpResponse(200, {"content-type": "application/pdf"}, b"%PDF-1.4\n%%EOF")


class TestJobClient(unittest.TestCase):
    """Test suite for JobClient document download, execution, and cleanup."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_temp = Path(self.temp_dir.name)

        self.transport = MockHttpTransport()
        self.mock_api = MagicMock()
        self.mock_api.transport = self.transport
        self.mock_api.base_url = "https://cloud.caps.example.com"
        self.mock_api._build_headers.return_value = {"Authorization": "Bearer mock-tok"}

        self.status_sync = MagicMock(spec=StatusSyncManager)
        self.engine = FakePrintEngine(configured_printers=["LaserPrinter", "DefaultPrinter"])
        self.dispatcher = JobDispatcher(engine=self.engine, shop_id="shop-test-1")
        self.temp_mgr = TempFileManager(base_dir=self.base_temp, secure_permissions=False)

        self.job_client = JobClient(
            api_client=self.mock_api,
            status_sync=self.status_sync,
            dispatcher=self.dispatcher,
            temp_mgr=self.temp_mgr,
            default_printer="DefaultPrinter",
            auto_cleanup=True,
        )

    def tearDown(self) -> None:
        self.dispatcher.shutdown(wait=True)
        self.temp_dir.cleanup()

    def _sample_claim(
        self,
        job_id: str = "job-doc-1",
        attempt_id: str = "att-doc-1",
        download_url: str = "https://storage.caps.example.com/files/doc1.pdf",
        checksum: str | None = None,
        lease_expires_at: str | None = None,
    ) -> JobClaimResponse:
        exp = lease_expires_at or (datetime.now(UTC) + timedelta(minutes=5)).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        return JobClaimResponse(
            job_id=job_id,
            attempt_id=attempt_id,
            lease_id=f"lease-{job_id}",
            download_url=download_url,
            settings={
                "paper_size": "a4",
                "color_mode": "monochrome",
                "copies": 1,
                "duplex": "simplex",
                "printer_name": "LaserPrinter",
            },
            lease_expires_at=exp,
            checksum_sha256=checksum,
        )

    # ==========================================================================
    # Document Download Tests
    # ==========================================================================

    def test_download_document_happy_path(self) -> None:
        valid_pdf = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        expected_sha = hashlib.sha256(valid_pdf).hexdigest()
        url = "https://storage.caps.example.com/files/valid.pdf"

        self.transport.queue_response(url, status_code=200, body=valid_pdf)
        claim = self._sample_claim(download_url=url, checksum=expected_sha)

        pdf_path = self.job_client.download_document(claim)

        self.assertTrue(pdf_path.exists())
        self.assertEqual(pdf_path.read_bytes(), valid_pdf)
        # Check that file was registered with temp_mgr
        self.assertIn(pdf_path, self.temp_mgr.list_tracked_files("job-doc-1"))

    def test_expired_download_url_403_raises_and_cleans_file(self) -> None:
        """Verify: HTTP 403 on download raises ExpiredDownloadUrlError with no leftover files."""
        url = "https://storage.caps.example.com/files/expired.pdf"
        self.transport.queue_response(
            url, status_code=403, body=b"Access Denied / Expired Signature"
        )
        claim = self._sample_claim(download_url=url)

        with self.assertRaises(ExpiredDownloadUrlError) as ctx:
            self.job_client.download_document(claim)

        self.assertEqual(ctx.exception.status_code, 403)
        # Check no files created in temp_mgr
        self.assertEqual(len(self.temp_mgr.list_job_files(claim.job_id)), 0)

    def test_expired_download_url_410_raises_and_cleans_file(self) -> None:
        """Verify: HTTP 410 Gone on download raises ExpiredDownloadUrlError."""
        url = "https://storage.caps.example.com/files/gone.pdf"
        self.transport.queue_response(url, status_code=410, body=b"Gone")
        claim = self._sample_claim(download_url=url)

        with self.assertRaises(ExpiredDownloadUrlError) as ctx:
            self.job_client.download_document(claim)

        self.assertEqual(ctx.exception.status_code, 410)
        self.assertEqual(len(self.temp_mgr.list_job_files(claim.job_id)), 0)

    def test_expired_lease_raises_before_download(self) -> None:
        past_dt = (datetime.now(UTC) - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        claim = self._sample_claim(lease_expires_at=past_dt)

        with self.assertRaises(ExpiredDownloadUrlError) as ctx:
            self.job_client.download_document(claim)

        self.assertIn("lease expired", str(ctx.exception))
        # Ensure zero network calls made
        self.assertEqual(len(self.transport.recorded_requests), 0)

    def test_partial_download_truncated_content_length_raises(self) -> None:
        """Verify: Truncated stream with Content-Length mismatch raises PartialDownloadError."""
        short_body = b"%PDF-1.4\npartial"
        url = "https://storage.caps.example.com/files/partial.pdf"
        # Content-Length is 5000, but only len(short_body) delivered
        self.transport.queue_response(
            url,
            status_code=200,
            body=short_body,
            headers={"content-length": "5000"},
        )
        claim = self._sample_claim(download_url=url)

        with self.assertRaises(PartialDownloadError) as ctx:
            self.job_client.download_document(claim)

        self.assertIn("Truncated stream", str(ctx.exception))
        self.assertEqual(len(self.temp_mgr.list_job_files(claim.job_id)), 0)

    def test_partial_download_corrupted_header_raises(self) -> None:
        """Verify: Download with invalid PDF header raises PartialDownloadError."""
        corrupted = b"<html><head><title>Error</title></head></html>"
        url = "https://storage.caps.example.com/files/corrupted.pdf"
        self.transport.queue_response(url, status_code=200, body=corrupted)
        claim = self._sample_claim(download_url=url)

        with self.assertRaises(PartialDownloadError) as ctx:
            self.job_client.download_document(claim)

        self.assertIn("missing valid PDF header", str(ctx.exception))
        self.assertEqual(len(self.temp_mgr.list_job_files(claim.job_id)), 0)

    def test_checksum_mismatch_raises_and_cleans_file(self) -> None:
        """Verify: SHA-256 mismatch raises ChecksumMismatchError and deletes file."""
        body = b"%PDF-1.4\ntest content\n%%EOF"
        expected_bad_sha = "0000000000000000000000000000000000000000000000000000000000000000"
        url = "https://storage.caps.example.com/files/tampered.pdf"
        self.transport.queue_response(url, status_code=200, body=body)
        claim = self._sample_claim(download_url=url, checksum=expected_bad_sha)

        with self.assertRaises(ChecksumMismatchError) as ctx:
            self.job_client.download_document(claim)

        self.assertEqual(ctx.exception.expected, expected_bad_sha)
        self.assertEqual(len(self.temp_mgr.list_job_files(claim.job_id)), 0)

    # ==========================================================================
    # End-to-End Execute Job Lifecycle Tests
    # ==========================================================================

    def test_execute_job_happy_path_and_automatic_cleanup(self) -> None:
        """Verify: downloading -> submitted -> printing -> completed with automatic cleanup."""
        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
        url = "https://storage.caps.example.com/files/e2e.pdf"
        self.transport.queue_response(url, status_code=200, body=pdf_bytes)

        claim = self._sample_claim(job_id="job-e2e-1", attempt_id="att-e2e-1", download_url=url)

        sm = self.job_client.execute_job(claim)
        self.assertIsNotNone(sm)

        # Wait for dispatcher execution to finish
        final_state = self.dispatcher.wait_for_job("job-e2e-1", timeout=5.0)
        self.assertEqual(final_state, JobState.COMPLETED)

        # Check status_sync recorded 'downloading'
        self.status_sync.record_status.assert_any_call("job-e2e-1", "att-e2e-1", "downloading")

        # Spooler submission was executed on fake engine
        self.assertEqual(len(self.engine.submission_log), 1)

        # Automatic cleanup: verify temp files were completely scrubbed
        remaining_files = self.temp_mgr.list_job_files("job-e2e-1")
        self.assertEqual(len(remaining_files), 0)

    def test_execute_job_expired_url_reports_failed_status(self) -> None:
        url = "https://storage.caps.example.com/files/expired-exec.pdf"
        self.transport.queue_response(url, status_code=403, body=b"Expired URL")

        claim = self._sample_claim(
            job_id="job-exp-exec", attempt_id="att-exp-exec", download_url=url
        )

        res = self.job_client.execute_job(claim)
        self.assertIsNone(res)

        # Status 'failed' must be reported to status_sync
        self.status_sync.record_status.assert_any_call(
            job_id="job-exp-exec",
            attempt_id="att-exp-exec",
            status="failed",
            error_message="Download URL expired: Download URL expired or forbidden for job 'job-exp-exec' (HTTP 403)",
        )
        self.assertEqual(len(self.temp_mgr.list_job_files("job-exp-exec")), 0)

    def test_execute_job_partial_download_reports_failed_status(self) -> None:
        url = "https://storage.caps.example.com/files/partial-exec.pdf"
        self.transport.queue_response(
            url, status_code=200, body=b"truncated", headers={"content-length": "1000"}
        )

        claim = self._sample_claim(
            job_id="job-part-exec", attempt_id="att-part-exec", download_url=url
        )

        res = self.job_client.execute_job(claim)
        self.assertIsNone(res)

        self.status_sync.record_status.assert_any_call(
            job_id="job-part-exec",
            attempt_id="att-part-exec",
            status="failed",
            error_message="Document corrupted or partial: Truncated stream for job 'job-part-exec': received 9/1000 bytes",
        )
        self.assertEqual(len(self.temp_mgr.list_job_files("job-part-exec")), 0)


if __name__ == "__main__":
    unittest.main()
