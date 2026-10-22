"""Secure local temporary storage for Desktop Print Agent (INT-D4-02).

Manages isolated, access-restricted workspaces for PDF downloads,
spool files, and temporary artifacts under %TEMP%\\caps\\jobs\\<job_id>\\.
Enforces strict Windows ACLs restricting read/write access to the current Windows user and SYSTEM.
"""

from __future__ import annotations

import contextlib
import logging
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("caps_agent.storage")

# Strict regex for valid IDs (UUIDs, alphanumeric identifiers with hyphens/underscores)
SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]+$")


class StorageSecurityError(ValueError):
    """Raised when an identifier or path violates security invariants."""
    pass


def sanitize_job_id(job_id: str) -> str:
    """Validate that job_id is safe and free of path traversal sequences."""
    if not job_id or not isinstance(job_id, str):
        raise StorageSecurityError("job_id cannot be empty")

    if ".." in job_id or "/" in job_id or "\\" in job_id or "\0" in job_id:
        raise StorageSecurityError(
            f"Security violation: job_id '{job_id}' contains path traversal characters"
        )

    if not SAFE_ID_REGEX.match(job_id):
        raise StorageSecurityError(
            f"Security violation: job_id '{job_id}' contains invalid characters"
        )

    return job_id


def apply_restricted_acls(path: Path | str) -> bool:
    """Ensure Windows file permissions restrict access exclusively to the current Windows user and SYSTEM.

    Uses icacls /inheritance:r /grant:r <username>:(OI)(CI)F SYSTEM:(OI)(CI)F on Windows.
    Falls back to chmod 0700/0600 on POSIX platforms.
    """
    target = Path(path).resolve()
    if not target.exists():
        return False

    if os.name == "nt":
        username = os.environ.get("USERNAME")
        if username:
            try:
                # If directory, use (OI)(CI)F for object & container inheritance. If file, use :F
                is_dir = target.is_dir()
                perm_spec = ":(OI)(CI)F" if is_dir else ":F"

                cmd = [
                    "icacls",
                    str(target),
                    "/inheritance:r",
                    "/grant:r",
                    f"{username}{perm_spec}",
                    "/grant:r",
                    f"SYSTEM{perm_spec}",
                ]
                res = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
                if res.returncode == 0:
                    logger.debug("Successfully applied restricted ACLs to %s via icacls", target)
                    return True
                else:
                    logger.debug("icacls returned %d: %s", res.returncode, res.stderr.strip())
            except Exception as exc:
                logger.debug("Failed executing icacls for %s: %s", target, exc)

        # Fallback to pywin32 if icacls is unavailable or fails
        try:
            import win32security  # type: ignore
            import ntsecuritycon as con  # type: ignore

            user_sid, _, _ = win32security.LookupAccountName(None, username or "")
            system_sid = win32security.CreateWellKnownSid(win32security.WinLocalSystemSid)

            dacl = win32security.ACL()
            dacl.AddAccessAllowedAce(win32security.ACL_REVISION, con.GENERIC_ALL, user_sid)
            dacl.AddAccessAllowedAce(win32security.ACL_REVISION, con.GENERIC_ALL, system_sid)

            sd = win32security.SECURITY_DESCRIPTOR()
            sd.SetSecurityDescriptorDacl(1, dacl, 0)
            win32security.SetFileSecurity(
                str(target),
                win32security.DACL_SECURITY_INFORMATION | win32security.PROTECTED_DACL_SECURITY_INFORMATION,
                sd,
            )
            logger.debug("Applied restricted ACLs to %s via win32security", target)
            return True
        except Exception:
            pass

    else:
        # POSIX systems: 0700 for directories, 0600 for files
        try:
            mode = 0o700 if target.is_dir() else 0o600
            os.chmod(target, mode)
            return True
        except Exception as exc:
            logger.debug("chmod failed on %s: %s", target, exc)

    return False


