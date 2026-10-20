"""Job client coordinator for secure document download, execution, and cleanup.

Provides end-to-end management of claimed print jobs:
- Short-lived scoped PDF download with isolated per-job directories
- Strict SHA-256 integrity verification and Content-Length completeness checks
- Explicit handling of expired download URLs (HTTP 403/410) and truncated streams
- Automatic cleanup of temporary files upon terminal outcomes
- Integration with StatusSyncManager for attempt status tracking and offline retries
"""

from __future__ import annotations

import hashlib
import logging
import urllib.parse
from pathlib import Path
from typing import TYPE_CHECKING

from caps_agent.cloud.api_client import (
    ChecksumMismatchError,
    CloudApiClient,
    CloudApiError,
    JobClaimResponse,
)
from caps_agent.cloud.realtime_client import map_claim_settings_to_print_settings
from caps_agent.cloud.status_sync import StatusSyncManager
from caps_agent.jobs.dispatcher import JobDispatcher, JobItem
from caps_agent.storage.temp_files import TempFileManager

if TYPE_CHECKING:
    from caps_agent.jobs.state_machine import JobState, JobStateMachine

logger = logging.getLogger("caps_agent.cloud.job_client")


# ==============================================================================
# Download Exceptions
# ==============================================================================


class DownloadError(CloudApiError):
    """Base exception for document download failures."""

    def __init__(self, message: str, status_code: int | None = None, error_code: str = "DOWNLOAD_ERROR"):
        super().__init__(message, status_code=status_code, error_code=error_code)


class ExpiredDownloadUrlError(DownloadError):
    """Raised when a download URL has expired (HTTP 403/410 or pre-expired lease)."""

    def __init__(self, message: str = "Download URL has expired or is forbidden", status_code: int | None = 403):
        super().__init__(message, status_code=status_code, error_code="EXPIRED_DOWNLOAD_URL")


class PartialDownloadError(DownloadError):
    """Raised when downloaded document stream is truncated or missing valid PDF structure."""

    def __init__(self, message: str = "Downloaded document is truncated or corrupted"):
        super().__init__(message, error_code="PARTIAL_DOWNLOAD")


# ==============================================================================
# Job Client Coordinator
# ==============================================================================


