"""Desktop Agent Secure PDF Downloader & Checksum Verifier (INT-D4-02).

Connects Print Agent to fetch PDF files via presigned URL, verifies SHA-256
integrity hash against Cloud API metadata, enforces Windows ACL restrictions,
and handles immediate purge and failure reporting on corruption.
"""

from __future__ import annotations

import hashlib
import http.client
import logging
import ssl
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from storage import JobStorageManager, apply_restricted_acls

if TYPE_CHECKING:
    from api_client import AgentApiClient, JobClaim

logger = logging.getLogger("caps_agent.job_download")

DEFAULT_DOWNLOAD_TIMEOUT = 30.0
CHUNK_SIZE = 65536  # 64 KB streaming buffer


# ==============================================================================
# Download Exceptions
# ==============================================================================


class DownloadError(Exception):
    """Base exception for document download failures."""

    def __init__(self, message: str, error_code: str = "DOWNLOAD_FAILED", status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.status_code = status_code


class ChecksumMismatchError(DownloadError):
    """Raised when downloaded document SHA-256 does not match expected hash."""

    def __init__(self, expected: str, actual: str, message: str | None = None) -> None:
        msg = message or f"SHA-256 checksum mismatch: expected '{expected}', calculated '{actual}'"
        super().__init__(msg, error_code="CHECKSUM_MISMATCH")
        self.expected = expected.lower().strip()
        self.actual = actual.lower().strip()


class CorruptedFileError(DownloadError):
    """Raised when downloaded document is incomplete, truncated, or lacks valid PDF header."""

    def __init__(self, message: str = "Downloaded document is corrupted or incomplete") -> None:
        super().__init__(message, error_code="DOWNLOAD_FAILED")


class ExpiredUrlError(DownloadError):
    """Raised when presigned download URL has expired (HTTP 403 or 410)."""

    def __init__(self, message: str = "Download URL has expired or is forbidden", status_code: int = 403) -> None:
        super().__init__(message, error_code="DOWNLOAD_FAILED", status_code=status_code)


class DownloadTimeoutError(DownloadError):
    """Raised when TLS download exceeds the 30-second timeout."""

    def __init__(self, message: str = "Download stream timed out after 30 seconds") -> None:
        super().__init__(message, error_code="DOWNLOAD_FAILED")


# ==============================================================================
# Secure PDF Downloader
# ==============================================================================


class SecurePdfDownloader:
    """Stream-downloads PDF documents, verifies SHA-256 checksums, and manages temp storage."""

    def __init__(
        self,
        api_client: AgentApiClient | None = None,
        storage_manager: JobStorageManager | None = None,
        timeout: float = DEFAULT_DOWNLOAD_TIMEOUT,
        custom_opener: Any = None,
    ) -> None:
        self.api_client = api_client
        self.storage_manager = storage_manager or JobStorageManager()
        self.timeout = timeout
        self.custom_opener = custom_opener

    def download_file(
        self,
        url: str,
        destination_path: Path | str,
        expected_sha256: str | None = None,
        expected_size_bytes: int | None = None,
        job_id: str | None = None,
        attempt_id: str | None = None,
        lease_token: str | None = None,
    ) -> Path:
        """Stream download PDF over TLS with 30-second timeout, hashing on the fly.

        Steps:
        1. Report DOWNLOADING status to Cloud API if client is available.
        2. Stream download chunks over TLS with 30s timeout into destination_path.
        3. Calculate SHA-256 digest during stream download.
        4. Validate %PDF- header and Content-Length completeness.
        5. Verify SHA-256 integrity hash against expected_sha256.
        6. Apply restricted Windows ACLs (read/write only to current user & SYSTEM).
        7. If corrupt or mismatched, purge immediately and report DOWNLOAD_FAILED.
        """
        dest = Path(destination_path).resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)

        # 1. Notify Cloud API of DOWNLOADING status transition
        if self.api_client and job_id and attempt_id and lease_token:
            try:
                self.api_client.update_job_status(
                    job_id=job_id,
                    attempt_id=attempt_id,
                    status="DOWNLOADING",
                    lease_token=lease_token,
                    pages_printed=0,
                    total_pages=1,
                )
            except Exception as notify_err:
                logger.warning("Failed to report DOWNLOADING status for job '%s': %s", job_id, notify_err)

        hasher = hashlib.sha256()
        bytes_received = 0

        try:
            # 2. Open stream over TLS with 30-second timeout
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "CAPS-Desktop-Print-Agent/1.0.0"},
            )

            # Build SSL context for TLS verification
            ssl_context = None
            parsed_url = urllib.parse.urlparse(url)
            if parsed_url.scheme == "https":
                ssl_context = ssl.create_default_context()

            # Use custom opener if provided (useful for tests and mock transports)
            if self.custom_opener is not None:
                response = self.custom_opener.open(req, timeout=self.timeout)
            elif ssl_context is not None:
                response = urllib.request.urlopen(req, timeout=self.timeout, context=ssl_context)
            else:
                response = urllib.request.urlopen(req, timeout=self.timeout)

            with response:
                status_code = getattr(response, "status", 200)
                if status_code in (403, 410):
                    raise ExpiredUrlError(
                        f"Download URL expired or forbidden (HTTP {status_code}) for '{url}'",
                        status_code=status_code,
                    )
                if status_code != 200:
                    raise DownloadError(
                        f"Download failed with HTTP status {status_code}",
                        status_code=status_code,
                    )

                # Check Content-Length header if present
                content_length_hdr = response.headers.get("Content-Length")
                header_expected_len = None
                if content_length_hdr:
                    try:
                        header_expected_len = int(content_length_hdr)
                    except ValueError:
                        pass

                # Stream chunks into destination file
                with open(dest, "wb") as out_file:
                    while True:
                        try:
                            chunk = response.read(CHUNK_SIZE)
                        except TimeoutError as timeout_err:
                            raise DownloadTimeoutError(
                                f"TLS download timed out after {self.timeout}s: {timeout_err}"
                            ) from timeout_err
                        except http.client.IncompleteRead as inc_err:
                            hasher.update(inc_err.partial)
                            out_file.write(inc_err.partial)
                            bytes_received += len(inc_err.partial)
                            raise CorruptedFileError(
                                f"Incomplete read during stream download: received {bytes_received} bytes"
                            ) from inc_err

                        if not chunk:
                            break

                        hasher.update(chunk)
                        out_file.write(chunk)
                        bytes_received += len(chunk)

            # 3. Check for empty file
            if bytes_received == 0:
                raise CorruptedFileError(f"Downloaded 0 bytes from '{url}' for job '{job_id}'")

            # 4. Check Content-Length completeness
            target_expected_len = expected_size_bytes or header_expected_len
            if target_expected_len is not None and target_expected_len > 0:
                if bytes_received < target_expected_len:
                    raise CorruptedFileError(
                        f"Truncated download: received {bytes_received}/{target_expected_len} bytes"
                    )

            # 5. Check valid PDF signature (%PDF-)
            with open(dest, "rb") as verify_f:
                header_bytes = verify_f.read(5)
                if not header_bytes.startswith(b"%PDF-"):
                    raise CorruptedFileError(
                        f"Downloaded file for job '{job_id}' lacks valid PDF magic bytes (%PDF-)"
                    )

            # 6. Verify SHA-256 checksum against expected hash
            calculated_sha256 = hasher.hexdigest().lower()
            if expected_sha256:
                clean_expected = expected_sha256.strip().lower()
                if calculated_sha256 != clean_expected:
                    raise ChecksumMismatchError(expected=clean_expected, actual=calculated_sha256)

            # 7. Apply restrictive Windows ACLs to the completed file
            apply_restricted_acls(dest)
            logger.info(
                "Securely downloaded and verified document for job '%s' (%d bytes, SHA-256: %s)",
                job_id or "unspecified",
                bytes_received,
                calculated_sha256,
            )
            return dest

        except Exception as exc:
            # Immediate purge on download, validation, or checksum error
            if dest.exists():
                try:
                    dest.unlink(missing_ok=True)
                    logger.warning("Purged corrupt/failed download artifact at %s", dest)
                except Exception as purge_err:
                    logger.error("Failed to purge failed download artifact %s: %s", dest, purge_err)

            # Report DOWNLOAD_FAILED to backend
            if self.api_client and job_id and attempt_id and lease_token:
                error_code = getattr(exc, "error_code", "DOWNLOAD_FAILED")
                try:
                    self.api_client.update_job_status(
                        job_id=job_id,
                        attempt_id=attempt_id,
                        status="FAILED",
                        lease_token=lease_token,
                        error_code=error_code,
                        error_message=str(exc)[:1000],
                        pages_printed=0,
                        total_pages=1,
                    )
                except Exception as report_err:
                    logger.warning(
                        "Failed to report DOWNLOAD_FAILED status to backend for job '%s': %s",
                        job_id,
                        report_err,
                    )

            raise

    def download_job(self, claim: JobClaim | dict[str, Any]) -> Path:
        """Download and verify document for a claimed print job."""
        if hasattr(claim, "job_id"):
            job_id = claim.job_id
            attempt_id = claim.attempt_id
            lease_token = claim.lease_token
            download_url = claim.download_url
            checksum_sha256 = claim.checksum_sha256
            file_size_bytes = claim.file_size_bytes
        else:
            job_id = claim.get("job_id", "")
            attempt_id = claim.get("attempt_id", "")
            lease_token = claim.get("lease_token") or claim.get("lease_id", "")
            download_url = claim.get("download_url", "")
            checksum_sha256 = claim.get("checksum_sha256", "")
            file_size_bytes = claim.get("file_size_bytes")

        if not download_url:
            raise DownloadError(f"Claim for job '{job_id}' missing required download_url")

        dest_path = self.storage_manager.get_document_path(job_id, "document.pdf")

        return self.download_file(
            url=download_url,
            destination_path=dest_path,
            expected_sha256=checksum_sha256 or None,
            expected_size_bytes=file_size_bytes or None,
            job_id=job_id,
            attempt_id=attempt_id,
            lease_token=lease_token,
        )


# ==============================================================================
# Helper Functions
# ==============================================================================


def download_job_document(
    claim: JobClaim | dict[str, Any],
    api_client: AgentApiClient | None = None,
    storage_manager: JobStorageManager | None = None,
    timeout: float = DEFAULT_DOWNLOAD_TIMEOUT,
    custom_opener: Any = None,
) -> Path:
    """Convenience function to download and verify a claimed job's PDF document."""
    downloader = SecurePdfDownloader(
        api_client=api_client,
        storage_manager=storage_manager,
        timeout=timeout,
        custom_opener=custom_opener,
    )
    return downloader.download_job(claim)


def compute_file_sha256(file_path: Path | str) -> str:
    """Calculate the hexadecimal SHA-256 digest of a local file."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(CHUNK_SIZE):
            hasher.update(chunk)
    return hasher.hexdigest().lower()
