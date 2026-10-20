"""Durable attempt status synchronization and offline retry journal.

Ensures reliable reporting of print attempt states to the CAPS Cloud API:
- Conforms strictly to JobStatusUpdateRequestSchema
- Distinguishes accepted, submitted (printing), physical completed, and review-required states
- Durable SQLite retry journal for offline / network outage resilience
- Automatic background flush with chronological sequence preservation
- Idempotent deduplication of redundant status updates
- Policy #5: Spooler submission does NOT equal completion; unknown outcomes marked 'requires_review'
"""

from __future__ import annotations

import contextlib
import logging
import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from caps_agent.cloud.api_client import CloudApiClient, CloudApiError

if TYPE_CHECKING:
    from caps_agent.jobs.state_machine import JobState, JobStateMachine

logger = logging.getLogger("caps_agent.cloud.status_sync")

ALLOWED_STATUSES = ("downloading", "printing", "completed", "failed", "requires_review")


# ==============================================================================
# Domain Models & Exceptions
# ==============================================================================


class StatusSyncError(CloudApiError):
    """Base exception for status synchronization failures."""

    def __init__(self, message: str, error_code: str = "STATUS_SYNC_ERROR"):
        super().__init__(message, error_code=error_code)


@dataclass(frozen=True)
class StatusSyncItem:
    """Represents a discrete status update queued for cloud delivery."""

    id: int | None
    job_id: str
    attempt_id: str
    status: str
    spooler_job_id: int | None = None
    error_message: str | None = None
    created_at: str = ""
    retry_count: int = 0
    last_attempt_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert into a JSON payload conforming to JobStatusUpdateRequestSchema."""
        payload: dict[str, Any] = {
            "job_id": self.job_id,
            "attempt_id": self.attempt_id,
            "status": self.status,
        }
        if self.spooler_job_id is not None:
            payload["spooler_job_id"] = self.spooler_job_id
        if self.error_message:
            payload["error_message"] = self.error_message[:1000]
        return payload


# ==============================================================================
# SQLite Durable Retry Journal
# ==============================================================================


STATUS_SYNC_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS pending_status_syncs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    status TEXT NOT NULL,
    spooler_job_id INTEGER,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    last_attempt_at TEXT
);

CREATE TABLE IF NOT EXISTS acknowledged_status_syncs (
    attempt_id TEXT NOT NULL,
    status TEXT NOT NULL,
    acknowledged_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, status)
);

CREATE INDEX IF NOT EXISTS idx_pending_status_attempt ON pending_status_syncs(attempt_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_status_created ON pending_status_syncs(created_at);
"""