class JobClient:
    """Coordinates document downloading, temp directory isolation, dispatching, and cleanup."""

    def __init__(
        self,
        api_client: CloudApiClient,
        status_sync: StatusSyncManager,
        dispatcher: JobDispatcher,
        temp_mgr: TempFileManager,
        default_printer: str = "DefaultPrinter",
        auto_cleanup: bool = True,
    ) -> None:
        self.api_client = api_client
        self.status_sync = status_sync
        self.dispatcher = dispatcher
        self.temp_mgr = temp_mgr
        self.default_printer = default_printer
        self.auto_cleanup = auto_cleanup

        # Register status listener to perform temp cleanup on terminal states
        if self.auto_cleanup:
            self._register_cleanup_hook()

    def _register_cleanup_hook(self) -> None:
        """Register hook on dispatcher to clean temp files when job reaches terminal state."""

        def _on_state_transition(sm: JobStateMachine, state: JobState) -> None:
            if sm.is_terminal:
                try:
                    deleted = self.temp_mgr.cleanup_job_files(sm.job_id)
                    logger.debug("Cleaned %d temporary file(s) for terminal job '%s'", deleted, sm.job_id)
                except Exception as err:
                    logger.warning("Error during temp cleanup for job '%s': %s", sm.job_id, err)

        self.dispatcher.add_status_listener(_on_state_transition)

    def download_document(self, claim: JobClaimResponse) -> Path:
        """Stream PDF document from claim.download_url into isolated job temp directory.

        Performs:
        - Expired lease / URL validation
        - Content-Length completeness check
        - Basic PDF magic bytes validation (%PDF-)
        - SHA-256 integrity verification
        - Immediate deletion of partial/corrupted files
        """
        # 1. Lease expiration check
        if claim.is_lease_expired():
            raise ExpiredDownloadUrlError(
                f"Cannot download job '{claim.job_id}': lease expired at {claim.lease_expires_at}"
            )

        # 2. Allocate secure isolated destination
        job_dir = self.temp_mgr.get_job_dir(claim.job_id, claim.attempt_id)
        dest_path = (job_dir / f"{claim.job_id}.pdf").resolve()

        # Build download headers (omit custom auth headers for external pre-signed URLs)
        headers = self.api_client._build_headers()
        parsed = urllib.parse.urlparse(claim.download_url)
        if parsed.netloc and not claim.download_url.startswith(self.api_client.base_url):
            headers = {"User-Agent": "CAPS-Print-Agent/0.1.0"}

        try:
            resp = self.api_client.transport.request("GET", claim.download_url, headers=headers)

            # Check HTTP status
            if resp.status_code in (403, 410):
                raise ExpiredDownloadUrlError(
                    f"Download URL expired or forbidden for job '{claim.job_id}' (HTTP {resp.status_code})",
                    status_code=resp.status_code,
                )
            if resp.status_code != 200:
                raise DownloadError(
                    f"Download failed for job '{claim.job_id}' with HTTP {resp.status_code}",
                    status_code=resp.status_code,
                )

            body_bytes = resp.body

            # Check Content-Length header if provided
            content_length_str = resp.headers.get("content-length")
            if content_length_str:
                try:
                    expected_len = int(content_length_str)
                    if len(body_bytes) < expected_len:
                        raise PartialDownloadError(
                            f"Truncated stream for job '{claim.job_id}': received {len(body_bytes)}/{expected_len} bytes"
                        )
                except ValueError:
                    pass

            # Validate basic PDF structure
            if not body_bytes.startswith(b"%PDF-"):
                raise PartialDownloadError(
                    f"Downloaded document for job '{claim.job_id}' is missing valid PDF header (%PDF-)"
                )

            # Validate SHA-256 checksum if provided
            if claim.checksum_sha256:
                actual_sha = hashlib.sha256(body_bytes).hexdigest().lower()
                expected_sha = claim.checksum_sha256.strip().lower()
                if actual_sha != expected_sha:
                    raise ChecksumMismatchError(expected=expected_sha, actual=actual_sha)

            # Write file and register with temp manager
            dest_path.write_bytes(body_bytes)
            self.temp_mgr.register_file(dest_path, job_id=claim.job_id)
            logger.info("Successfully downloaded document for job '%s' (%d bytes)", claim.job_id, len(body_bytes))
            return dest_path

        except Exception:
            dest_path.unlink(missing_ok=True)
            raise

    def execute_job(self, claim: JobClaimResponse) -> JobStateMachine | None:
        """Download document, enqueue into dispatcher, and synchronize lifecycle status."""
        logger.info("Executing claimed job '%s' (attempt '%s')", claim.job_id, claim.attempt_id)

        # 1. Report 'downloading' status
        self.status_sync.record_status(claim.job_id, claim.attempt_id, "downloading")

        # 2. Download document
        try:
            pdf_path = self.download_document(claim)
        except ExpiredDownloadUrlError as exp_err:
            logger.error("Download URL expired for job '%s': %s", claim.job_id, exp_err)
            self.status_sync.record_status(
                job_id=claim.job_id,
                attempt_id=claim.attempt_id,
                status="failed",
                error_message=f"Download URL expired: {exp_err}",
            )
            self.temp_mgr.cleanup_job_files(claim.job_id)
            return None

        except (PartialDownloadError, ChecksumMismatchError) as corrupt_err:
            logger.error("Corrupted/partial document for job '%s': %s", claim.job_id, corrupt_err)
            self.status_sync.record_status(
                job_id=claim.job_id,
                attempt_id=claim.attempt_id,
                status="failed",
                error_message=f"Document corrupted or partial: {corrupt_err}",
            )
            self.temp_mgr.cleanup_job_files(claim.job_id)
            return None

        except Exception as dl_err:
            logger.error("Unexpected download error for job '%s': %s", claim.job_id, dl_err)
            self.status_sync.record_status(
                job_id=claim.job_id,
                attempt_id=claim.attempt_id,
                status="failed",
                error_message=f"Download failed: {dl_err}",
            )
            self.temp_mgr.cleanup_job_files(claim.job_id)
            return None

        # 3. Settings translation
        print_settings = map_claim_settings_to_print_settings(claim.settings)
        printer_name = claim.settings.get("printer_name") or self.default_printer

        job_item = JobItem(
            job_id=claim.job_id,
            attempt_id=claim.attempt_id,
            printer_name=printer_name,
            pdf_path=pdf_path,
            settings=print_settings,
            lease_token=claim.lease_id,
            shop_id=self.dispatcher.shop_id,
            job_title=f"CAPS Job {claim.job_id[:8]}",
        )

        # 4. Enqueue into per-printer serialized dispatcher
        try:
            sm = self.dispatcher.enqueue_job(job_item)
            logger.info("Enqueued job '%s' to printer '%s'", claim.job_id, printer_name)
            return sm
        except Exception as enq_err:
            logger.error("Failed to enqueue job '%s' to dispatcher: %s", claim.job_id, enq_err)
            self.status_sync.record_status(
                job_id=claim.job_id,
                attempt_id=claim.attempt_id,
                status="failed",
                error_message=f"Dispatcher enqueue failed: {enq_err}",
            )
            self.temp_mgr.cleanup_job_files(claim.job_id)
            return None
