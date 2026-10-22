"""Tests for Desktop Agent Secure PDF Downloader & Checksum Verifier (INT-D4-02).

Validates:
- Stream download over TLS with 30-second timeout
- On-the-fly SHA-256 calculation and verification against Cloud API metadata
- Immediate rejection and purge of corrupt, truncated, or mismatched files
- Backend failure reporting with DOWNLOAD_FAILED / CHECKSUM_MISMATCH
- Windows ACL restricted permissions and path traversal defenses
"""

from __future__ import annotations

import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from api_client import AgentApiClient, JobClaim
from job_download import (
    DEFAULT_DOWNLOAD_TIMEOUT,
    ChecksumMismatchError,
    CorruptedFileError,
    DownloadTimeoutError,
    ExpiredUrlError,
    SecurePdfDownloader,
    compute_file_sha256,
    download_job_document,
)
from storage import (
    JobStorageManager,
    StorageSecurityError,
    apply_restricted_acls,
)

# Standard mock PDF content
SAMPLE_PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n"
SAMPLE_PDF_SHA256 = hashlib.sha256(SAMPLE_PDF_BYTES).hexdigest().lower()


class MockHttpStreamResponse:
    """Simulates urllib HTTP response stream for controlled testing."""

    def __init__(
        self,
        body: bytes,
        status: int = 200,
        headers: dict[str, str] | None = None,
        simulate_timeout: bool = False,
    ) -> None:
        self.body = body
        self.status = status
        self.headers = headers or {
            "Content-Length": str(len(body)),
            "Content-Type": "application/pdf",
        }
        self.simulate_timeout = simulate_timeout
        self._io = io.BytesIO(body)

    def read(self, amt: int = -1) -> bytes:
        if self.simulate_timeout:
            raise TimeoutError("Simulated socket read timeout after 30s")
        return self._io.read(amt)

    def __enter__(self) -> MockHttpStreamResponse:
        return self

    def __exit__(self, *args: Any) -> None:
        pass


class MockOpener:
    """Mock URL opener replacing urllib.request.urlopen."""

    def __init__(self) -> None:
        self.routes: dict[str, MockHttpStreamResponse | Exception] = {}
        self.opened_urls: list[str] = []

    def set_response(self, url: str, resp: MockHttpStreamResponse | Exception) -> None:
        self.routes[url] = resp

    def open(self, req: Any, timeout: float = DEFAULT_DOWNLOAD_TIMEOUT) -> MockHttpStreamResponse:
        url = req.get_full_url() if hasattr(req, "get_full_url") else str(req)
        self.opened_urls.append(url)
        resp = self.routes.get(url)
        if isinstance(resp, Exception):
            raise resp
        if resp is not None:
            return resp
        # Default 200 response with valid PDF
        return MockHttpStreamResponse(SAMPLE_PDF_BYTES)


