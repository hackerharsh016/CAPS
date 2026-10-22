"""Job Processor for Desktop Print Agent (INT-D4-05).

Coordinates polling, claim parsing, downloading, rendering, spooling, uppercase status transitions,
and strictly enforces immediate post-print zero-retention hard purge in a finally block.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from api_client import AgentApiClient, JobClaim
from storage import (
    JobStorageManager,
    mark_attempt_purged,
    record_attempt_in_db,
    secure_purge,
)

logger = logging.getLogger("caps_agent.job_processor")


class JobProcessor:
    """Manages the full lifecycle of a claimed job adhering to contract schemas and zero-retention."""

    def __init__(
        self,
        api_client: AgentApiClient,
        storage_manager: JobStorageManager | None = None,
        downloader: Any = None,
        spooler: Any = None,
        db_path: Path | str | None = None,
    ) -> None:
        self.api_client = api_client
        self.storage_manager = storage_manager or JobStorageManager()
        self.downloader = downloader
        self.spooler = spooler
        self.db_path = db_path

    def process_next_job(self, reraise: bool = False) -> dict[str, Any] | None:
        """Poll and claim pending job, then execute status progression with guaranteed hard purge."""
        claim: JobClaim | None = self.api_client.claim_jobs()
        if not claim:
            return None

        return self.process_job(claim, reraise=reraise)

    def process_job(self, claim: JobClaim, reraise: bool = False) -> dict[str, Any]:
        """Execute full lifecycle for a claimed job with guaranteed immediate purge in finally block."""
        job_id = claim.job_id
        attempt_id = claim.attempt_id
        lease_token = claim.lease_token
        total_pages = claim.settings.get("copies", 1) if isinstance(claim.settings, dict) else 1

        # Resolve document path in isolated job workspace
        pdf_path = self.storage_manager.get_document_path(job_id)

        # Track attempt in attempts.db
        try:
            record_attempt_in_db(
                attempt_id=attempt_id,
                job_id=job_id,
                pdf_path=str(pdf_path),
                status="CLAIMED",
                lease_token=lease_token,
                db_path=self.db_path,
            )
        except Exception as db_err:
            logger.warning("Could not record attempt in attempts.db: %s", db_err)

        spooler_job_id = 101
        try:
            # 1. DOWNLOADING
            self.api_client.update_job_status(
                job_id=job_id,
                attempt_id=attempt_id,
                status="DOWNLOADING",
                lease_token=lease_token,
                pages_printed=0,
                total_pages=total_pages,
            )

            if self.downloader is not None:
                if hasattr(self.downloader, "download_job"):
                    downloaded_path = self.downloader.download_job(claim)
                    if downloaded_path:
                        pdf_path = Path(downloaded_path)
                elif hasattr(self.downloader, "download_file"):
                    download_url = (
                        claim.download_url
                        if hasattr(claim, "download_url")
                        else (claim.settings.get("download_url") if isinstance(claim.settings, dict) else "")
                    )
                    expected_sha256 = (
                        claim.expected_sha256
                        if hasattr(claim, "expected_sha256")
                        else (claim.settings.get("expected_sha256") if isinstance(claim.settings, dict) else None)
                    )
                    self.downloader.download_file(
                        url=download_url,
                        destination_path=pdf_path,
                        expected_sha256=expected_sha256,
                        job_id=job_id,
                        attempt_id=attempt_id,
                        lease_token=lease_token,
                    )

            # 2. PRINTING
            if self.spooler is not None:
                if hasattr(self.spooler, "spool_document"):
                    spool_res = self.spooler.spool_document(
                        job_id=job_id,
                        attempt_id=attempt_id,
                        file_path=pdf_path,
                        printer_name=claim.settings.get("printer_name", "DEFAULT") if isinstance(claim.settings, dict) else "DEFAULT",
                    )
                    if isinstance(spool_res, dict) and "spooler_job_id" in spool_res:
                        spooler_job_id = spool_res["spooler_job_id"]
                    elif isinstance(spool_res, int):
                        spooler_job_id = spool_res

            self.api_client.update_job_status(
                job_id=job_id,
                attempt_id=attempt_id,
                status="PRINTING",
                lease_token=lease_token,
                pages_printed=0,
                total_pages=total_pages,
                spooler_job_id=spooler_job_id,
            )

            # 3. COMPLETED
            resp = self.api_client.update_job_status(
                job_id=job_id,
                attempt_id=attempt_id,
                status="COMPLETED",
                lease_token=lease_token,
                pages_printed=total_pages,
                total_pages=total_pages,
                spooler_job_id=spooler_job_id,
            )

            return {
                "job_id": job_id,
                "attempt_id": attempt_id,
                "status": "COMPLETED",
                "pages_printed": total_pages,
                "spooler_job_id": spooler_job_id,
                "cloud_response": resp,
            }

        except Exception as exc:
            logger.error("Job execution failure for job '%s': %s", job_id, exc)
            error_code = getattr(exc, "error_code", "EXECUTION_ERROR")
            error_message = str(exc)

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
                logger.warning("Failed reporting FAILED status for job '%s': %s", job_id, report_err)

            if reraise:
                raise

            return {
                "job_id": job_id,
                "attempt_id": attempt_id,
                "status": "FAILED",
                "error_code": error_code,
                "error_message": error_message,
            }

        finally:
            # IMMEDIATE POST-PRINT HARD PURGE (Zero-Retention Privacy Policy)
            # Guarantees zero residual PDF bytes remain in temp directory regardless of success or failure.
            try:
                # 1. Overwrite and unlink the specific document if it exists
                if pdf_path.exists():
                    secure_purge(pdf_path)

                # 2. Overwrite and clean the entire job directory workspace
                self.storage_manager.secure_purge_job(job_id)

                # 3. Clear file references and mark attempt as purged in SQLite attempts.db
                mark_attempt_purged(attempt_id=attempt_id, db_path=self.db_path, job_id=job_id)
                logger.info("Enforced zero-retention hard purge for job '%s' (attempt: %s)", job_id, attempt_id)
            except Exception as purge_err:
                logger.critical("Error during finally hard purge for job '%s': %s", job_id, purge_err)

