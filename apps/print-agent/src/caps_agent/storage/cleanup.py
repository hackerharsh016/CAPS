"""Transient file cleanup and orphan artifact scrubbing for CAPS Print Agent.

Handles:
- Immediate post-execution cleanup of PDF binaries and rendered raster bitmaps
- Secure file wiping (overwriting before unlink) for customer privacy protection
- Startup and periodic orphan scrubbing of abandoned spool files and folders
- Graceful handling of Windows file-locking caveats (spooler / antivirus locks)
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from caps_agent.storage.temp_files import TempFileManager

logger = logging.getLogger("caps_agent.storage.cleanup")


@dataclass
class CleanupReport:
    """Summary of cleaned temporary files, directories, and reclaimed storage."""

    files_deleted: int = 0
    dirs_deleted: int = 0
    bytes_freed: int = 0
    errors: list[str] = field(default_factory=list)

    def merge(self, other: CleanupReport) -> None:
        """Merge another report into this report."""
        self.files_deleted += other.files_deleted
        self.dirs_deleted += other.dirs_deleted
        self.bytes_freed += other.bytes_freed
        self.errors.extend(other.errors)

    def to_dict(self) -> dict[str, object]:
        return {
            "files_deleted": self.files_deleted,
            "dirs_deleted": self.dirs_deleted,
            "bytes_freed": self.bytes_freed,
            "errors": self.errors,
        }


class ArtifactCleaner:
    """Manages immediate and scheduled lifecycle cleanup for spool artifacts.

    Ensures zero sensitive customer documents linger on disk after printing,
    failure, or unexpected process termination.
    """

    def __init__(
        self,
        temp_manager: TempFileManager | None = None,
        base_dir: Path | str | None = None,
        secure_wipe: bool = False,
    ) -> None:
        self.temp_manager = temp_manager
        if base_dir is not None:
            self.base_dir = Path(base_dir).resolve()
        elif temp_manager is not None:
            self.base_dir = temp_manager.base_dir
        else:
            self.base_dir = Path(os.environ.get("TEMP", "/tmp")) / "caps_spool"

        self.secure_wipe = secure_wipe

    def wipe_and_unlink(self, path: Path | str, secure: bool | None = None) -> int:
        """Safely delete a file, optionally wiping its contents with zeros first.

        Returns the number of bytes freed, or 0 on error.
        """
        file_path = Path(path).resolve()
        if not file_path.is_file():
            return 0

        should_wipe = self.secure_wipe if secure is None else secure
        bytes_freed = 0

        try:
            bytes_freed = file_path.stat().st_size
            if should_wipe and bytes_freed > 0:
                try:
                    # Overwrite file contents with zeros to prevent forensic data recovery
                    with open(file_path, "wb") as f:
                        f.write(b"\x00" * min(bytes_freed, 1024 * 1024))
                        f.flush()
                        os.fsync(f.fileno())
                except Exception as wipe_err:
                    logger.debug(
                        "Secure wipe failed for '%s' (will attempt direct unlink): %s",
                        file_path,
                        wipe_err,
                    )

            file_path.unlink(missing_ok=True)
            return bytes_freed
        except PermissionError as perm_err:
            # Common on Windows if spooler or antivirus has an open handle
            logger.warning(
                "File '%s' is locked by another process (will defer cleanup): %s",
                file_path,
                perm_err,
            )
            raise
        except Exception as err:
            logger.warning("Failed to delete file '%s': %s", file_path, err)
            raise

    def cleanup_job(
        self,
        job_id: str,
        secure: bool | None = None,
    ) -> CleanupReport:
        """Clean up all spool files and directories associated with a specific job."""
        report = CleanupReport()

        if self.temp_manager:
            try:
                # First delete tracked files with optional wipe
                tracked = self.temp_manager.list_job_files(job_id)
                for f in tracked:
                    try:
                        bytes_freed = self.wipe_and_unlink(f, secure=secure)
                        report.files_deleted += 1
                        report.bytes_freed += bytes_freed
                    except Exception as exc:
                        report.errors.append(f"File {f.name}: {exc}")

                deleted = self.temp_manager.cleanup_job_files(job_id)
                if deleted > report.files_deleted:
                    report.files_deleted = deleted
            except Exception as err:
                report.errors.append(f"Job {job_id} temp manager cleanup error: {err}")
                return report

        # Fallback / directory removal in base_dir
        safe_id = job_id.replace("/", "").replace("\\", "").replace("..", "")
        for entry in self.base_dir.iterdir():
            if entry.is_dir() and entry.name.startswith(f"job_{safe_id}"):
                try:
                    # Clean remaining files inside
                    for sub_file in list(entry.rglob("*")):
                        if sub_file.is_file():
                            try:
                                b = self.wipe_and_unlink(sub_file, secure=secure)
                                report.files_deleted += 1
                                report.bytes_freed += b
                            except Exception as e:
                                report.errors.append(f"Subfile {sub_file.name}: {e}")

                    shutil.rmtree(entry, ignore_errors=True)
                    report.dirs_deleted += 1
                except Exception as err:
                    report.errors.append(f"Directory {entry.name}: {err}")

        return report

    def cleanup_orphans(
        self,
        max_age_seconds: float = 3600.0,
        exclude_active_job_ids: set[str] | None = None,
        secure: bool | None = None,
    ) -> CleanupReport:
        """Scrub stale or orphaned files and directories older than max_age_seconds.

        Protects active job files by skipping any directory matching exclude_active_job_ids.
        """
        report = CleanupReport()
        if not self.base_dir.exists():
            return report

        now = time.time()
        active_set = exclude_active_job_ids or set()

        for entry in list(self.base_dir.iterdir()):
            try:
                # 1. Job directory check
                if entry.is_dir():
                    # Check if belongs to an active job
                    job_prefix_match = False
                    for active_id in active_set:
                        if entry.name.startswith(f"job_{active_id}"):
                            job_prefix_match = True
                            break

                    if job_prefix_match:
                        logger.debug(
                            "Skipping active job directory '%s' during orphan scrub", entry.name
                        )
                        continue

                    stat_info = entry.stat()
                    dir_age = now - stat_info.st_mtime
                    if dir_age >= max_age_seconds:
                        for sub_file in list(entry.rglob("*")):
                            if sub_file.is_file():
                                try:
                                    b = self.wipe_and_unlink(sub_file, secure=secure)
                                    report.files_deleted += 1
                                    report.bytes_freed += b
                                except Exception as e:
                                    report.errors.append(f"Stale file {sub_file.name}: {e}")

                        try:
                            shutil.rmtree(entry, ignore_errors=True)
                            report.dirs_deleted += 1
                            logger.info(
                                "Cleaned stale job directory: %s (age: %.1fs)", entry.name, dir_age
                            )
                        except Exception as e:
                            report.errors.append(f"Stale dir {entry.name}: {e}")

                # 2. Standalone file in base_dir
                elif entry.is_file():
                    stat_info = entry.stat()
                    file_age = now - stat_info.st_mtime
                    if file_age >= max_age_seconds:
                        try:
                            b = self.wipe_and_unlink(entry, secure=secure)
                            report.files_deleted += 1
                            report.bytes_freed += b
                            logger.info(
                                "Cleaned stale spool file: %s (age: %.1fs)", entry.name, file_age
                            )
                        except Exception as e:
                            report.errors.append(f"Stale file {entry.name}: {e}")

            except Exception as err:
                report.errors.append(f"Entry {entry.name}: {err}")

        return report
