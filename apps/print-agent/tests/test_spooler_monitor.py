"""Unit and integration tests for Windows Spooler outcome monitor and status classifier.

Tests cover:
- State transitions (ACCEPTED_BY_SPOOLER -> SPOOLING -> PRINTING -> COMPLETED)
- Windows 'Disappearing Job' lifecycle disambiguation: clean completion vs premature abort vs error disappearance
- Driver-exposed errors (JOB_STATUS_PAPEROUT, JOB_STATUS_BLOCKED_DEVQ, JOB_STATUS_OFFLINE, JOB_STATUS_USER_INTERVENTION, JOB_STATUS_ERROR)
- Hardware PRINTER_STATUS_* correlation during job disappearance
- Watchdog timeout expiration for hung/stalled spooler jobs
- Strict enforcement of Non-Negotiable Policy #5: unknown outcomes must NEVER auto-reprint (can_auto_reprint is False)
- Adapter protocol compliance and JSON serialization for cloud synchronization
"""

from __future__ import annotations

import unittest

from caps_agent.printing.spooler_monitor import (
    JOB_STATUS_BLOCKED_DEVQ,
    JOB_STATUS_COMPLETE,
    JOB_STATUS_DELETED,
    JOB_STATUS_DELETING,
    JOB_STATUS_ERROR,
    JOB_STATUS_OFFLINE,
    JOB_STATUS_PAPEROUT,
    JOB_STATUS_PAUSED,
    JOB_STATUS_PRINTED,
    JOB_STATUS_PRINTING,
    JOB_STATUS_SPOOLING,
    JOB_STATUS_USER_INTERVENTION,
    PRINTER_STATUS_PAPER_JAM,
    PRINTER_STATUS_PAPER_OUT,
    FakeWin32JobQueryAdapter,
    PyWin32JobQueryAdapter,
    SpoolerMonitor,
    SpoolerOutcome,
    Win32JobQueryAdapter,
)

PRINTER_NAME = "HP LaserJet Professional P1102"
JOB_ID = 3001


