"""Protected temporary file and directory management for CAPS Print Agent.

Provides isolated, access-restricted workspaces for PDF downloads, rendered raster bitmaps,
and spool artifacts. Defends against directory traversal and unauthorized local file access.
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

logger = logging.getLogger("caps_agent.storage.temp_files")

# Strict regex for valid IDs (UUIDs, alphanumeric identifiers with hyphens/underscores)
SAFE_ID_REGEX = re.compile(r"^[a-zA-Z0-9_\-]+$")


class PathTraversalSecurityError(ValueError):
    """Raised when an identifier contains directory traversal or forbidden characters."""

    pass


class TempFileManager:
    """Manages secure, scoped temporary storage for print job processing.

    Enforces:
    - Path traversal validation on all job and attempt identifiers
    - Restrictive folder access permissions (current user / SYSTEM on Windows, 0700 on POSIX)
    - Per-job directory isolation
    - In-memory registry of allocated temp files for guaranteed cleanup
    """

    def __init__(
        self,
        base_dir: Path | str,
        secure_permissions: bool = True,
    ) -> None:
        self.base_dir = Path(base_dir).resolve()
        self.secure_permissions = secure_permissions
        self._tracked_files: dict[str, set[Path]] = {}  # job_id -> set of Paths

        self._ensure_base_directory()

    def _ensure_base_directory(self) -> None:
        """Create base directory and apply secure ACLs/permissions."""
        self.base_dir.mkdir(parents=True, exist_ok=True)
        if self.secure_permissions:
            self._apply_secure_permissions(self.base_dir)

    def _apply_secure_permissions(self, path: Path) -> None:
        """Apply restrictive permissions so other local non-admin users cannot read spool files."""
        if os.name == "nt":
            # On Windows: attempt icacls to grant full control only to current user and SYSTEM
            username = os.environ.get("USERNAME")
            if username:
                try:
                    # /inheritance:r removes inherited ACLs
                    # /grant:r grants full access to current user and SYSTEM
                    cmd = [
                        "icacls",
                        str(path),
                        "/inheritance:r",
                        "/grant:r",
                        f"{username}:(OI)(CI)F",
                        "/grant:r",
                        "SYSTEM:(OI)(CI)F",
                    ]
                    res = subprocess.run(
                        cmd, capture_output=True, text=True, timeout=5, check=False
                    )
                    if res.returncode != 0:
                        logger.debug("icacls returned %d: %s", res.returncode, res.stderr.strip())
                except Exception as exc:
                    logger.debug("Could not apply Windows ACLs via icacls: %s", exc)
        else:
            # On POSIX: chmod 0700 (owner read, write, execute only)
            with contextlib.suppress(Exception):
                os.chmod(path, 0o700)

    @staticmethod
    def sanitize_id(identifier: str, name: str = "identifier") -> str:
        """Validate that identifier does not contain directory traversal or illegal characters."""
        if not identifier or not isinstance(identifier, str):
            raise PathTraversalSecurityError(f"{name} cannot be empty")

        # Reject path separators, null bytes, and traversal sequences
        if ".." in identifier or "/" in identifier or "\\" in identifier or "\0" in identifier:
            raise PathTraversalSecurityError(
                f"Security violation: {name} '{identifier}' contains forbidden traversal characters"
            )

        if not SAFE_ID_REGEX.match(identifier):
            raise PathTraversalSecurityError(
                f"Security violation: {name} '{identifier}' contains invalid characters. "
                "Must be alphanumeric with optional hyphens or underscores."
            )

        return identifier

    def get_job_dir(self, job_id: str, attempt_id: str | None = None) -> Path:
        """Return and create an isolated, secure directory for a specific job/attempt."""
        safe_job_id = self.sanitize_id(job_id, name="job_id")
        folder_name = f"job_{safe_job_id}"
        if attempt_id:
            safe_attempt_id = self.sanitize_id(attempt_id, name="attempt_id")
            folder_name = f"job_{safe_job_id}_att_{safe_attempt_id}"

        job_dir = (self.base_dir / folder_name).resolve()

        # Strict containment check to prevent breakout
        if not str(job_dir).startswith(str(self.base_dir)):
            raise PathTraversalSecurityError(
                f"Job directory '{job_dir}' escaped base dir '{self.base_dir}'"
            )

        job_dir.mkdir(parents=True, exist_ok=True)
        if self.secure_permissions:
            self._apply_secure_permissions(job_dir)

        return job_dir

    def create_temp_file(
        self,
        job_id: str,
        suffix: str = ".tmp",
        prefix: str = "spool_",
        attempt_id: str | None = None,
    ) -> Path:
        """Allocate a secure temporary file within the job's isolated directory."""
        job_dir = self.get_job_dir(job_id, attempt_id=attempt_id)
        fd, temp_path_str = tempfile.mkstemp(suffix=suffix, prefix=prefix, dir=job_dir)
        os.close(fd)

        temp_path = Path(temp_path_str).resolve()
        self.register_file(temp_path, job_id=job_id)
        return temp_path

    def register_file(self, path: Path | str, job_id: str) -> Path:
        """Register an existing file under job tracking for lifecycle management."""
        safe_job_id = self.sanitize_id(job_id, name="job_id")
        resolved = Path(path).resolve()
        if safe_job_id not in self._tracked_files:
            self._tracked_files[safe_job_id] = set()
        self._tracked_files[safe_job_id].add(resolved)
        return resolved

    def list_job_files(self, job_id: str) -> list[Path]:
        """List all physical files currently existing inside the job's directory."""
        safe_job_id = self.sanitize_id(job_id, name="job_id")
        files: list[Path] = []

        # Check job directory pattern
        for entry in self.base_dir.iterdir():
            if entry.is_dir() and entry.name.startswith(f"job_{safe_job_id}"):
                for file_path in entry.rglob("*"):
                    if file_path.is_file():
                        files.append(file_path.resolve())

        # Also add any explicitly tracked files
        tracked = self._tracked_files.get(safe_job_id, set())
        for f in tracked:
            if f.is_file() and f not in files:
                files.append(f)

        return files

    def list_tracked_files(self, job_id: str | None = None) -> list[Path]:
        """Return list of tracked file paths."""
        if job_id is not None:
            safe_job_id = self.sanitize_id(job_id, name="job_id")
            return list(self._tracked_files.get(safe_job_id, set()))

        all_files: list[Path] = []
        for file_set in self._tracked_files.values():
            all_files.extend(file_set)
        return all_files

    def cleanup_job_files(self, job_id: str) -> int:
        """Delete all files and directories associated with a specific job."""
        safe_job_id = self.sanitize_id(job_id, name="job_id")
        deleted_count = 0

        # Delete tracked files
        tracked = self._tracked_files.pop(safe_job_id, set())
        for path in tracked:
            try:
                if path.is_file():
                    path.unlink(missing_ok=True)
                    deleted_count += 1
            except Exception as e:
                logger.warning("Could not unlink tracked file '%s': %s", path, e)

        # Delete any matching job directories in base_dir
        for entry in self.base_dir.iterdir():
            if entry.is_dir() and entry.name.startswith(f"job_{safe_job_id}"):
                try:
                    # Count files before rmtree
                    count = sum(1 for p in entry.rglob("*") if p.is_file())
                    shutil.rmtree(entry, ignore_errors=True)
                    deleted_count += count
                except Exception as e:
                    logger.warning("Could not remove job directory '%s': %s", entry, e)

        return deleted_count
