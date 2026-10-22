"""Per-printer execution dispatcher for CAPS Print Agent.

Serializes job execution strictly on a per-printer basis, provides queue backpressure,
job cancellation, state machine lifecycle tracking, durable SQLite journaling,
transient artifact cleanup, and enforces Non-Negotiable Policy #5
(no auto-reprint on ambiguous/unknown outcomes).
"""

from __future__ import annotations

import contextlib
import logging
import queue
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from caps_agent.jobs.state_machine import (
    JobState,
    JobStateMachine,
)
from caps_agent.printing.engine import (
    PrintEngine,
    PrintResult,
    PrintSettings,
    ShopAuthorizationError,
)

if TYPE_CHECKING:
    from caps_agent.storage.cleanup import ArtifactCleaner
    from caps_agent.storage.local_state import LocalStateJournal

logger = logging.getLogger("caps_agent.jobs.dispatcher")


# ==============================================================================
# Dispatcher Exceptions
# ==============================================================================


class DispatcherError(Exception):
    """Base exception for all dispatcher errors."""

    def __init__(self, message: str, error_code: str = "DISPATCHER_ERROR"):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class QueueBackpressureError(DispatcherError):
    """Raised when an enqueue attempt exceeds the printer queue's max capacity."""

    def __init__(self, printer_name: str, capacity: int):
        msg = (
            f"Backpressure rejection: Queue for printer '{printer_name}' "
            f"has reached maximum capacity ({capacity})."
        )
        super().__init__(msg, error_code="QUEUE_BACKPRESSURE_FULL")
        self.printer_name = printer_name
        self.capacity = capacity


class DispatcherStoppedError(DispatcherError):
    """Raised when attempting to enqueue to a stopped or shutting down dispatcher."""

    def __init__(self) -> None:
        super().__init__(
            "Dispatcher is stopped and cannot accept new jobs.",
            error_code="DISPATCHER_STOPPED",
        )


class DuplicateJobError(DispatcherError):
    """Raised when a job with identical attempt ID or active job ID is rejected."""

    def __init__(self, identifier: str):
        super().__init__(
            f"Job '{identifier}' is already registered or executing.",
            error_code="DUPLICATE_JOB",
        )


# ==============================================================================
# Job Item Model
# ==============================================================================


@dataclass
class JobItem:
    """Represents a discrete print job ready for per-printer dispatch."""

    job_id: str
    attempt_id: str
    printer_name: str
    pdf_path: Path | str
    settings: PrintSettings
    lease_token: str
    shop_id: str | None = None
    job_title: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def __post_init__(self) -> None:
        if isinstance(self.pdf_path, str):
            self.pdf_path = Path(self.pdf_path)


# ==============================================================================
# Job Dispatcher
# ==============================================================================