class StatusSyncJournal:
    """Thread-safe SQLite store for pending and acknowledged status updates."""

    def __init__(self, db_path: str | Path = ":memory:") -> None:
        self.db_path = str(db_path)
        self._lock = threading.RLock()
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            timeout=10.0,
        )
        self._conn.row_factory = sqlite3.Row
        self._init_db()

    def close(self) -> None:
        """Close SQLite database connection and release file locks."""
        with self._lock:
            if self._conn is not None:
                with contextlib.suppress(Exception):
                    self._conn.close()
                self._conn = None

    def _ensure_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(
                self.db_path,
                check_same_thread=False,
                timeout=10.0,
            )
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def _init_db(self) -> None:
        with self._lock:
            conn = self._ensure_conn()
            conn.executescript(STATUS_SYNC_SCHEMA_SQL)
            conn.commit()

    def is_acknowledged_or_queued(self, attempt_id: str, status: str) -> bool:
        """Check if identical attempt status has already been acknowledged or is pending."""
        with self._lock:
            conn = self._ensure_conn()
            # Check acknowledged
            cursor = conn.execute(
                "SELECT 1 FROM acknowledged_status_syncs WHERE attempt_id = ? AND status = ?",
                (attempt_id, status),
            )
            if cursor.fetchone():
                return True

            # Check pending
            cursor = conn.execute(
                "SELECT 1 FROM pending_status_syncs WHERE attempt_id = ? AND status = ?",
                (attempt_id, status),
            )
            return cursor.fetchone() is not None

    def enqueue_sync(
        self,
        job_id: str,
        attempt_id: str,
        status: str,
        spooler_job_id: int | None = None,
        error_message: str | None = None,
    ) -> StatusSyncItem:
        """Persist a status update to the offline retry queue."""
        now_str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._lock:
            conn = self._ensure_conn()
            cursor = conn.execute(
                """
                INSERT INTO pending_status_syncs (
                    job_id, attempt_id, status, spooler_job_id, error_message, retry_count, created_at
                ) VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                (job_id, attempt_id, status, spooler_job_id, error_message, now_str),
            )
            item_id = cursor.lastrowid
            conn.commit()

        logger.debug("Enqueued offline status sync #%d: job '%s', attempt '%s', status '%s'", item_id, job_id, attempt_id, status)
        return StatusSyncItem(
            id=item_id,
            job_id=job_id,
            attempt_id=attempt_id,
            status=status,
            spooler_job_id=spooler_job_id,
            error_message=error_message,
            created_at=now_str,
            retry_count=0,
        )

    def get_pending_syncs(self, limit: int = 50) -> list[StatusSyncItem]:
        """Retrieve pending status updates in strict chronological order."""
        with self._lock:
            conn = self._ensure_conn()
            cursor = conn.execute(
                """
                SELECT id, job_id, attempt_id, status, spooler_job_id, error_message,
                       retry_count, created_at, last_attempt_at
                FROM pending_status_syncs
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            )
            items = []
            for row in cursor.fetchall():
                items.append(
                    StatusSyncItem(
                        id=row["id"],
                        job_id=row["job_id"],
                        attempt_id=row["attempt_id"],
                        status=row["status"],
                        spooler_job_id=row["spooler_job_id"],
                        error_message=row["error_message"],
                        retry_count=row["retry_count"],
                        created_at=row["created_at"],
                        last_attempt_at=row["last_attempt_at"],
                    )
                )
            return items

    def mark_acknowledged(self, item_id: int, attempt_id: str, status: str) -> None:
        """Remove item from pending queue and record acknowledgement."""
        now_str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._lock:
            conn = self._ensure_conn()
            conn.execute("DELETE FROM pending_status_syncs WHERE id = ?", (item_id,))
            conn.execute(
                "INSERT OR REPLACE INTO acknowledged_status_syncs (attempt_id, status, acknowledged_at) VALUES (?, ?, ?)",
                (attempt_id, status, now_str),
            )
            conn.commit()

    def increment_retry(self, item_id: int) -> None:
        """Increment retry counter and update last attempt timestamp."""
        now_str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._lock:
            conn = self._ensure_conn()
            conn.execute(
                "UPDATE pending_status_syncs SET retry_count = retry_count + 1, last_attempt_at = ? WHERE id = ?",
                (now_str, item_id),
            )
            conn.commit()

    def record_direct_acknowledgement(self, attempt_id: str, status: str) -> None:
        """Record direct acknowledgement for an immediately delivered status update."""
        now_str = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._lock:
            conn = self._ensure_conn()
            conn.execute(
                "INSERT OR REPLACE INTO acknowledged_status_syncs (attempt_id, status, acknowledged_at) VALUES (?, ?, ?)",
                (attempt_id, status, now_str),
            )
            conn.commit()

    def get_pending_count(self) -> int:
        """Return total number of pending status sync items."""
        with self._lock:
            conn = self._ensure_conn()
            cursor = conn.execute("SELECT COUNT(*) FROM pending_status_syncs")
            return cursor.fetchone()[0]


# ==============================================================================
# Status Synchronization Manager
# ==============================================================================


