"""Durable local attempt journal for CAPS Print Agent.

Provides thread-safe SQLite-backed persistence for print job claims, attempt IDs,
cloud lease tokens, assigned Windows Spooler job IDs, status transitions, and audit events.
Enforces Non-Negotiable Policy #5 (unknown outcomes NEVER auto-reprint).
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from caps_agent.jobs.state_machine import JobState

logger = logging.getLogger("caps_agent.storage.local_state")


# ==============================================================================
# Domain Record Dataclasses
# ==============================================================================


@dataclass(frozen=True)
class JobAttemptRecord:
    """Persistent representation of a print job execution attempt."""

    attempt_id: str
    job_id: str
    printer_name: str
    lease_token: str
    status: str
    shop_id: str | None = None
    spooler_job_id: int | None = None
    pages_submitted: int = 0
    total_bytes_written: int = 0
    pdf_path: str | None = None
    job_title: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    can_auto_reprint: bool = False  # Strictly False per Policy #5
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert into a JSON-serializable dictionary."""
        return {
            "attempt_id": self.attempt_id,
            "job_id": self.job_id,
            "shop_id": self.shop_id,
            "printer_name": self.printer_name,
            "lease_token": self.lease_token,
            "status": self.status,
            "spooler_job_id": self.spooler_job_id,
            "pages_submitted": self.pages_submitted,
            "total_bytes_written": self.total_bytes_written,
            "pdf_path": self.pdf_path,
            "job_title": self.job_title,
            "error_code": self.error_code,
            "error_message": self.error_message,
            "can_auto_reprint": self.can_auto_reprint,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(frozen=True)
class AttemptEventRecord:
    """Audit log entry for attempt state transitions."""

    id: int
    attempt_id: str
    from_status: str
    to_status: str
    reason: str | None = None
    error_code: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert into a JSON-serializable dictionary."""
        return {
            "id": self.id,
            "attempt_id": self.attempt_id,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "reason": self.reason,
            "error_code": self.error_code,
            "details": self.details,
            "created_at": self.created_at,
        }


# ==============================================================================
# Database Schema & Initialization
# ==============================================================================

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS attempts (
    attempt_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    shop_id TEXT,
    printer_name TEXT NOT NULL,
    lease_token TEXT NOT NULL,
    status TEXT NOT NULL,
    spooler_job_id INTEGER,
    pages_submitted INTEGER DEFAULT 0,
    total_bytes_written INTEGER DEFAULT 0,
    pdf_path TEXT,
    job_title TEXT,
    error_code TEXT,
    error_message TEXT,
    can_auto_reprint INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempt_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    reason TEXT,
    error_code TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_job_id ON attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempt_events_attempt_id ON attempt_events(attempt_id);
"""


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ==============================================================================
# Local State Journal
# ==============================================================================


class LocalStateJournal:
    """Thread-safe SQLite store for print job execution lifecycle and attempt history.

    Maintains durability across crashes, enforces Policy #5 non-reprint integrity,
    and provides audit records for all execution attempts.
    """

    def __init__(self, db_path: str | Path = ":memory:") -> None:
        self.db_path = str(db_path)
        self._lock = threading.RLock()

        if self.db_path != ":memory:":
            path_obj = Path(self.db_path)
            path_obj.parent.mkdir(parents=True, exist_ok=True)

        self._conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
        )
        self._conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        with self._lock:
            prev_isolation = self._conn.isolation_level
            self._conn.isolation_level = None
            cur = self._conn.cursor()
            try:
                # PRAGMAs for durability and concurrency
                if self.db_path != ":memory:":
                    cur.execute("PRAGMA journal_mode=WAL;")
                    cur.execute("PRAGMA synchronous=NORMAL;")
                cur.execute("PRAGMA foreign_keys=ON;")
                cur.execute("PRAGMA busy_timeout=5000;")
                cur.executescript(SCHEMA_SQL)
            finally:
                cur.close()
                self._conn.isolation_level = prev_isolation

    def close(self) -> None:
        """Close SQLite database connection cleanly."""
        with self._lock:
            try:
                self._conn.close()
            except Exception as e:
                logger.debug("Error closing SQLite connection: %s", e)

    def __enter__(self) -> LocalStateJournal:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()

    def record_claim(
        self,
        job_id: str,
        attempt_id: str,
        printer_name: str,
        lease_token: str,
        shop_id: str | None = None,
        pdf_path: str | Path | None = None,
        job_title: str | None = None,
        initial_status: JobState | str = JobState.CLAIMED,
    ) -> JobAttemptRecord:
        """Record a newly claimed print job attempt into persistent storage.

        Idempotent: if attempt_id already exists, returns the existing record.
        """
        status_str = (
            initial_status.value if isinstance(initial_status, JobState) else str(initial_status)
        )
        now = _now_iso()
        pdf_str = str(pdf_path) if pdf_path is not None else None

        with self._lock:
            cur = self._conn.cursor()
            try:
                # Check for existing record
                cur.execute("SELECT * FROM attempts WHERE attempt_id = ?", (attempt_id,))
                row = cur.fetchone()
                if row:
                    cur.close()
                    return self._row_to_attempt(row)

                cur.execute(
                    """
                    INSERT INTO attempts (
                        attempt_id, job_id, shop_id, printer_name, lease_token,
                        status, spooler_job_id, pages_submitted, total_bytes_written,
                        pdf_path, job_title, error_code, error_message,
                        can_auto_reprint, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, NULL, NULL, 0, ?, ?)
                    """,
                    (
                        attempt_id,
                        job_id,
                        shop_id,
                        printer_name,
                        lease_token,
                        status_str,
                        pdf_str,
                        job_title,
                        now,
                        now,
                    ),
                )

                # Record creation event
                cur.execute(
                    """
                    INSERT INTO attempt_events (
                        attempt_id, from_status, to_status, reason, error_code, details_json, created_at
                    ) VALUES (?, ?, ?, ?, NULL, ?, ?)
                    """,
                    (
                        attempt_id,
                        JobState.QUEUED.value,
                        status_str,
                        "Job attempt claimed",
                        json.dumps({"job_id": job_id, "printer_name": printer_name}),
                        now,
                    ),
                )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.close()

            record = self.get_attempt(attempt_id)
            if not record:
                raise RuntimeError(
                    f"Failed to retrieve record for newly claimed attempt '{attempt_id}'"
                )
            return record

    def update_status(
        self,
        attempt_id: str,
        status: JobState | str,
        reason: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> JobAttemptRecord:
        """Update the status of an existing attempt and append an audit event."""
        status_str = status.value if isinstance(status, JobState) else str(status)
        now = _now_iso()
        details_json = json.dumps(details) if details else None

        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute("SELECT status FROM attempts WHERE attempt_id = ?", (attempt_id,))
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"Attempt '{attempt_id}' not found in journal")

                old_status = row["status"]

                cur.execute(
                    """
                    UPDATE attempts
                    SET status = ?,
                        error_code = COALESCE(?, error_code),
                        error_message = COALESCE(?, error_message),
                        updated_at = ?
                    WHERE attempt_id = ?
                    """,
                    (status_str, error_code, error_message, now, attempt_id),
                )

                cur.execute(
                    """
                    INSERT INTO attempt_events (
                        attempt_id, from_status, to_status, reason, error_code, details_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (attempt_id, old_status, status_str, reason, error_code, details_json, now),
                )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.close()

            record = self.get_attempt(attempt_id)
            if not record:
                raise RuntimeError(
                    f"Failed to retrieve record after update for attempt '{attempt_id}'"
                )
            return record

    def record_spooler_submission(
        self,
        attempt_id: str,
        spooler_job_id: int,
        pages_submitted: int = 0,
        total_bytes_written: int = 0,
    ) -> JobAttemptRecord:
        """Record assigned Windows Spooler Job ID and payload metrics."""
        now = _now_iso()
        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute(
                    """
                    UPDATE attempts
                    SET spooler_job_id = ?,
                        pages_submitted = ?,
                        total_bytes_written = ?,
                        updated_at = ?
                    WHERE attempt_id = ?
                    """,
                    (spooler_job_id, pages_submitted, total_bytes_written, now, attempt_id),
                )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.close()

            record = self.get_attempt(attempt_id)
            if not record:
                raise KeyError(f"Attempt '{attempt_id}' not found in journal")
            return record

    def record_completion(
        self,
        attempt_id: str,
        details: dict[str, Any] | None = None,
    ) -> JobAttemptRecord:
        """Mark attempt as COMPLETED."""
        return self.update_status(
            attempt_id=attempt_id,
            status=JobState.COMPLETED,
            reason="Spooler submission successfully verified",
            details=details,
        )

    def record_failure(
        self,
        attempt_id: str,
        error_code: str,
        error_message: str,
        details: dict[str, Any] | None = None,
    ) -> JobAttemptRecord:
        """Mark attempt as FAILED."""
        return self.update_status(
            attempt_id=attempt_id,
            status=JobState.FAILED,
            reason=error_message,
            error_code=error_code,
            error_message=error_message,
            details=details,
        )

    def record_unknown_requires_review(
        self,
        attempt_id: str,
        error_code: str = "UNKNOWN_REQUIRES_REVIEW",
        reason: str = "Ambiguous spooler outcome; manual inspection required",
        details: dict[str, Any] | None = None,
    ) -> JobAttemptRecord:
        """Mark attempt as UNKNOWN_REQUIRES_REVIEW.

        Enforces Policy #5: can_auto_reprint remains strictly 0 (False).
        """
        now = _now_iso()
        details_json = json.dumps(details) if details else None

        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute("SELECT status FROM attempts WHERE attempt_id = ?", (attempt_id,))
                row = cur.fetchone()
                if not row:
                    raise KeyError(f"Attempt '{attempt_id}' not found in journal")
                old_status = row["status"]

                cur.execute(
                    """
                    UPDATE attempts
                    SET status = ?,
                        error_code = ?,
                        error_message = ?,
                        can_auto_reprint = 0,
                        updated_at = ?
                    WHERE attempt_id = ?
                    """,
                    (
                        JobState.UNKNOWN_REQUIRES_REVIEW.value,
                        error_code,
                        reason,
                        now,
                        attempt_id,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO attempt_events (
                        attempt_id, from_status, to_status, reason, error_code, details_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        attempt_id,
                        old_status,
                        JobState.UNKNOWN_REQUIRES_REVIEW.value,
                        reason,
                        error_code,
                        details_json,
                        now,
                    ),
                )
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cur.close()

            record = self.get_attempt(attempt_id)
            if not record:
                raise RuntimeError(f"Failed to retrieve record for attempt '{attempt_id}'")
            return record

    def get_attempt(self, attempt_id: str) -> JobAttemptRecord | None:
        """Retrieve attempt record by attempt_id."""
        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute("SELECT * FROM attempts WHERE attempt_id = ?", (attempt_id,))
                row = cur.fetchone()
                return self._row_to_attempt(row) if row else None
            finally:
                cur.close()

    def get_attempts_for_job(self, job_id: str) -> list[JobAttemptRecord]:
        """Retrieve all execution attempts for a given job_id."""
        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute(
                    "SELECT * FROM attempts WHERE job_id = ? ORDER BY created_at ASC",
                    (job_id,),
                )
                return [self._row_to_attempt(row) for row in cur.fetchall()]
            finally:
                cur.close()

    def get_active_attempts(self) -> list[JobAttemptRecord]:
        """Retrieve all in-flight, non-terminal attempts.

        Used on startup crash recovery to identify unfinished jobs.
        Terminal states: COMPLETED, FAILED, CANCELLED, UNKNOWN_REQUIRES_REVIEW.
        """
        terminal_values = (
            JobState.COMPLETED.value,
            JobState.FAILED.value,
            JobState.CANCELLED.value,
            JobState.UNKNOWN_REQUIRES_REVIEW.value,
        )
        placeholders = ",".join("?" for _ in terminal_values)

        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute(
                    f"""
                    SELECT * FROM attempts
                    WHERE status NOT IN ({placeholders})
                    ORDER BY created_at ASC
                    """,
                    terminal_values,
                )
                return [self._row_to_attempt(row) for row in cur.fetchall()]
            finally:
                cur.close()

    def get_attempt_history(self, attempt_id: str) -> list[AttemptEventRecord]:
        """Retrieve full state transition audit history for an attempt."""
        with self._lock:
            cur = self._conn.cursor()
            try:
                cur.execute(
                    "SELECT * FROM attempt_events WHERE attempt_id = ? ORDER BY id ASC",
                    (attempt_id,),
                )
                events = []
                for row in cur.fetchall():
                    details = {}
                    if row["details_json"]:
                        try:
                            details = json.loads(row["details_json"])
                        except Exception:
                            details = {}
                    events.append(
                        AttemptEventRecord(
                            id=row["id"],
                            attempt_id=row["attempt_id"],
                            from_status=row["from_status"],
                            to_status=row["to_status"],
                            reason=row["reason"],
                            error_code=row["error_code"],
                            details=details,
                            created_at=row["created_at"],
                        )
                    )
                return events
            finally:
                cur.close()

    @staticmethod
    def _row_to_attempt(row: sqlite3.Row) -> JobAttemptRecord:
        return JobAttemptRecord(
            attempt_id=row["attempt_id"],
            job_id=row["job_id"],
            shop_id=row["shop_id"],
            printer_name=row["printer_name"],
            lease_token=row["lease_token"],
            status=row["status"],
            spooler_job_id=row["spooler_job_id"],
            pages_submitted=row["pages_submitted"],
            total_bytes_written=row["total_bytes_written"],
            pdf_path=row["pdf_path"],
            job_title=row["job_title"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            can_auto_reprint=bool(row["can_auto_reprint"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