def secure_purge(path: Path | str, passes: int = 1) -> bool:
    """Enforce zero-retention privacy policy by securely overwriting and unlinking files.

    Overwrites file bytes with cryptographic random data (or zeroes) prior to unlinking,
    flushes and syncs to disk, removes the file, and verifies that zero bytes remain.
    If path is a directory, recursively overwrites and deletes all files inside,
    then deletes the directory.
    """
    target = Path(path).resolve()
    if not target.exists():
        return True

    try:
        # Reset any read-only flags
        try:
            os.chmod(target, stat.S_IWRITE | stat.S_IREAD)
        except Exception:
            pass

        if target.is_dir():
            for child in target.iterdir():
                secure_purge(child, passes=passes)
            shutil.rmtree(target, ignore_errors=True)
            return not target.exists()

        if target.is_file():
            size = target.stat().st_size
            if size > 0:
                # Open for binary write/in-place overwrite
                try:
                    with open(target, "r+b") as f:
                        for _ in range(max(1, passes)):
                            f.seek(0)
                            remaining = size
                            while remaining > 0:
                                chunk_size = min(remaining, 64 * 1024)
                                f.write(os.urandom(chunk_size))
                                remaining -= chunk_size
                            f.flush()
                            os.fsync(f.fileno())
                except Exception as write_err:
                    logger.debug("In-place overwrite failed for %s, trying fresh binary truncate overwrite: %s", target, write_err)
                    try:
                        with open(target, "wb") as f:
                            remaining = size
                            while remaining > 0:
                                chunk_size = min(remaining, 64 * 1024)
                                f.write(os.urandom(chunk_size))
                                remaining -= chunk_size
                            f.flush()
                            os.fsync(f.fileno())
                    except Exception:
                        pass

            target.unlink(missing_ok=True)
            return not target.exists()

    except Exception as err:
        logger.warning("Error during secure_purge of '%s': %s", target, err)
        try:
            if target.is_file():
                target.unlink(missing_ok=True)
            elif target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
            return not target.exists()
        except Exception:
            return False

    return not target.exists()


def get_default_attempts_db_path() -> Path:
    """Return default path for attempt tracking SQLite database."""
    env_path = os.environ.get("CAPS_ATTEMPTS_DB_PATH")
    if env_path:
        return Path(env_path).resolve()
    return Path(tempfile.gettempdir()) / "caps" / "attempts.db"


