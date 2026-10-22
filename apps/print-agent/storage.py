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
import subprocess
import tempfile
from pathlib import Path

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

    def purge_file(self, file_path: Path | str) -> bool:
        """Immediately remove and purge a file."""
        p = Path(file_path).resolve()
        try:
            if p.exists() and p.is_file():
                p.unlink(missing_ok=True)
                logger.debug("Purged file %s", p)
                return True
        except Exception as err:
            logger.warning("Error purging file %s: %s", p, err)
        return False

    def purge_job_files(self, job_id: str) -> bool:
        """Immediately purge all files and the directory for a given job."""
        try:
            safe_id = sanitize_job_id(job_id)
            job_dir = (self.base_dir / safe_id).resolve()
            if job_dir.exists() and job_dir.is_dir():
                shutil.rmtree(job_dir, ignore_errors=True)
                logger.info("Purged job directory %s", job_dir)
                return True
        except Exception as err:
            logger.warning("Error purging job directory for '%s': %s", job_id, err)
        return False
