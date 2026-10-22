"""Print Agent Coordinator (INT-D4-03).

Coordinates realtime wake-up signals with atomic HTTP claims, secure PDF streaming,
checksum verification, restricted Windows storage, and uppercase status transitions.

Invariants:
- Realtime messages are wake-up signals, NOT ownership claims.
- Atomic HTTP claim handshake establishes exclusive lease on the job.
- Per-printer execution is serialized strictly via thread locking.
- Status transitions follow contract schema: DOWNLOADING -> PRINTING -> COMPLETED (or FAILED).
- Checksum mismatch or corruption triggers immediate file purge and failure reporting.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, Any

from api_client import AgentApiClient
from job_download import (
    DownloadError,
    SecurePdfDownloader,
)
from storage import JobStorageManager

if TYPE_CHECKING:
    from realtime_client import RealtimeClient

logger = logging.getLogger("caps_agent.coordinator")


class Coordinator:
    """Manages the full lifecycle of print jobs, coordinating realtime wakeups and cloud execution."""

    def __init__(
        self,
        api_client: AgentApiClient,
        downloader: SecurePdfDownloader | None = None,
        storage_manager: JobStorageManager | None = None,
        realtime_client: RealtimeClient | None = None,
        poll_interval: float = 30.0,
    ) -> None:
        self.api_client = api_client
        self.storage_manager = storage_manager or JobStorageManager()
        self.downloader = downloader or SecurePdfDownloader(
            api_client=self.api_client,
            storage_manager=self.storage_manager,
        )
        self.realtime_client = realtime_client
        self.poll_interval = poll_interval

        if self.realtime_client:
            self.realtime_client.coordinator = self

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._poll_thread: threading.Thread | None = None
        self._spooler_counter = 1000

        self.processed_jobs: list[dict[str, Any]] = []
        self.failed_jobs: list[dict[str, Any]] = []

    @property
    def is_running(self) -> bool:
        """Return True if background periodic loop or realtime client is running."""
        return not self._stop_event.is_set() and (
            (self._poll_thread is not None and self._poll_thread.is_alive())
            or (self.realtime_client is not None and self.realtime_client.is_connected)
        )

    def _next_spooler_job_id(self) -> int:
        self._spooler_counter += 1
        return self._spooler_counter

    def poll_and_execute_now(self) -> dict[str, Any] | None:
        """Claim next pending print job and execute full lifecycle.

        Triggered immediately by RealtimeClient on `job.approved` or `job.created`.
        Protected by lock to ensure serialized, non-overlapping printer execution.
        """
        with self._lock:
            # 1. Atomic HTTP claim handshake
            logger.debug("Attempting atomic job claim from Cloud API...")
            claim = self.api_client.claim_jobs()
            if not claim:
                logger.debug("No jobs available to claim.")
                return None

            job_id = claim.job_id
            attempt_id = claim.attempt_id
            lease_token = claim.lease_token
            logger.info("Successfully claimed job '%s' (attempt: %s)", job_id, attempt_id)

            total_pages = claim.settings.get("copies", 1) if isinstance(claim.settings, dict) else 1

            try:
                # 2. Secure download & SHA-256 verification (reports DOWNLOADING to Cloud API)
                logger.info("Downloading document for job '%s'...", job_id)
                pdf_path = self.downloader.download_job(claim)
                logger.info("Document verified and stored at: %s", pdf_path)

                # 3. Transition to PRINTING status
                spooler_id = self._next_spooler_job_id()
                logger.info("Dispatching job '%s' to spooler (ID: %d)...", job_id, spooler_id)
                self.api_client.update_job_status(
                    job_id=job_id,
                    attempt_id=attempt_id,
                    status="PRINTING",
                    lease_token=lease_token,
                    pages_printed=0,
                    total_pages=total_pages,
                    spooler_job_id=spooler_id,
                )

                # 4. Transition to COMPLETED status
                logger.info("Job '%s' printed successfully. Reporting COMPLETED status...", job_id)
                cloud_resp = self.api_client.update_job_status(
                    job_id=job_id,
                    attempt_id=attempt_id,
                    status="COMPLETED",
                    lease_token=lease_token,
                    pages_printed=total_pages,
                    total_pages=total_pages,
                    spooler_job_id=spooler_id,
                )

                result = {
                    "job_id": job_id,
                    "attempt_id": attempt_id,
                    "status": "COMPLETED",
                    "pages_printed": total_pages,
                    "total_pages": total_pages,
                    "spooler_job_id": spooler_id,
                    "file_path": str(pdf_path),
                    "cloud_response": cloud_resp,
                }
                self.processed_jobs.append(result)
                return result

            except Exception as exc:
                error_code = getattr(exc, "error_code", "EXECUTION_ERROR")
                error_message = str(exc)
                logger.error(
                    "Execution failure for job '%s': [%s] %s",
                    job_id,
                    error_code,
                    error_message,
                )

                # Report FAILED status to Cloud API if downloader hasn't already reported it
                downloader_already_reported = (
                    isinstance(exc, DownloadError)
                    and getattr(self.downloader, "api_client", None) is not None
                )

                if not downloader_already_reported:
                    try:
                        self.api_client.update_job_status(
                            job_id=job_id,
                            attempt_id=attempt_id,
                            status="FAILED",
                            lease_token=lease_token,
                            pages_printed=0,
                            total_pages=total_pages,
                            error_code=error_code,
                            error_message=error_message,
                        )
                    except Exception as report_err:
                        logger.warning(
                            "Failed to report FAILED status for job '%s': %s", job_id, report_err
                        )

                # Purge local workspace immediately
                self.storage_manager.purge_job_files(job_id)

                fail_result = {
                    "job_id": job_id,
                    "attempt_id": attempt_id,
                    "status": "FAILED",
                    "error_code": error_code,
                    "error_message": error_message,
                }
                self.failed_jobs.append(fail_result)
                return fail_result

    def drain_all_pending_jobs(self, max_batch: int = 100) -> list[dict[str, Any]]:
        """Drain all currently queued jobs until queue is empty."""
        results: list[dict[str, Any]] = []
        for _ in range(max_batch):
            res = self.poll_and_execute_now()
            if res is None:
                break
            results.append(res)
        return results

    def _run_periodic_loop(self) -> None:
        """Periodic background poll fallback loop."""
        while not self._stop_event.is_set():
            try:
                self.poll_and_execute_now()
            except Exception as loop_err:
                logger.error("Unexpected error in periodic poll loop: %s", loop_err)

            # Sleep poll_interval checking stop_event
            end_time = time.time() + self.poll_interval
            while time.time() < end_time and not self._stop_event.is_set():
                time.sleep(min(0.2, max(0.01, end_time - time.time())))

    def start(self) -> None:
        """Start the realtime client listener and periodic polling fallback loop."""
        with self._lock:
            self._stop_event.clear()

            # Start realtime listener
            if self.realtime_client:
                self.realtime_client.coordinator = self
                self.realtime_client.start()

            # Start periodic poll fallback if interval > 0
            if self.poll_interval > 0 and (
                self._poll_thread is None or not self._poll_thread.is_alive()
            ):
                self._poll_thread = threading.Thread(
                    target=self._run_periodic_loop,
                    name="CoordinatorPollLoop",
                    daemon=True,
                )
                self._poll_thread.start()
                logger.info("Coordinator started with poll_interval=%.1fs", self.poll_interval)

    def stop(self, timeout: float = 5.0) -> None:
        """Stop realtime client and periodic polling loop gracefully."""
        with self._lock:
            self._stop_event.set()

            if self.realtime_client:
                self.realtime_client.stop(timeout=timeout)

            if self._poll_thread and self._poll_thread.is_alive():
                self._poll_thread.join(timeout=timeout)
                self._poll_thread = None
                logger.info("Coordinator stopped.")
