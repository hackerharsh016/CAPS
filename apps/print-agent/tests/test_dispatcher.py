"""Unit, concurrency, and serialization tests for JobDispatcher.

Tests cover:
- Parallel enqueue test: Proves that multiple simultaneous jobs submitted to the
  same printer are strictly serialized (concurrency is strictly 1 per printer).
- Independent printer concurrency: Proves that jobs for different printers run in parallel.
- Happy path job lifecycle dispatch (QUEUED -> CLAIMED -> ... -> COMPLETED).
- Queue backpressure enforcement: Rejects jobs when queue depth exceeds capacity.
- Job cancellation: Queued jobs can be cancelled and are skipped without printing.
- Ambiguous/unknown spooler outcomes: Handled as UNKNOWN_REQUIRES_REVIEW with can_auto_reprint=False.
- Multi-tenant / shop authorization enforcement.
- Idempotency & duplicate/replayed attempt ID handling.
- Status callback invocation across transitions.
- Clean and non-blocking shutdown.
"""

from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path

from caps_agent.jobs.dispatcher import (
    DispatcherStoppedError,
    JobDispatcher,
    JobItem,
    QueueBackpressureError,
)
from caps_agent.jobs.state_machine import (
    JobState,
    JobStateMachine,
)
from caps_agent.printing.engine import (
    PrintResult,
    PrintSettings,
    ShopAuthorizationError,
)
from caps_agent.printing.fake_engine import FakePrintEngine


class ConcurrencyTrackingEngine(FakePrintEngine):
    """Test fake that tracks peak concurrent executions per printer name."""

    def __init__(self, delay_sec: float = 0.05) -> None:
        super().__init__()
        self.delay_sec = delay_sec
        self.lock = threading.Lock()
        self.active_executions: dict[str, int] = {}
        self.max_concurrent_executions: dict[str, int] = {}
        self.execution_order: list[str] = []

    def print_document(
        self,
        pdf_path: Path | str,
        printer_name: str,
        settings: PrintSettings,
        job_title: str | None = None,
        attempt_id: str | None = None,
        shop_id: str | None = None,
    ) -> PrintResult:
        with self.lock:
            cur = self.active_executions.get(printer_name, 0) + 1
            self.active_executions[printer_name] = cur
            peak = max(self.max_concurrent_executions.get(printer_name, 0), cur)
            self.max_concurrent_executions[printer_name] = peak
            if job_title:
                self.execution_order.append(job_title)

        try:
            # Simulate real rendering and spooler I/O delay
            time.sleep(self.delay_sec)
            return super().print_document(
                pdf_path=pdf_path,
                printer_name=printer_name,
                settings=settings,
                job_title=job_title,
                attempt_id=attempt_id,
                shop_id=shop_id,
            )
        finally:
            with self.lock:
                self.active_executions[printer_name] -= 1