class TestSpoolerMonitorHappyPath(unittest.TestCase):
    """Tests normal progression through the spooler lifecycle."""

    def setUp(self) -> None:
        self.adapter = FakeWin32JobQueryAdapter()
        self.monitor = SpoolerMonitor(adapter=self.adapter)

    def test_initial_accepted_by_spooler_state(self) -> None:
        """New job queued in spooler is classified as ACCEPTED_BY_SPOOLER."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=0, pages_printed=0, total_pages=2)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.ACCEPTED_BY_SPOOLER)
        self.assertFalse(status.is_terminal)
        self.assertEqual(status.pages_printed, 0)
        self.assertEqual(status.total_pages, 2)
        self.assertIsNone(status.failure_reason)

    def test_spooling_state(self) -> None:
        """Job with JOB_STATUS_SPOOLING is classified as SPOOLING."""
        self.adapter.set_job(
            PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_SPOOLING, pages_printed=0, total_pages=5
        )
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.SPOOLING)
        self.assertFalse(status.is_terminal)
        self.assertIn("buffering", " ".join(status.status_reasons).lower())

    def test_active_printing_state(self) -> None:
        """Job with JOB_STATUS_PRINTING is classified as PRINTING."""
        self.adapter.set_job(
            PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PRINTING, pages_printed=2, total_pages=5
        )
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.PRINTING)
        self.assertFalse(status.is_terminal)
        self.assertEqual(status.pages_printed, 2)

    def test_explicit_complete_or_printed_flags(self) -> None:
        """Job marked JOB_STATUS_PRINTED or JOB_STATUS_COMPLETE is terminal COMPLETED."""
        self.adapter.set_job(
            PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PRINTED, pages_printed=3, total_pages=3
        )
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.COMPLETED)
        self.assertTrue(status.is_terminal)
        self.assertEqual(status.pages_printed, 3)

        # Test JOB_STATUS_COMPLETE
        self.adapter.set_job(
            PRINTER_NAME, JOB_ID + 1, status_flags=JOB_STATUS_COMPLETE, pages_printed=1, total_pages=1
        )
        status2 = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID + 1)
        self.assertEqual(status2.outcome, SpoolerOutcome.COMPLETED)
        self.assertTrue(status2.is_terminal)


class TestDisappearingJobScenarios(unittest.TestCase):
    """Tests the Windows 'Disappearing Job' lifecycle disambiguation."""

    def setUp(self) -> None:
        self.adapter = FakeWin32JobQueryAdapter()
        self.monitor = SpoolerMonitor(adapter=self.adapter)

    def test_clean_completion_after_active_printing(self) -> None:
        """Job observed actively printing that then disappears from queue is COMPLETED."""
        # Step 1: Observe actively printing
        self.adapter.set_job(
            PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PRINTING, pages_printed=4, total_pages=4
        )
        active_status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        self.assertEqual(active_status.outcome, SpoolerOutcome.PRINTING)

        # Step 2: Job disappears from spooler queue (GetJob returns None)
        self.adapter.remove_job(PRINTER_NAME, JOB_ID)
        finished_status = self.monitor.poll_job_status(
            PRINTER_NAME, JOB_ID, previous_state=active_status
        )

        self.assertEqual(finished_status.outcome, SpoolerOutcome.COMPLETED)
        self.assertTrue(finished_status.is_terminal)
        self.assertEqual(finished_status.pages_printed, 4)
        self.assertIn("cleared queue cleanly", finished_status.status_reasons[0])

    def test_premature_disappearance_without_printing_is_unknown(self) -> None:
        """Job that vanishes without observed printing must be classified as UNKNOWN."""
        # Step 1: Initial state only (ACCEPTED_BY_SPOOLER)
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=0, pages_printed=0, total_pages=2)
        initial_status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        # Step 2: Job disappears prematurely without active printing confirmation
        self.adapter.remove_job(PRINTER_NAME, JOB_ID)
        vanished_status = self.monitor.poll_job_status(
            PRINTER_NAME, JOB_ID, previous_state=initial_status
        )

        self.assertEqual(vanished_status.outcome, SpoolerOutcome.UNKNOWN)
        self.assertTrue(vanished_status.is_terminal)
        self.assertFalse(vanished_status.can_auto_reprint)  # Strict non-negotiable policy #5
        self.assertIn("disappeared from spooler queue", vanished_status.failure_reason or "")

    def test_disappearance_during_active_error_state_is_failed(self) -> None:
        """Job in error state that disappears from queue remains FAILED."""
        # Step 1: Job was in error (e.g. paper out)
        self.adapter.set_job(
            PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PAPEROUT, pages_printed=1, total_pages=5
        )
        error_status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        self.assertEqual(error_status.outcome, SpoolerOutcome.FAILED)

        # Step 2: Job is deleted from Windows queue by operator
        self.adapter.remove_job(PRINTER_NAME, JOB_ID)
        terminal_status = self.monitor.poll_job_status(
            PRINTER_NAME, JOB_ID, previous_state=error_status
        )

        self.assertEqual(terminal_status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(terminal_status.is_terminal)
        self.assertFalse(terminal_status.can_auto_reprint)
        self.assertIn("Printer out of paper", terminal_status.failure_reason or "")

    def test_disappearance_while_printer_hardware_jammed(self) -> None:
        """Job disappearing while printer hardware reports PRINTER_STATUS_PAPER_JAM is FAILED."""
        # Printer is reporting paper jam
        self.adapter.set_printer_status(PRINTER_NAME, PRINTER_STATUS_PAPER_JAM)

        # Job is not in queue
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)
        self.assertIn("paper jam", (status.failure_reason or "").lower())

    def test_disappearance_while_printer_hardware_out_of_paper(self) -> None:
        """Job disappearing while printer reports PRINTER_STATUS_PAPER_OUT is FAILED."""
        self.adapter.set_printer_status(PRINTER_NAME, PRINTER_STATUS_PAPER_OUT)

        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)
        self.assertIn("out of paper", (status.failure_reason or "").lower())


class TestDriverErrorReportingAndClassification(unittest.TestCase):
    """Tests classification of driver-reported hardware and software error flags."""

    def setUp(self) -> None:
        self.adapter = FakeWin32JobQueryAdapter()
        self.monitor = SpoolerMonitor(adapter=self.adapter)

    def test_job_status_error(self) -> None:
        """JOB_STATUS_ERROR results in FAILED."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_ERROR)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)
        self.assertIn("JOB_STATUS_ERROR", status.failure_reason or "")

    def test_job_status_paperout(self) -> None:
        """JOB_STATUS_PAPEROUT results in FAILED."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PAPEROUT)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)
        self.assertIn("paper", (status.failure_reason or "").lower())

    def test_job_status_blocked_devq(self) -> None:
        """JOB_STATUS_BLOCKED_DEVQ (paper jam) results in FAILED."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_BLOCKED_DEVQ)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)
        self.assertIn("blocked", (status.failure_reason or "").lower())

    def test_job_status_user_intervention(self) -> None:
        """JOB_STATUS_USER_INTERVENTION results in FAILED."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_USER_INTERVENTION)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)

    def test_job_status_offline(self) -> None:
        """JOB_STATUS_OFFLINE results in FAILED."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_OFFLINE)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)

    def test_job_status_deleted(self) -> None:
        """JOB_STATUS_DELETING / JOB_STATUS_DELETED results in FAILED."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_DELETING)
        status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        self.assertEqual(status.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status.is_terminal)

        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_DELETED)
        status2 = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        self.assertEqual(status2.outcome, SpoolerOutcome.FAILED)
        self.assertTrue(status2.is_terminal)


class TestWatchdogTimeoutAndPolicyEnforcement(unittest.TestCase):
    """Tests watchdog timeouts and Non-Negotiable Policy #5 enforcement."""

    def setUp(self) -> None:
        self.adapter = FakeWin32JobQueryAdapter()
        self.monitor = SpoolerMonitor(adapter=self.adapter)

    def test_watchdog_timeout_on_stalled_job(self) -> None:
        """Job remaining in SPOOLING beyond timeout_seconds expires as UNKNOWN."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_SPOOLING, total_pages=10)

        # Fast timeout for unit testing
        status = self.monitor.monitor_until_terminal(
            printer_name=PRINTER_NAME,
            job_id=JOB_ID,
            timeout_seconds=0.1,
            poll_interval_seconds=0.02,
        )

        self.assertEqual(status.outcome, SpoolerOutcome.UNKNOWN)
        self.assertTrue(status.is_terminal)
        self.assertFalse(status.can_auto_reprint)
        self.assertIn("Watchdog timeout expired", status.failure_reason or "")

    def test_paused_job_does_not_terminate_until_timeout_or_resume(self) -> None:
        """Paused job remains non-terminal during polling and expires as UNKNOWN on timeout."""
        self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PAUSED, total_pages=3)
        poll_res = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)

        self.assertEqual(poll_res.outcome, SpoolerOutcome.ACCEPTED_BY_SPOOLER)
        self.assertFalse(poll_res.is_terminal)

        # Monitor with fast timeout
        terminal_res = self.monitor.monitor_until_terminal(
            printer_name=PRINTER_NAME,
            job_id=JOB_ID,
            timeout_seconds=0.08,
            poll_interval_seconds=0.02,
        )
        self.assertEqual(terminal_res.outcome, SpoolerOutcome.UNKNOWN)
        self.assertTrue(terminal_res.is_terminal)
        self.assertFalse(terminal_res.can_auto_reprint)

    def test_no_auto_reprint_policy_across_all_failure_modes(self) -> None:
        """Strict verification that can_auto_reprint is False for all failure/unknown states."""
        failure_flags = [
            JOB_STATUS_ERROR,
            JOB_STATUS_PAPEROUT,
            JOB_STATUS_BLOCKED_DEVQ,
            JOB_STATUS_OFFLINE,
            JOB_STATUS_USER_INTERVENTION,
            JOB_STATUS_DELETED,
        ]

        for flag in failure_flags:
            self.adapter.set_job(PRINTER_NAME, JOB_ID, status_flags=flag)
            status = self.monitor.poll_job_status(PRINTER_NAME, JOB_ID)
            self.assertFalse(
                status.can_auto_reprint,
                f"Flag {hex(flag)} must forbid auto-reprint (can_auto_reprint must be False).",
            )


class TestAuditSerializationAndAdapterProtocol(unittest.TestCase):
    """Tests JSON serialization and protocol compliance."""

    def test_job_status_info_to_dict_serialization(self) -> None:
        """JobStatusInfo.to_dict() produces valid audit dictionary."""
        adapter = FakeWin32JobQueryAdapter()
        monitor = SpoolerMonitor(adapter=adapter)
        adapter.set_job(
            PRINTER_NAME, JOB_ID, status_flags=JOB_STATUS_PRINTING, pages_printed=3, total_pages=5
        )

        status = monitor.poll_job_status(PRINTER_NAME, JOB_ID)
        d = status.to_dict()

        self.assertEqual(d["job_id"], JOB_ID)
        self.assertEqual(d["printer_name"], PRINTER_NAME)
        self.assertEqual(d["outcome"], "printing")
        self.assertFalse(d["is_terminal"])
        self.assertEqual(d["pages_printed"], 3)
        self.assertEqual(d["total_pages"], 5)
        self.assertFalse(d["can_auto_reprint"])
        self.assertIn("observed_at", d)

    def test_fake_query_adapter_implements_protocol(self) -> None:
        """FakeWin32JobQueryAdapter satisfies Win32JobQueryAdapter runtime protocol."""
        adapter = FakeWin32JobQueryAdapter()
        self.assertIsInstance(adapter, Win32JobQueryAdapter)

    def test_pywin32_query_adapter_implements_protocol(self) -> None:
        """PyWin32JobQueryAdapter satisfies Win32JobQueryAdapter runtime protocol."""
        adapter = PyWin32JobQueryAdapter()
        self.assertIsInstance(adapter, Win32JobQueryAdapter)


if __name__ == "__main__":
    unittest.main()