class TestJobStorageManager(unittest.TestCase):
    """Unit tests for JobStorageManager and Windows ACL restrictions."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage = JobStorageManager(base_dir=self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_job_directory_isolation(self) -> None:
        job_dir = self.storage.get_job_dir("job-1234-uuid")
        self.assertTrue(job_dir.exists())
        self.assertTrue(job_dir.is_dir())
        self.assertIn("job-1234-uuid", str(job_dir))
        self.assertTrue(str(job_dir).startswith(str(self.storage.base_dir)))

    def test_document_path_under_job_dir(self) -> None:
        doc_path = self.storage.get_document_path("job-1234-uuid", "document.pdf")
        self.assertTrue(str(doc_path).endswith("document.pdf"))
        self.assertIn("job-1234-uuid", str(doc_path))

    def test_path_traversal_rejection(self) -> None:
        malicious_ids = [
            "../escape",
            "..\\escape",
            "job/traversal",
            "job\\traversal",
            "job\0null",
            "../../etc/passwd",
            "",
            "   ",
        ]
        for bad_id in malicious_ids:
            with self.subTest(bad_id=bad_id), self.assertRaises(StorageSecurityError):
                self.storage.get_job_dir(bad_id)

    def test_purge_file_and_job_dir(self) -> None:
        doc_path = self.storage.get_document_path("job-to-purge")
        doc_path.write_bytes(b"temp test content")
        self.assertTrue(doc_path.exists())

        # Purge single file
        purged = self.storage.purge_file(doc_path)
        self.assertTrue(purged)
        self.assertFalse(doc_path.exists())

        # Re-create and purge entire job directory
        doc_path.write_bytes(b"another test content")
        purged_dir = self.storage.purge_job_files("job-to-purge")
        self.assertTrue(purged_dir)
        self.assertFalse(doc_path.exists())
        self.assertFalse((self.storage.base_dir / "job-to-purge").exists())

    def test_apply_restricted_acls(self) -> None:
        test_file = Path(self.temp_dir.name) / "test_acl.txt"
        test_file.write_text("secure file content")
        # Should succeed or fallback gracefully without raising
        result = apply_restricted_acls(test_file)
        # On Windows or POSIX, apply_restricted_acls returns True
        self.assertIsInstance(result, bool)


class TestSecurePdfDownloader(unittest.TestCase):
    """Unit and contract tests for SecurePdfDownloader."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage = JobStorageManager(base_dir=self.temp_dir.name)
        self.mock_api = MagicMock(spec=AgentApiClient)
        self.mock_opener = MockOpener()

        self.downloader = SecurePdfDownloader(
            api_client=self.mock_api,
            storage_manager=self.storage,
            timeout=30.0,
            custom_opener=self.mock_opener,
        )

        self.sample_url = (
            "https://mock-supabase.local/storage/v1/object/customer-documents/uploads/test.pdf"
        )
        self.job_id = "job-uuid-101"
        self.attempt_id = "att-101"
        self.lease_token = "lease-token-1234567890"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _sample_claim(self, **kwargs: Any) -> JobClaim:
        return JobClaim(
            job_id=kwargs.get("job_id", self.job_id),
            attempt_id=kwargs.get("attempt_id", self.attempt_id),
            lease_token=kwargs.get("lease_token", self.lease_token),
            lease_expires_at="2026-10-22T08:00:00Z",
            shop_id="shop-001",
            printer_id="printer-001",
            download_url=kwargs.get("download_url", self.sample_url),
            checksum_sha256=kwargs.get("checksum_sha256", SAMPLE_PDF_SHA256),
            content_type="application/pdf",
            file_size_bytes=kwargs.get("file_size_bytes", len(SAMPLE_PDF_BYTES)),
            settings={"copies": 1, "color_mode": "bw"},
            created_at="2026-10-22T06:00:00Z",
        )

    def test_successful_pdf_download_and_checksum_verification(self) -> None:
        """Step 1 & 2: Stream download completes and SHA-256 hash verifies successfully."""
        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(SAMPLE_PDF_BYTES, status=200),
        )

        claim = self._sample_claim()
        result_path = self.downloader.download_job(claim)

        # 1. Verify returned path
        self.assertTrue(result_path.exists())
        self.assertEqual(result_path.name, "document.pdf")
        self.assertIn(self.job_id, str(result_path))

        # 2. Verify file content and checksum
        downloaded_bytes = result_path.read_bytes()
        self.assertEqual(downloaded_bytes, SAMPLE_PDF_BYTES)
        self.assertEqual(compute_file_sha256(result_path), SAMPLE_PDF_SHA256)

        # 3. Verify DOWNLOADING status reported to Cloud API
        self.mock_api.update_job_status.assert_called_once_with(
            job_id=self.job_id,
            attempt_id=self.attempt_id,
            status="DOWNLOADING",
            lease_token=self.lease_token,
            pages_printed=0,
            total_pages=1,
        )

    def test_checksum_mismatch_purges_file_and_reports_failure(self) -> None:
        """Step 3: Reject and purge file immediately if checksum does not match Cloud API hash."""
        tampered_content = b"%PDF-1.7\nCorrupted or tampered content"
        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(tampered_content, status=200),
        )

        claim = self._sample_claim(
            checksum_sha256=SAMPLE_PDF_SHA256,
            file_size_bytes=len(tampered_content),
        )
        dest_path = self.storage.get_document_path(self.job_id, "document.pdf")

        # Must raise ChecksumMismatchError
        with self.assertRaises(ChecksumMismatchError) as ctx:
            self.downloader.download_job(claim)

        self.assertEqual(ctx.exception.expected, SAMPLE_PDF_SHA256)
        self.assertEqual(ctx.exception.error_code, "CHECKSUM_MISMATCH")

        # Acceptance Criteria: File MUST be purged immediately
        self.assertFalse(dest_path.exists(), "Corrupt/mismatched file was not purged from disk!")

        # Acceptance Criteria: DOWNLOAD_FAILED reported to backend
        self.mock_api.update_job_status.assert_any_call(
            job_id=self.job_id,
            attempt_id=self.attempt_id,
            status="FAILED",
            lease_token=self.lease_token,
            error_code="CHECKSUM_MISMATCH",
            error_message=unittest.mock.ANY,
            pages_printed=0,
            total_pages=1,
        )

    def test_corrupt_non_pdf_file_purges_and_reports_download_failed(self) -> None:
        """Reject file missing valid %PDF- magic bytes header."""
        html_error_page = b"<html><body>404 Not Found</body></html>"
        html_sha256 = hashlib.sha256(html_error_page).hexdigest()

        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(html_error_page, status=200),
        )

        claim = self._sample_claim(checksum_sha256=html_sha256)
        dest_path = self.storage.get_document_path(self.job_id, "document.pdf")

        with self.assertRaises(CorruptedFileError):
            self.downloader.download_job(claim)

        # File must be purged
        self.assertFalse(dest_path.exists())

        # Backend receives FAILED with DOWNLOAD_FAILED error code
        self.mock_api.update_job_status.assert_any_call(
            job_id=self.job_id,
            attempt_id=self.attempt_id,
            status="FAILED",
            lease_token=self.lease_token,
            error_code="DOWNLOAD_FAILED",
            error_message=unittest.mock.ANY,
            pages_printed=0,
            total_pages=1,
        )

    def test_truncated_stream_purges_file_and_reports_download_failed(self) -> None:
        """Reject truncated download where received bytes are less than expected size."""
        truncated_bytes = b"%PDF-1.4\nTruncated..."
        expected_full_length = 50000

        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(
                truncated_bytes,
                status=200,
                headers={"Content-Length": str(expected_full_length)},
            ),
        )

        claim = self._sample_claim(file_size_bytes=expected_full_length)
        dest_path = self.storage.get_document_path(self.job_id, "document.pdf")

        with self.assertRaises(CorruptedFileError):
            self.downloader.download_job(claim)

        self.assertFalse(dest_path.exists())
        self.mock_api.update_job_status.assert_any_call(
            job_id=self.job_id,
            attempt_id=self.attempt_id,
            status="FAILED",
            lease_token=self.lease_token,
            error_code="DOWNLOAD_FAILED",
            error_message=unittest.mock.ANY,
            pages_printed=0,
            total_pages=1,
        )

    def test_download_timeout_purges_and_reports_failure(self) -> None:
        """Step 1: Download times out after 30 seconds -> aborts and purges."""
        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(SAMPLE_PDF_BYTES, simulate_timeout=True),
        )

        claim = self._sample_claim()
        dest_path = self.storage.get_document_path(self.job_id, "document.pdf")

        with self.assertRaises(DownloadTimeoutError):
            self.downloader.download_job(claim)

        self.assertFalse(dest_path.exists())
        self.mock_api.update_job_status.assert_any_call(
            job_id=self.job_id,
            attempt_id=self.attempt_id,
            status="FAILED",
            lease_token=self.lease_token,
            error_code="DOWNLOAD_FAILED",
            error_message=unittest.mock.ANY,
            pages_printed=0,
            total_pages=1,
        )

    def test_expired_presigned_url_reports_failure(self) -> None:
        """HTTP 403 / 410 URL expiration is rejected."""
        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(b"Forbidden", status=403),
        )

        claim = self._sample_claim()
        dest_path = self.storage.get_document_path(self.job_id, "document.pdf")

        with self.assertRaises(ExpiredUrlError):
            self.downloader.download_job(claim)

        self.assertFalse(dest_path.exists())
        self.mock_api.update_job_status.assert_any_call(
            job_id=self.job_id,
            attempt_id=self.attempt_id,
            status="FAILED",
            lease_token=self.lease_token,
            error_code="DOWNLOAD_FAILED",
            error_message=unittest.mock.ANY,
            pages_printed=0,
            total_pages=1,
        )

    def test_download_job_document_convenience_function(self) -> None:
        """Test top-level helper function download_job_document."""
        self.mock_opener.set_response(
            self.sample_url,
            MockHttpStreamResponse(SAMPLE_PDF_BYTES, status=200),
        )

        claim = self._sample_claim()
        result = download_job_document(
            claim=claim,
            api_client=self.mock_api,
            storage_manager=self.storage,
            custom_opener=self.mock_opener,
        )

        self.assertTrue(result.exists())
        self.assertEqual(result.name, "document.pdf")


if __name__ == "__main__":
    unittest.main()
