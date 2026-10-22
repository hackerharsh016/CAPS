"""Startup crash recovery and spooler reconciliation coordinator for CAPS Print Agent.

Inspects the durable local SQLite journal upon agent startup to identify interrupted,
in-flight print jobs following an unexpected shutdown or crash. Reconciles state against
the Windows Print Spooler and enforces Non-Negotiable Policy #5:
- Spooler submission does not prove physical paper completion
- Ambiguous/unconfirmed outcomes transition to UNKNOWN_REQUIRES_REVIEW
- Under NO circumstances does the agent blindly auto-reprint
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from caps_agent.jobs.state_machine import JobState
from caps_agent.printing.spooler_monitor import (
    JOB_STATUS_COMPLETE,
    JOB_STATUS_PRINTED,
    PyWin32JobQueryAdapter,
    Win32JobQueryAdapter,
)
from caps_agent.storage.cleanup import ArtifactCleaner, CleanupReport
from caps_agent.storage.local_state import LocalStateJournal

logger = logging.getLogger("caps_agent.jobs.recovery")


@dataclass(frozen=True)
class ReconciledJob:
    """Outcome of reconciling a single interrupted job attempt on startup."""

    job_id: str
    attempt_id: str
    printer_name: str
    previous_status: str
    new_status: str
    reason: str
    spooler_job_id: int | None = None
    requires_review: bool = False
    can_auto_reprint: bool = False  # Strictly False (Policy #5)

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "attempt_id": self.attempt_id,
            "printer_name": self.printer_name,
            "previous_status": self.previous_status,
            "new_status": self.new_status,
            "reason": self.reason,
            "spooler_job_id": self.spooler_job_id,
            "requires_review": self.requires_review,
            "can_auto_reprint": self.can_auto_reprint,
        }


@dataclass
class RecoveryReport:
    """Consolidated summary of startup reconciliation and orphan cleanup."""

    reconciled_jobs: list[ReconciledJob] = field(default_factory=list)
    cleanup_report: CleanupReport = field(default_factory=CleanupReport)
    total_interrupted: int = 0
    requires_manual_review_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "reconciled_jobs": [j.to_dict() for j in self.reconciled_jobs],
            "cleanup_report": self.cleanup_report.to_dict(),
            "total_interrupted": self.total_interrupted,
            "requires_manual_review_count": self.requires_manual_review_count,
        }


class StartupRecoveryCoordinator:
    """Orchestrates crash recovery reconciliation and temp artifact scrubbing."""

    def __init__(
        self,
        journal: LocalStateJournal,
        query_adapter: Win32JobQueryAdapter | None = None,
        cleaner: ArtifactCleaner | None = None,
    ) -> None:
        self.journal = journal
        self.query_adapter = (
            query_adapter if query_adapter is not None else PyWin32JobQueryAdapter()
        )
        self.cleaner = cleaner or ArtifactCleaner()

    def reconcile_startup(
        self,
        max_orphan_age_seconds: float = 3600.0,
    ) -> RecoveryReport:
        """Execute full startup recovery sequence:

        1. Query journal for all active, non-terminal job attempts.
        2. Reconcile each interrupted attempt against Windows Spooler.
        3. Transition interrupted jobs to UNKNOWN_REQUIRES_REVIEW or FAILED.
        4. Enforce can_auto_reprint=False strictly.
        5. Clean up residual temp files and orphaned artifacts.
        """
        logger.info("Starting startup crash recovery reconciliation...")
        active_attempts = self.journal.get_active_attempts()
        report = RecoveryReport(total_interrupted=len(active_attempts))

        active_job_ids: set[str] = set()

        for attempt in active_attempts:
            reconciled = self._reconcile_single_attempt(attempt)
            report.reconciled_jobs.append(reconciled)
            if reconciled.requires_review:
                report.requires_manual_review_count += 1

            # Clean up residual files associated with this interrupted job
            if self.cleaner:
                try:
                    job_cleanup = self.cleaner.cleanup_job(attempt.job_id)
                    report.cleanup_report.merge(job_cleanup)
                except Exception as err:
                    logger.warning("Cleanup error for reconciled job '%s': %s", attempt.job_id, err)

        # Run orphan cleanup for unreferenced artifacts older than max_orphan_age_seconds
        if self.cleaner:
            try:
                orphan_cleanup = self.cleaner.cleanup_orphans(
                    max_age_seconds=max_orphan_age_seconds,
                    exclude_active_job_ids=active_job_ids,
                )
                report.cleanup_report.merge(orphan_cleanup)
            except Exception as err:
                logger.warning("Error running orphan cleanup during startup recovery: %s", err)

        logger.info(
            "Startup recovery complete: %d interrupted attempts reconciled (%d require review, %d files scrubbed).",
            report.total_interrupted,
            report.requires_manual_review_count,
            report.cleanup_report.files_deleted,
        )
        return report

    def _reconcile_single_attempt(self, attempt: Any) -> ReconciledJob:
        """Inspect and reconcile a single interrupted attempt."""
        job_id = attempt.job_id
        attempt_id = attempt.attempt_id
        prev_status = attempt.status
        printer_name = attempt.printer_name
        spooler_id = attempt.spooler_job_id

        logger.warning(
            "Reconciling interrupted job '%s' (attempt '%s', status: %s, spooler_id: %s)",
            job_id,
            attempt_id,
            prev_status,
            spooler_id,
        )

        # Case 1: Interrupted during or after spooler submission (status is PRINTING with spooler_job_id)
        if prev_status == JobState.PRINTING.value and spooler_id is not None:
            job_info = None
            try:
                job_info = self.query_adapter.get_job(printer_name, spooler_id)
            except Exception as q_err:
                logger.warning(
                    "Spooler query failed for printer '%s', job %d: %s",
                    printer_name,
                    spooler_id,
                    q_err,
                )

            if job_info is not None:
                status_flags = job_info.get("Status", 0)
                if status_flags & (JOB_STATUS_COMPLETE | JOB_STATUS_PRINTED):
                    # Spooler confirmed completion before/during crash
                    self.journal.record_completion(
                        attempt_id,
                        details={"reconciled_from_spooler": True, "raw_status": status_flags},
                    )
                    return ReconciledJob(
                        job_id=job_id,
                        attempt_id=attempt_id,
                        printer_name=printer_name,
                        previous_status=prev_status,
                        new_status=JobState.COMPLETED.value,
                        reason="Confirmed completed by Windows Spooler on startup inspection",
                        spooler_job_id=spooler_id,
                        requires_review=False,
                        can_auto_reprint=False,
                    )

            # If spooler job is gone or still unconfirmed:
            # Policy #5: Spooler job disappeared after restart; physical completion is unverified.
            # MUST transition to UNKNOWN_REQUIRES_REVIEW with can_auto_reprint=False.
            reason = (
                "Agent restarted while print was in-flight. Spooler job outcome cannot be physically verified. "
                "Non-Negotiable Policy #5 prohibits auto-reprint."
            )
            self.journal.record_unknown_requires_review(
                attempt_id=attempt_id,
                error_code="CRASH_RECOVERY_UNKNOWN_OUTCOME",
                reason=reason,
                details={"spooler_job_id": spooler_id, "printer_name": printer_name},
            )
            return ReconciledJob(
                job_id=job_id,
                attempt_id=attempt_id,
                printer_name=printer_name,
                previous_status=prev_status,
                new_status=JobState.UNKNOWN_REQUIRES_REVIEW.value,
                reason=reason,
                spooler_job_id=spooler_id,
                requires_review=True,
                can_auto_reprint=False,
            )

        # Case 2: Interrupted BEFORE submission to Windows Spooler
        # (e.g. QUEUED, CLAIMED, DOWNLOADING, VALIDATING, RENDERING)
        # Job was never submitted to spooler, so physical printing never commenced.
        reason = (
            f"Agent process terminated while job was in state '{prev_status}' before spooler submission. "
            "Marked FAILED on restart; cloud lease expired."
        )
        self.journal.record_failure(
            attempt_id=attempt_id,
            error_code="AGENT_CRASH_BEFORE_SPOOLER",
            error_message=reason,
            details={"previous_status": prev_status},
        )
        return ReconciledJob(
            job_id=job_id,
            attempt_id=attempt_id,
            printer_name=printer_name,
            previous_status=prev_status,
            new_status=JobState.FAILED.value,
            reason=reason,
            spooler_job_id=None,
            requires_review=False,
            can_auto_reprint=False,
        )
