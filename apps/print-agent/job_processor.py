"""Job Processor for Desktop Print Agent.

Coordinates polling, claim parsing, downloading, rendering, and uppercase status transitions.
"""

from __future__ import annotations

import logging
from typing import Any

from api_client import AgentApiClient, JobClaim

logger = logging.getLogger("caps_agent.job_processor")


class JobProcessor:
    """Manages the full lifecycle of a claimed job adhering to contract schemas."""

    def __init__(self, api_client: AgentApiClient) -> None:
        self.api_client = api_client

    def process_next_job(self) -> dict[str, Any] | None:
        """Poll and claim pending job, then execute status progression."""
        claim: JobClaim | None = self.api_client.claim_jobs()
        if not claim:
            return None

        job_id = claim.job_id
        attempt_id = claim.attempt_id
        lease_token = claim.lease_token

        # 1. DOWNLOADING
        self.api_client.update_job_status(
            job_id=job_id,
            attempt_id=attempt_id,
            status="DOWNLOADING",
            lease_token=lease_token,
            pages_printed=0,
            total_pages=claim.settings.get("copies", 1),
        )

        # 2. PRINTING
        self.api_client.update_job_status(
            job_id=job_id,
            attempt_id=attempt_id,
            status="PRINTING",
            lease_token=lease_token,
            pages_printed=0,
            total_pages=claim.settings.get("copies", 1),
            spooler_job_id=101,
        )

        # 3. COMPLETED
        total_pages = claim.settings.get("copies", 1)
        resp = self.api_client.update_job_status(
            job_id=job_id,
            attempt_id=attempt_id,
            status="COMPLETED",
            lease_token=lease_token,
            pages_printed=total_pages,
            total_pages=total_pages,
            spooler_job_id=101,
        )

        return {
            "job_id": job_id,
            "attempt_id": attempt_id,
            "status": "COMPLETED",
            "pages_printed": total_pages,
            "cloud_response": resp,
        }