class JobDispatcher:
    """Orchestrates per-printer serialized execution queues.

    Guarantees:
    - Exactly one job executes per printer at any given time (concurrency = 1 per printer)
    - Independent printers execute concurrently in parallel
    - Strict FIFO order per printer
    - Queue backpressure with configurable bounds
    - Safe cancellation of queued and in-progress jobs
    - Full audit state machine tracking
    - Optional SQLite journal persistence and artifact cleanup
    """

    def __init__(
        self,
        engine: PrintEngine,
        max_queue_per_printer: int = 10,
        status_callback: Callable[[JobStateMachine, JobState], None] | None = None,
        shop_id: str | None = None,
        journal: LocalStateJournal | None = None,
        cleaner: ArtifactCleaner | None = None,
    ) -> None:
        self.engine = engine
        self.max_queue_per_printer = max_queue_per_printer
        self.status_callback = status_callback
        self.shop_id = shop_id
        self.journal = journal
        self.cleaner = cleaner

        # Concurrency and queue structures
        self._lock = threading.RLock()
        self._printer_queues: dict[str, queue.Queue[JobItem | None]] = {}
        self._printer_workers: dict[str, threading.Thread] = {}
        self._active_jobs: dict[str, JobItem] = {}  # printer_name -> currently executing JobItem
        self._state_machines: dict[str, JobStateMachine] = {}  # job_id -> state machine
        self._jobs_by_attempt: dict[str, str] = {}  # attempt_id -> job_id
        self._cancelled_jobs: set[str] = set()
        self._results: dict[str, PrintResult] = {}  # job_id -> result
        self._stopped = False
        self._status_listeners: list[Callable[[JobStateMachine, JobState], None]] = []
        if status_callback is not None:
            self._status_listeners.append(status_callback)

    def add_status_listener(self, listener: Callable[[JobStateMachine, JobState], None]) -> None:
        """Register a status transition listener callback."""
        with self._lock:
            if listener not in self._status_listeners:
                self._status_listeners.append(listener)

    def remove_status_listener(self, listener: Callable[[JobStateMachine, JobState], None]) -> None:
        """Unregister a status transition listener callback."""
        with self._lock:
            if listener in self._status_listeners:
                self._status_listeners.remove(listener)

    @property
    def is_stopped(self) -> bool:
        return self._stopped

    def _notify_status(self, sm: JobStateMachine) -> None:
        """Deliver status update to listener hooks if configured."""
        with self._lock:
            listeners = list(self._status_listeners)

        for listener in listeners:
            try:
                listener(sm, sm.current_state)
            except Exception as err:
                logger.error("Error in status_listener for job '%s': %s", sm.job_id, err)

    def _update_journal(
        self,
        attempt_id: str,
        status: JobState,
        reason: str | None = None,
        error_code: str | None = None,
    ) -> None:
        """Update status in durable SQLite journal if configured."""
        if self.journal is not None:
            try:
                self.journal.update_status(attempt_id, status, reason=reason, error_code=error_code)
            except Exception as err:
                logger.warning(
                    "Failed to record status update in local journal for attempt '%s': %s",
                    attempt_id,
                    err,
                )

    def _ensure_printer_queue(self, printer_name: str) -> queue.Queue[JobItem | None]:
        """Ensure a dedicated queue and background worker exist for the printer."""
        with self._lock:
            if printer_name not in self._printer_queues:
                q: queue.Queue[JobItem | None] = queue.Queue(maxsize=self.max_queue_per_printer)
                self._printer_queues[printer_name] = q

                worker = threading.Thread(
                    target=self._worker_loop,
                    args=(printer_name, q),
                    name=f"PrinterWorker-{printer_name}",
                    daemon=True,
                )
                self._printer_workers[printer_name] = worker
                worker.start()
                logger.debug("Spawned dedicated worker thread for printer '%s'", printer_name)

            return self._printer_queues[printer_name]

    def enqueue_job(self, job: JobItem) -> JobStateMachine:
        """Enqueue a print job into the target printer's serialized queue.

        Raises:
            DispatcherStoppedError: If dispatcher has been shut down.
            ShopAuthorizationError: If job shop_id does not match agent shop_id.
            QueueBackpressureError: If target printer queue exceeds capacity.
            DuplicateJobError: If job is currently active or enqueued.
        """
        with self._lock:
            if self._stopped:
                raise DispatcherStoppedError()

            # 1. Shop / Tenant Authorization
            if self.shop_id and job.shop_id and self.shop_id != job.shop_id:
                raise ShopAuthorizationError(
                    f"Shop authorization mismatch: Dispatcher assigned to '{self.shop_id}', "
                    f"job submitted for '{job.shop_id}'.",
                    details={"dispatcher_shop_id": self.shop_id, "job_shop_id": job.shop_id},
                )

            # 2. Idempotency & Duplicate Check
            if job.attempt_id in self._jobs_by_attempt:
                existing_job_id = self._jobs_by_attempt[job.attempt_id]
                existing_sm = self._state_machines.get(existing_job_id)
                if existing_sm:
                    logger.warning(
                        "Duplicate attempt '%s' already registered (job '%s'). Returning existing state machine.",
                        job.attempt_id,
                        existing_job_id,
                    )
                    return existing_sm

            if job.job_id in self._state_machines:
                existing_sm = self._state_machines[job.job_id]
                if not existing_sm.is_terminal:
                    raise DuplicateJobError(job.job_id)

            # 3. Initialize State Machine
            sm = JobStateMachine(
                job_id=job.job_id, attempt_id=job.attempt_id, initial_state=JobState.QUEUED
            )
            self._state_machines[job.job_id] = sm
            self._jobs_by_attempt[job.attempt_id] = job.job_id

        # 4. Record into persistent journal if configured
        if self.journal is not None:
            try:
                self.journal.record_claim(
                    job_id=job.job_id,
                    attempt_id=job.attempt_id,
                    printer_name=job.printer_name,
                    lease_token=job.lease_token,
                    shop_id=job.shop_id,
                    pdf_path=job.pdf_path,
                    job_title=job.job_title,
                    initial_status=JobState.QUEUED,
                )
            except Exception as err:
                logger.warning(
                    "Failed to record claim in local journal for job '%s': %s", job.job_id, err
                )

        # 5. Check Queue Backpressure & Put in Queue
        q = self._ensure_printer_queue(job.printer_name)
        try:
            q.put_nowait(job)
        except queue.Full:
            with self._lock:
                sm.transition_to(
                    JobState.FAILED,
                    reason="Queue backpressure full",
                    error_code="QUEUE_BACKPRESSURE_FULL",
                )
                self._update_journal(
                    job.attempt_id,
                    JobState.FAILED,
                    reason="Queue backpressure full",
                    error_code="QUEUE_BACKPRESSURE_FULL",
                )
                self._notify_status(sm)
            raise QueueBackpressureError(job.printer_name, self.max_queue_per_printer) from None

        self._notify_status(sm)
        logger.info(
            "Job '%s' (attempt '%s') enqueued for printer '%s' (queue depth: %d)",
            job.job_id,
            job.attempt_id,
            job.printer_name,
            q.qsize(),
        )
        return sm

    def cancel_job(self, job_id: str, reason: str = "Cancelled by operator") -> bool:
        """Cancel a pending or active job.

        Returns True if the job was successfully marked cancelled or already terminal.
        """
        with self._lock:
            sm = self._state_machines.get(job_id)
            if not sm:
                return False

            if sm.is_terminal:
                return False

            self._cancelled_jobs.add(job_id)

            # If still queued, transition immediately
            if sm.current_state in (JobState.QUEUED, JobState.CLAIMED):
                sm.transition_to(JobState.CANCELLED, reason=reason)
                self._update_journal(sm.attempt_id, JobState.CANCELLED, reason=reason)
                self._notify_status(sm)
                return True

            # If already executing, flag is set and will be honored before/after spooler call
            return True

    def get_state_machine(self, job_id: str) -> JobStateMachine | None:
        """Return the JobStateMachine for the specified job_id."""
        with self._lock:
            return self._state_machines.get(job_id)

    def get_job_state(self, job_id: str) -> JobState | None:
        """Return current JobState for a job, or None if unknown."""
        with self._lock:
            sm = self._state_machines.get(job_id)
            return sm.current_state if sm else None

    def get_print_result(self, job_id: str) -> PrintResult | None:
        """Return final PrintResult if job has executed."""
        with self._lock:
            return self._results.get(job_id)

    def is_printer_busy(self, printer_name: str) -> bool:
        """Return True if the printer has an actively running or queued job."""
        with self._lock:
            if printer_name in self._active_jobs:
                return True
            q = self._printer_queues.get(printer_name)
            return bool(q and not q.empty())

    def get_active_job(self, printer_name: str) -> JobItem | None:
        """Return the currently executing job for the specified printer."""
        with self._lock:
            return self._active_jobs.get(printer_name)

    def wait_for_job(self, job_id: str, timeout: float | None = 10.0) -> JobState:
        """Block until the specified job reaches a terminal state, or timeout expires."""
        start = datetime.now(UTC)
        while True:
            with self._lock:
                sm = self._state_machines.get(job_id)
                is_active = any(active.job_id == job_id for active in self._active_jobs.values())
                if sm and sm.is_terminal and not is_active:
                    return sm.current_state

            if timeout is not None:
                elapsed = (datetime.now(UTC) - start).total_seconds()
                if elapsed >= timeout:
                    with self._lock:
                        sm = self._state_machines.get(job_id)
                        return sm.current_state if sm else JobState.FAILED

            threading.Event().wait(0.05)

    def wait_all(self, timeout: float | None = 15.0) -> None:
        """Wait until all printer queues are drained and active jobs completed."""
        start = datetime.now(UTC)
        while True:
            with self._lock:
                all_done = True
                if self._active_jobs:
                    all_done = False
                for q in self._printer_queues.values():
                    if not q.empty():
                        all_done = False
                        break
                if all_done:
                    return

            if timeout is not None:
                elapsed = (datetime.now(UTC) - start).total_seconds()
                if elapsed >= timeout:
                    return

            threading.Event().wait(0.05)

    def _worker_loop(self, printer_name: str, q: queue.Queue[JobItem | None]) -> None:
        """Per-printer serialized execution loop running on a dedicated thread."""
        while not self._stopped:
            try:
                job = q.get(timeout=0.2)
            except queue.Empty:
                continue

            if job is None:
                # Sentinel to cleanly terminate thread
                q.task_done()
                break

            # 1. Check if cancelled while waiting in queue
            with self._lock:
                if job.job_id in self._cancelled_jobs:
                    sm = self._state_machines.get(job.job_id)
                    if sm and not sm.is_terminal:
                        sm.transition_to(
                            JobState.CANCELLED, reason="Cancelled in queue before execution"
                        )
                        self._update_journal(
                            job.attempt_id, JobState.CANCELLED, reason="Cancelled in queue"
                        )
                        self._notify_status(sm)
                    q.task_done()
                    continue

                self._active_jobs[printer_name] = job

            # 2. Execute job under per-printer serialization
            try:
                self._execute_job(job)
            finally:
                with self._lock:
                    self._active_jobs.pop(printer_name, None)
                q.task_done()

    def _execute_job(self, job: JobItem) -> None:
        """Coordinate lifecycle state transitions and execute PrintEngine print_document."""
        sm = self._state_machines[job.job_id]
        cleanup_done = False

        def _do_cleanup() -> None:
            nonlocal cleanup_done
            if not cleanup_done and self.cleaner is not None:
                cleanup_done = True
                try:
                    self.cleaner.cleanup_job(job.job_id)
                except Exception as c_err:
                    logger.warning(
                        "Post-execution artifact cleanup error for job '%s': %s", job.job_id, c_err
                    )

        try:
            # Transition: QUEUED -> CLAIMED
            sm.transition_to(JobState.CLAIMED)
            self._update_journal(job.attempt_id, JobState.CLAIMED)
            self._notify_status(sm)

            if job.job_id in self._cancelled_jobs:
                sm.transition_to(JobState.CANCELLED, reason="Cancelled after claim")
                self._update_journal(
                    job.attempt_id, JobState.CANCELLED, reason="Cancelled after claim"
                )
                self._notify_status(sm)
                return

            # Transition: CLAIMED -> DOWNLOADING
            sm.transition_to(JobState.DOWNLOADING)
            self._update_journal(job.attempt_id, JobState.DOWNLOADING)
            self._notify_status(sm)

            # Transition: DOWNLOADING -> VALIDATING
            sm.transition_to(JobState.VALIDATING)
            self._update_journal(job.attempt_id, JobState.VALIDATING)
            self._notify_status(sm)

            if job.job_id in self._cancelled_jobs:
                sm.transition_to(JobState.CANCELLED, reason="Cancelled during validation")
                self._update_journal(
                    job.attempt_id, JobState.CANCELLED, reason="Cancelled during validation"
                )
                self._notify_status(sm)
                return

            # Transition: VALIDATING -> RENDERING
            sm.transition_to(JobState.RENDERING)
            self._update_journal(job.attempt_id, JobState.RENDERING)
            self._notify_status(sm)

            # Transition: RENDERING -> PRINTING
            sm.transition_to(JobState.PRINTING)
            self._update_journal(job.attempt_id, JobState.PRINTING)
            self._notify_status(sm)

            # Execute print work via engine
            title = job.job_title or f"CAPS Print {job.job_id}"
            result = self.engine.print_document(
                pdf_path=job.pdf_path,
                printer_name=job.printer_name,
                settings=job.settings,
                job_title=title,
                attempt_id=job.attempt_id,
                shop_id=job.shop_id,
            )

            with self._lock:
                self._results[job.job_id] = result

            if result.spooler_job_id and self.journal is not None:
                try:
                    self.journal.record_spooler_submission(
                        attempt_id=job.attempt_id,
                        spooler_job_id=result.spooler_job_id,
                        pages_submitted=result.pages_submitted,
                        total_bytes_written=result.total_bytes_written,
                    )
                except Exception as err:
                    logger.warning("Failed to record spooler submission in journal: %s", err)

            if result.accepted:
                sm.transition_to(
                    JobState.COMPLETED,
                    reason="Spooler submission succeeded",
                    details={
                        "spooler_job_id": result.spooler_job_id,
                        "pages_submitted": result.pages_submitted,
                        "total_bytes_written": result.total_bytes_written,
                    },
                )
                if self.journal is not None:
                    try:
                        self.journal.record_completion(
                            job.attempt_id,
                            details={"spooler_job_id": result.spooler_job_id},
                        )
                    except Exception as err:
                        logger.warning("Failed to record completion in journal: %s", err)
            else:
                # Disambiguate error vs unknown/ambiguous
                err_code = result.error_code or "SUBMISSION_FAILED"
                if err_code in ("UNKNOWN", "UNKNOWN_DISAPPEARED", "SPOOLER_TIMEOUT"):
                    # Non-Negotiable Policy #5: Ambiguous outcomes require manual inspection, NO auto-reprint
                    sm.transition_to(
                        JobState.UNKNOWN_REQUIRES_REVIEW,
                        reason=result.error
                        or "Ambiguous spooler outcome; manual inspection required",
                        error_code=err_code,
                    )
                    if self.journal is not None:
                        try:
                            self.journal.record_unknown_requires_review(
                                job.attempt_id,
                                error_code=err_code,
                                reason=result.error or "Ambiguous spooler outcome",
                            )
                        except Exception as err:
                            logger.warning("Failed to record unknown outcome in journal: %s", err)
                else:
                    sm.transition_to(
                        JobState.FAILED,
                        reason=result.error or "Print submission failed",
                        error_code=err_code,
                    )
                    if self.journal is not None:
                        try:
                            self.journal.record_failure(
                                job.attempt_id,
                                error_code=err_code,
                                error_message=result.error or "Print submission failed",
                            )
                        except Exception as err:
                            logger.warning("Failed to record failure in journal: %s", err)

            _do_cleanup()
            self._notify_status(sm)

        except Exception as err:
            logger.error("Unexpected error executing job '%s': %s", job.job_id, err, exc_info=True)
            err_code = getattr(err, "error_code", "UNEXPECTED_ERROR")
            if not sm.is_terminal:
                sm.transition_to(
                    JobState.FAILED,
                    reason=str(err),
                    error_code=err_code,
                )
                if self.journal is not None:
                    try:
                        self.journal.record_failure(
                            job.attempt_id,
                            error_code=err_code,
                            error_message=str(err),
                        )
                    except Exception as j_err:
                        logger.warning("Failed to record failure in journal: %s", j_err)
                _do_cleanup()
                self._notify_status(sm)

        finally:
            _do_cleanup()

    def shutdown(self, wait: bool = True, timeout: float = 5.0) -> None:
        """Stop dispatcher, send poison pill sentinels to workers, and join threads."""
        with self._lock:
            if self._stopped:
                return
            self._stopped = True

        # Send poison pills to all queues
        for q in self._printer_queues.values():
            with contextlib.suppress(queue.Full):
                q.put_nowait(None)

        if wait:
            for worker in self._printer_workers.values():
                worker.join(timeout=timeout)

        logger.info("JobDispatcher shut down cleanly.")