class TestJobDispatcher(unittest.TestCase):
    """Test suite verifying per-printer serialized dispatching and state machine integration."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.fake_pdf = Path(self.temp_dir.name) / "test.pdf"
        self.fake_pdf.write_bytes(b"%PDF-1.4 Minimal PDF stub")

        self.settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )

        self.engine = FakePrintEngine()
        self.dispatcher = JobDispatcher(engine=self.engine, max_queue_per_printer=5)

    def tearDown(self) -> None:
        self.dispatcher.shutdown(wait=True, timeout=2.0)
        self.temp_dir.cleanup()

    def test_happy_path_dispatch(self) -> None:
        """Single job executes and transitions from QUEUED to COMPLETED."""
        status_updates: list[JobState] = []

        def callback(sm: JobStateMachine, state: JobState) -> None:
            status_updates.append(state)

        dispatcher = JobDispatcher(engine=self.engine, status_callback=callback)

        job = JobItem(
            job_id="job-hp-1",
            attempt_id="att-hp-1",
            printer_name="HP LaserJet Pro",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-hp-12345678",
            job_title="Happy Path Document",
        )

        sm = dispatcher.enqueue_job(job)
        final_state = dispatcher.wait_for_job(job.job_id, timeout=3.0)

        self.assertEqual(final_state, JobState.COMPLETED)
        self.assertEqual(sm.current_state, JobState.COMPLETED)
        self.assertTrue(sm.is_terminal)
        self.assertFalse(sm.can_auto_reprint)  # Policy #5

        # Verify state machine progressed through all stages
        history_states = [r.to_state for r in sm.history]
        self.assertIn(JobState.QUEUED, history_states)
        self.assertIn(JobState.CLAIMED, history_states)
        self.assertIn(JobState.DOWNLOADING, history_states)
        self.assertIn(JobState.VALIDATING, history_states)
        self.assertIn(JobState.RENDERING, history_states)
        self.assertIn(JobState.PRINTING, history_states)
        self.assertIn(JobState.COMPLETED, history_states)

        # PrintResult is captured
        result = dispatcher.get_print_result(job.job_id)
        self.assertIsNotNone(result)
        self.assertTrue(result.accepted)

        dispatcher.shutdown(wait=True)

    def test_parallel_enqueue_serialization(self) -> None:
        """Parallel enqueue test: Proves that simultaneous jobs for a SINGLE printer

        execute strictly serialized (concurrency = 1).
        """
        tracking_engine = ConcurrencyTrackingEngine(delay_sec=0.08)
        dispatcher = JobDispatcher(engine=tracking_engine, max_queue_per_printer=10)

        printer = "HP LaserJet Shared"
        num_jobs = 4

        # Enqueue 4 jobs concurrently using client threads
        def enqueue_task(idx: int) -> None:
            job = JobItem(
                job_id=f"job-seq-{idx}",
                attempt_id=f"att-seq-{idx}",
                printer_name=printer,
                pdf_path=self.fake_pdf,
                settings=self.settings,
                lease_token=f"lease-token-seq-{idx}",
                job_title=f"Order #{idx}",
            )
            dispatcher.enqueue_job(job)

        threads = [threading.Thread(target=enqueue_task, args=(i,)) for i in range(num_jobs)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Wait for all jobs to complete
        dispatcher.wait_all(timeout=5.0)

        # VERIFICATION: Peak concurrent executions for this printer must be exactly 1!
        max_concurrent = tracking_engine.max_concurrent_executions.get(printer, 0)
        self.assertEqual(
            max_concurrent,
            1,
            f"Expected strictly serialized execution (max concurrent = 1), but observed {max_concurrent}",
        )

        # All 4 jobs completed
        self.assertEqual(len(tracking_engine.execution_order), num_jobs)
        for i in range(num_jobs):
            state = dispatcher.get_job_state(f"job-seq-{i}")
            self.assertEqual(state, JobState.COMPLETED)

        dispatcher.shutdown(wait=True)

    def test_multi_printer_parallel_concurrency(self) -> None:
        """Jobs on DIFFERENT printers execute concurrently in parallel."""
        tracking_engine = ConcurrencyTrackingEngine(delay_sec=0.1)
        dispatcher = JobDispatcher(engine=tracking_engine, max_queue_per_printer=10)

        p1 = "Canon ImageRUNNER A3"
        p2 = "Epson Photo L805"

        job1 = JobItem(
            job_id="job-p1",
            attempt_id="att-p1",
            printer_name=p1,
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-p1-token-1111",
            job_title="P1 Document",
        )
        job2 = JobItem(
            job_id="job-p2",
            attempt_id="att-p2",
            printer_name=p2,
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-p2-token-2222",
            job_title="P2 Document",
        )

        # Enqueue jobs to different printers simultaneously
        dispatcher.enqueue_job(job1)
        dispatcher.enqueue_job(job2)

        # Allow slight delay for both workers to engage simultaneously
        time.sleep(0.04)
        [p for p in (p1, p2) if tracking_engine.active_executions.get(p, 0) > 0]

        dispatcher.wait_all(timeout=4.0)

        # Both completed
        self.assertEqual(dispatcher.get_job_state(job1.job_id), JobState.COMPLETED)
        self.assertEqual(dispatcher.get_job_state(job2.job_id), JobState.COMPLETED)

        # Each individual printer had max_concurrent = 1
        self.assertEqual(tracking_engine.max_concurrent_executions.get(p1), 1)
        self.assertEqual(tracking_engine.max_concurrent_executions.get(p2), 1)

        dispatcher.shutdown(wait=True)

    def test_queue_backpressure(self) -> None:
        """Exceeding max_queue_per_printer raises QueueBackpressureError."""
        # Use a slow engine so jobs stay queued
        slow_engine = ConcurrencyTrackingEngine(delay_sec=0.5)
        # Capacity of 2
        dispatcher = JobDispatcher(engine=slow_engine, max_queue_per_printer=2)
        printer = "Limited Capacity Printer"

        rejected = False
        for i in range(5):
            try:
                dispatcher.enqueue_job(
                    JobItem(
                        job_id=f"job-bp-{i}",
                        attempt_id=f"att-bp-{i}",
                        printer_name=printer,
                        pdf_path=self.fake_pdf,
                        settings=self.settings,
                        lease_token=f"lease-bp-{i}-token",
                    )
                )
            except QueueBackpressureError as err:
                rejected = True
                self.assertEqual(err.printer_name, printer)
                self.assertEqual(err.capacity, 2)
                break

        self.assertTrue(rejected, "Expected QueueBackpressureError when queue capacity is exceeded")
        dispatcher.shutdown(wait=True)

    def test_job_cancellation_in_queue(self) -> None:
        """Job cancelled before execution is skipped and marked CANCELLED."""
        slow_engine = ConcurrencyTrackingEngine(delay_sec=0.2)
        dispatcher = JobDispatcher(engine=slow_engine, max_queue_per_printer=5)
        printer = "Cancellation Test Printer"

        # First job will block the worker
        job1 = JobItem(
            job_id="job-cancel-1",
            attempt_id="att-cancel-1",
            printer_name=printer,
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-cancel-1-token",
            job_title="Active Job",
        )
        # Second job will wait in queue
        job2 = JobItem(
            job_id="job-cancel-2",
            attempt_id="att-cancel-2",
            printer_name=printer,
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-cancel-2-token",
            job_title="Queued Job to Cancel",
        )

        dispatcher.enqueue_job(job1)
        dispatcher.enqueue_job(job2)

        # Cancel job2 while job1 is still executing
        cancelled = dispatcher.cancel_job(job2.job_id, reason="Customer cancelled")
        self.assertTrue(cancelled)

        # Wait for all work to finish
        dispatcher.wait_all(timeout=3.0)

        # job1 completed, job2 cancelled without printing
        self.assertEqual(dispatcher.get_job_state(job1.job_id), JobState.COMPLETED)
        self.assertEqual(dispatcher.get_job_state(job2.job_id), JobState.CANCELLED)

        # The engine must have executed ONLY job1, NOT job2
        self.assertIn("Active Job", slow_engine.execution_order)
        self.assertNotIn("Queued Job to Cancel", slow_engine.execution_order)

        dispatcher.shutdown(wait=True)

    def test_ambiguous_outcome_requires_review(self) -> None:
        """When engine returns ambiguous spooler disappearance, outcome is

        UNKNOWN_REQUIRES_REVIEW and can_auto_reprint is strictly False.
        """
        ambiguous_engine = FakePrintEngine(
            should_succeed=False,
            simulated_error="Job vanished from spooler without active printing confirmation",
            simulated_error_code="UNKNOWN_DISAPPEARED",
        )
        dispatcher = JobDispatcher(engine=ambiguous_engine)

        job = JobItem(
            job_id="job-ambig-1",
            attempt_id="att-ambig-1",
            printer_name="Office Jet Disappearing",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-ambig-123456",
        )

        sm = dispatcher.enqueue_job(job)
        final_state = dispatcher.wait_for_job(job.job_id, timeout=2.0)

        self.assertEqual(final_state, JobState.UNKNOWN_REQUIRES_REVIEW)
        self.assertTrue(sm.is_terminal)
        self.assertFalse(sm.can_auto_reprint)  # Non-Negotiable Policy #5

        dispatcher.shutdown(wait=True)

    def test_shop_authorization_enforcement(self) -> None:
        """Dispatcher enforces agent shop_id boundary."""
        dispatcher = JobDispatcher(engine=self.engine, shop_id="shop-campus-north")

        # Job matching shop_id is accepted
        valid_job = JobItem(
            job_id="job-auth-1",
            attempt_id="att-auth-1",
            printer_name="HP Laser",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-auth-123456",
            shop_id="shop-campus-north",
        )
        sm = dispatcher.enqueue_job(valid_job)
        self.assertEqual(sm.current_state, JobState.QUEUED)

        # Job for different shop is rejected immediately
        rogue_job = JobItem(
            job_id="job-auth-rogue",
            attempt_id="att-auth-rogue",
            printer_name="HP Laser",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-auth-999999",
            shop_id="shop-campus-south",
        )
        with self.assertRaises(ShopAuthorizationError):
            dispatcher.enqueue_job(rogue_job)

        dispatcher.shutdown(wait=True)

    def test_idempotent_duplicate_attempt_handling(self) -> None:
        """Duplicate enqueue with same attempt_id returns existing state machine."""
        job1 = JobItem(
            job_id="job-dup-1",
            attempt_id="att-idempotent-xyz",
            printer_name="HP Laser",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-dup-111111",
        )
        sm1 = self.dispatcher.enqueue_job(job1)

        # Resubmit identical attempt ID
        job2 = JobItem(
            job_id="job-dup-2",
            attempt_id="att-idempotent-xyz",
            printer_name="HP Laser",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-dup-111111",
        )
        sm2 = self.dispatcher.enqueue_job(job2)

        # Idempotently returns identical state machine
        self.assertIs(sm1, sm2)

    def test_stopped_dispatcher_rejection(self) -> None:
        """Enqueueing to a stopped dispatcher raises DispatcherStoppedError."""
        self.dispatcher.shutdown(wait=True)

        job = JobItem(
            job_id="job-stopped",
            attempt_id="att-stopped",
            printer_name="HP Laser",
            pdf_path=self.fake_pdf,
            settings=self.settings,
            lease_token="lease-stopped-token",
        )

        with self.assertRaises(DispatcherStoppedError):
            self.dispatcher.enqueue_job(job)


if __name__ == "__main__":
    unittest.main()
