"""Stable internal printing interface for CAPS Print Agent.

Defines the protocol boundary separating cloud orchestration, job dispatching,
and native Windows spooler interactions.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class PrintSettings:
    """User-selected print configuration received from Cloud API."""
    paper_size: str        # 'A4', 'A3', 'Legal'
    color_mode: str        # 'bw', 'color'
    duplex: bool           # True = double-sided, False = single-sided
    copies: int            # 1..100
    page_range: str        # 'all' or custom comma/dash ranges like '1-5,8'
    orientation: str       # 'portrait', 'landscape'


@dataclass(frozen=True)
class PrintResult:
    """Outcome of submission to the local OS print subsystem.

    NOTE: accepted=True and non-null spooler_job_id indicate Windows Spooler
    acceptance, NOT proof of physical ink-on-paper completion.
    """
    accepted: bool
    spooler_job_id: int | None
    error: str | None = None


@runtime_checkable
class PrintEngine(Protocol):
    """Protocol boundary for print engine implementations."""

    def print_document(
        self,
        pdf_path: Path,
        printer_name: str,
        settings: PrintSettings,
    ) -> PrintResult:
        """Submit print work to the specified printer with settings.

        Submissions must be dialog-free and non-blocking.
        """
        ...