def init_attempts_db(db_path: Path | str | None = None) -> Path:
    """Ensure attempts table schema exists in the specified SQLite database."""
    target_path = Path(db_path).resolve() if db_path else get_default_attempts_db_path()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    apply_restricted_acls(target_path.parent)

    with contextlib.closing(sqlite3.connect(str(target_path))) as conn:
        with conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS attempts (
                    attempt_id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    shop_id TEXT,
                    printer_name TEXT,
                    lease_token TEXT,
                    status TEXT NOT NULL,
                    spooler_job_id INTEGER,
                    pages_submitted INTEGER DEFAULT 0,
                    total_bytes_written INTEGER DEFAULT 0,
                    pdf_path TEXT,
                    job_title TEXT,
                    error_code TEXT,
                    error_message TEXT,
                    can_auto_reprint INTEGER DEFAULT 0,
                    is_purged INTEGER DEFAULT 0,
                    purged_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

            # Ensure is_purged and purged_at columns exist if opened existing table without them
            cursor = conn.execute("PRAGMA table_info(attempts);")
            columns = [col[1] for col in cursor.fetchall()]
            if "is_purged" not in columns:
                conn.execute("ALTER TABLE attempts ADD COLUMN is_purged INTEGER DEFAULT 0;")
            if "purged_at" not in columns:
                conn.execute("ALTER TABLE attempts ADD COLUMN purged_at TEXT;")

    return target_path


def mark_attempt_purged(
    attempt_id: str,
    db_path: Path | str | None = None,
    job_id: str | None = None,
) -> bool:
    """Clear file references in SQLite attempts.db, marking attempt as purged."""
    if not attempt_id and not job_id:
        return False

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        target_path = init_attempts_db(db_path)
        with contextlib.closing(sqlite3.connect(str(target_path))) as conn:
            with conn:
                if attempt_id:
                    cursor = conn.execute(
                        """
                        UPDATE attempts
                        SET pdf_path = NULL,
                            is_purged = 1,
                            purged_at = ?,
                            updated_at = ?
                        WHERE attempt_id = ?
                        """,
                        (now_iso, now_iso, attempt_id),
                    )
                else:
                    cursor = conn.execute(
                        """
                        UPDATE attempts
                        SET pdf_path = NULL,
                            is_purged = 1,
                            purged_at = ?,
                            updated_at = ?
                        WHERE job_id = ?
                        """,
                        (now_iso, now_iso, job_id),
                    )
                return cursor.rowcount > 0
    except Exception as err:
        logger.warning("Failed to mark attempt '%s' as purged in attempts.db: %s", attempt_id, err)
        return False


def record_attempt_in_db(
    attempt_id: str,
    job_id: str,
    pdf_path: str | None = None,
    status: str = "CLAIMED",
    printer_name: str = "DEFAULT",
    lease_token: str = "",
    db_path: Path | str | None = None,
) -> None:
    """Helper to record or update an attempt in attempts.db."""
    target_path = init_attempts_db(db_path)
    now_iso = datetime.now(timezone.utc).isoformat()
    with contextlib.closing(sqlite3.connect(str(target_path))) as conn:
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO attempts (
                    attempt_id, job_id, status, printer_name, lease_token, pdf_path, is_purged, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (attempt_id, job_id, status, printer_name, lease_token, pdf_path, now_iso, now_iso),
            )


def get_attempt_from_db(
    attempt_id: str,
    db_path: Path | str | None = None,
) -> dict[str, Any] | None:
    """Query an attempt record from attempts.db."""
    target_path = init_attempts_db(db_path)
    with contextlib.closing(sqlite3.connect(str(target_path))) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute("SELECT * FROM attempts WHERE attempt_id = ?", (attempt_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return dict(row)


def get_default_storage_dir() -> Path:
    """Get the standard base path for agent temp jobs (%TEMP%\\caps\\jobs)."""
    return Path(tempfile.gettempdir()) / "caps" / "jobs"


class JobStorageManager:
    """Manages isolated, secured temporary storage under %TEMP%\\caps\\jobs\\<job_id>."""

    def __init__(self, base_dir: Path | str | None = None) -> None:
        if base_dir is not None:
            self.base_dir = Path(base_dir).resolve()
        else:
            self.base_dir = get_default_storage_dir().resolve()

        self._ensure_base_directory()

    def _ensure_base_directory(self) -> None:
        """Create base directory and apply restricted permissions."""
        self.base_dir.mkdir(parents=True, exist_ok=True)
        apply_restricted_acls(self.base_dir)

    def get_job_dir(self, job_id: str) -> Path:
        """Get or create isolated job directory (%TEMP%\\caps\\jobs\\<job_id>)."""
        safe_id = sanitize_job_id(job_id)
        job_dir = (self.base_dir / safe_id).resolve()

        # Defend against any directory escape
        if not str(job_dir).startswith(str(self.base_dir)):
            raise StorageSecurityError(f"Directory traversal detected for job '{job_id}'")

        job_dir.mkdir(parents=True, exist_ok=True)
        apply_restricted_acls(job_dir)
        return job_dir

    def get_document_path(self, job_id: str, filename: str = "document.pdf") -> Path:
        """Get path for job's downloaded document (%TEMP%\\caps\\jobs\\<job_id>\\document.pdf)."""
        job_dir = self.get_job_dir(job_id)
        clean_filename = sanitize_job_id(Path(filename).stem) + Path(filename).suffix
        doc_path = (job_dir / clean_filename).resolve()
        if not str(doc_path).startswith(str(job_dir)):
            raise StorageSecurityError(f"Invalid document filename '{filename}'")
        return doc_path

    def secure_purge(self, file_path: Path | str, passes: int = 1) -> bool:
        """Securely wipe and purge a file or directory."""
        return secure_purge(file_path, passes=passes)

    def secure_purge_job(self, job_id: str, passes: int = 1) -> bool:
        """Securely overwrite and remove all files and directory for a given job."""
        try:
            safe_id = sanitize_job_id(job_id)
            job_dir = (self.base_dir / safe_id).resolve()
            if not str(job_dir).startswith(str(self.base_dir)):
                raise StorageSecurityError(f"Directory traversal detected for job '{job_id}'")
            return secure_purge(job_dir, passes=passes)
        except Exception as err:
            logger.warning("Error in secure_purge_job for '%s': %s", job_id, err)
            return False

    def purge_file(self, file_path: Path | str) -> bool:
        """Immediately remove and securely purge a file."""
        return secure_purge(file_path)

    def purge_job_files(self, job_id: str) -> bool:
        """Immediately remove and securely purge all files and directory for a job."""
        return self.secure_purge_job(job_id)
