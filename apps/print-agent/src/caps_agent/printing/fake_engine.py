"""In-memory test fake for the PrintEngine protocol.

Enables developer iteration and CI tests without requiring physical Windows
printers or pywin32 OS drivers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from caps_agent.printing.engine import PrintEngine, PrintResult, PrintSettings


@dataclass
class FakePrintEngine(PrintEngine):
    """Test fake modeling spooler submission without generating physical output."""

    should_succeed: bool = True
    simulated_spooler_job_id: int = 1001
    simulated_error: str | None = None
    submission_log: list[dict[str, object]] = field(default_factory=list)

    def print_document(
        self,
        pdf_path: Path,
        printer_name: str,
        settings: PrintSettings,
    ) -> PrintResult:
        self.submission_log.append({
            "pdf_path": str(pdf_path),
            "printer_name": printer_name,
            "settings": settings,
        })

        if not self.should_succeed:
            return PrintResult(
                accepted=False,
                spooler_job_id=None,
                error=self.simulated_error or "Simulated hardware error",
            )

        job_id = self.simulated_spooler_job_id
        self.simulated_spooler_job_id += 1
        return PrintResult(accepted=True, spooler_job_id=job_id, error=None)