class StatusSyncManager:
    """Coordinates real-time delivery and durable offline retries of attempt status updates."""

    def __init__(
        self,
        api_client: CloudApiClient,
        journal: StatusSyncJournal | None = None,
        retry_interval: float = 2.0,
        max_retries: int = 15,
    ) -> None:
        self.api_client = api_client
        self.journal = journal or StatusSyncJournal(":memory:")
        self.retry_interval = retry_interval
        self.max_retries = max_retries

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._worker_thread: threading.Thread | None = None

    def record_status(
        self,
        job_id: str,
        attempt_id: str,
        status: str,
        spooler_job_id: int | None = None,
        error_message: str | None = None,
    ) -> bool:
        """Report attempt status update to Cloud API.

        If offline or transient failure occurs, queues into durable retry journal.
        Returns True if delivered immediately, False if queued for offline retry.
        """
        normalized_status = status.lower()
        if normalized_status not in ALLOWED_STATUSES:
            raise StatusSyncError(f"Status '{status}' invalid; must be one of {ALLOWED_STATUSES}")

        with self._lock:
            # 1. Deduplication check
            if self.journal.is_acknowledged_or_queued(attempt_id, normalized_status):
                logger.debug("Duplicate status '%s' for attempt '%s' suppressed", normalized_status, attempt_id)
                return True

            # 2. Try direct immediate delivery if queue is empty
            if self.journal.get_pending_count() == 0:
                try:
                    self.api_client.update_job_status(
                        job_id=job_id,
                        attempt_id=attempt_id,
                        status=normalized_status,
                        spooler_job_id=spooler_job_id,
                        error_message=error_message,
                    )
                    # Mark acknowledged
                    self.journal.record_direct_acknowledgement(attempt_id, normalized_status)
                    logger.info("Directly synced status '%s' for job '%s' (attempt '%s')", normalized_status, job_id, attempt_id)
                    return True
                except Exception as err:
                    logger.warning(
                        "Direct status update failed for job '%s' (%s); queuing in durable retry journal",
                        job_id,
                        err,
                    )

            # 3. Queue in durable journal for offline retry
            self.journal.enqueue_sync(
                job_id=job_id,
                attempt_id=attempt_id,
                status=normalized_status,
                spooler_job_id=spooler_job_id,
                error_message=error_message,
            )
            return False

    def flush_pending(self) -> int:
        """Flush pending status updates in chronological sequence.

        Returns number of successfully delivered status updates.
        """
        flushed_count = 0
        with self._lock:
            pending_items = self.journal.get_pending_syncs(limit=50)
            if not pending_items:
                return 0

            for item in pending_items:
                if self._stop_event.is_set():
                    break

                try:
                    self.api_client.update_job_status(
                        job_id=item.job_id,
                        attempt_id=item.attempt_id,
                        status=item.status,
                        spooler_job_id=item.spooler_job_id,
                        error_message=item.error_message,
                    )
                    if item.id is not None:
                        self.journal.mark_acknowledged(item.id, item.attempt_id, item.status)
                    flushed_count += 1
                    logger.info(
                        "Flushed status '%s' for job '%s' (attempt '%s')",
                        item.status,
                        item.job_id,
                        item.attempt_id,
                    )
                except Exception as err:
                    logger.warning("Retry delivery failed for sync item #%s: %s", item.id, err)
                    if item.id is not None:
                        self.journal.increment_retry(item.id)
                    # Halt flush to preserve strict chronological delivery order
                    break

        return flushed_count

    # ==========================================================================
    # Background Worker Loop
    # ==========================================================================

    def start(self) -> None:
        """Start the background retry worker thread."""
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._run_worker,
                name="StatusSyncRetryWorker",
                daemon=True,
            )
            self._worker_thread.start()
            logger.info("StatusSyncManager background worker started")

    def stop(self, wait: bool = True) -> None:
        """Stop the background retry worker thread and close journal."""
        self._stop_event.set()
        if wait and self._worker_thread is not None:
            self._worker_thread.join(timeout=5.0)
            logger.info("StatusSyncManager background worker stopped")
        self.journal.close()

    @property
    def is_running(self) -> bool:
        return self._worker_thread is not None and self._worker_thread.is_alive()

    def _run_worker(self) -> None:
        """Background thread executing periodic flushes of pending status updates."""
        while not self._stop_event.is_set():
            try:
                if self.journal.get_pending_count() > 0:
                    self.flush_pending()
            except Exception as err:
                logger.error("Error in status sync background worker: %s", err)

            self._stop_event.wait(timeout=self.retry_interval)


# ==============================================================================
# Dispatcher Integration Helper
# ==============================================================================


def bind_status_sync_to_dispatcher(
    dispatcher: Any,
    status_sync: StatusSyncManager,
) -> None:
    """Connect a JobDispatcher's lifecycle transitions directly to StatusSyncManager."""

    def _on_transition(sm: JobStateMachine, state: JobState) -> None:
        from caps_agent.jobs.state_machine import JobState

        state_to_status = {
            JobState.PRINTING: "printing",
            JobState.COMPLETED: "completed",
            JobState.FAILED: "failed",
            JobState.UNKNOWN_REQUIRES_REVIEW: "requires_review",
        }
        target_status = state_to_status.get(state)
        if target_status:
            spooler_job_id = None
            with contextlib.suppress(Exception):
                print_res = dispatcher.get_print_result(sm.job_id)
                if print_res and print_res.spooler_job_id is not None:
                    spooler_job_id = print_res.spooler_job_id

            failure_reason = None
            if sm.history and sm.history[-1].reason:
                failure_reason = sm.history[-1].reason

            status_sync.record_status(
                job_id=sm.job_id,
                attempt_id=sm.attempt_id,
                status=target_status,
                spooler_job_id=spooler_job_id,
                error_message=failure_reason,
            )

    dispatcher.add_status_listener(_on_transition)
