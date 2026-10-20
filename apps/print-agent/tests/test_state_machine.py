"""Unit and contract tests for Desktop Agent JobStateMachine.

Tests cover:
- Valid linear lifecycle transitions (QUEUED -> CLAIMED -> DOWNLOADING -> VALIDATING -> RENDERING -> PRINTING -> COMPLETED)
- Terminal state immutability (TerminalStateError when attempting transition out of COMPLETED/FAILED/CANCELLED/UNKNOWN)
- Invalid transition rejections (InvalidStateTransitionError on illegal jumps)
- Cancellation from non-terminal states
- Failure transitions with error_code and reason recording
- Ambiguous spooler outcome transition to UNKNOWN_REQUIRES_REVIEW
- Strict Non-Negotiable Policy #5 enforcement (can_auto_reprint=False)
- Contract mapping to frozen print-contracts JobAgentStatus enum
- Audit trail and transition history logging
"""

from __future__ import annotations

import unittest

from caps_agent.jobs.state_machine import (
    InvalidStateTransitionError,
    JobState,
    JobStateMachine,
    TerminalStateError,
)


class TestJobStateMachineTransitions(unittest.TestCase):
    """Verifies formal transition rules and audit history."""

    def setUp(self) -> None:
        self.job_id = "job-uuid-111"
        self.attempt_id = "attempt-aaa-1"
        self.sm = JobStateMachine(job_id=self.job_id, attempt_id=self.attempt_id)

    def test_initial_state(self) -> None:
        self.assertEqual(self.sm.current_state, JobState.QUEUED)
        self.assertFalse(self.sm.is_terminal)
        self.assertFalse(self.sm.can_auto_reprint)  # Policy #5
        self.assertEqual(len(self.sm.history), 1)
        self.assertEqual(self.sm.history[0].to_state, JobState.QUEUED)
        self.assertEqual(self.sm.to_contract_agent_status(), "CLAIMED")

    def test_happy_path_lifecycle(self) -> None:
        """QUEUED -> CLAIMED -> DOWNLOADING -> VALIDATING -> RENDERING -> PRINTING -> COMPLETED."""
        self.sm.transition_to(JobState.CLAIMED, reason="Lease acquired from Cloud API")
        self.assertEqual(self.sm.current_state, JobState.CLAIMED)
        self.assertEqual(self.sm.to_contract_agent_status(), "CLAIMED")

        self.sm.transition_to(JobState.DOWNLOADING, reason="Fetching PDF payload")
        self.assertEqual(self.sm.current_state, JobState.DOWNLOADING)
        self.assertEqual(self.sm.to_contract_agent_status(), "DOWNLOADING")

        self.sm.transition_to(JobState.VALIDATING, reason="Validating checksum and page count")
        self.assertEqual(self.sm.current_state, JobState.VALIDATING)
        self.assertEqual(self.sm.to_contract_agent_status(), "RENDERING")

        self.sm.transition_to(JobState.RENDERING, reason="Rasterizing PDF pages to bitmaps")
        self.assertEqual(self.sm.current_state, JobState.RENDERING)
        self.assertEqual(self.sm.to_contract_agent_status(), "RENDERING")

        self.sm.transition_to(JobState.PRINTING, reason="Submitting to Windows Spooler")
        self.assertEqual(self.sm.current_state, JobState.PRINTING)
        self.assertEqual(self.sm.to_contract_agent_status(), "PRINTING")

        self.sm.transition_to(
            JobState.COMPLETED,
            reason="Spooler job completed successfully",
            details={"spooler_job_id": 5001, "pages_printed": 2},
        )
        self.assertEqual(self.sm.current_state, JobState.COMPLETED)
        self.assertTrue(self.sm.is_terminal)
        self.assertFalse(self.sm.can_auto_reprint)
        self.assertEqual(self.sm.to_contract_agent_status(), "COMPLETED")

        # History records initial state + 6 transitions = 7 entries
        self.assertEqual(len(self.sm.history), 7)
        self.assertEqual(self.sm.history[-1].details.get("spooler_job_id"), 5001)

    def test_terminal_state_locked(self) -> None:
        """Terminal states prohibit any further state transitions."""
        # Fast transition to COMPLETED
        self.sm.transition_to(JobState.VALIDATING)
        self.sm.transition_to(JobState.RENDERING)
        self.sm.transition_to(JobState.PRINTING)
        self.sm.transition_to(JobState.COMPLETED)

        self.assertTrue(self.sm.is_terminal)

        with self.assertRaises(TerminalStateError) as ctx:
            self.sm.transition_to(JobState.PRINTING)
        self.assertEqual(ctx.exception.error_code, "TERMINAL_STATE_LOCKED")

        with self.assertRaises(TerminalStateError):
            self.sm.transition_to(JobState.FAILED)

    def test_invalid_transitions_rejected(self) -> None:
        """Jumping states or reversing flow is strictly rejected."""
        # Cannot jump from QUEUED directly to PRINTING
        with self.assertRaises(InvalidStateTransitionError) as ctx:
            self.sm.transition_to(JobState.PRINTING)
        self.assertEqual(ctx.exception.from_state, JobState.QUEUED)
        self.assertEqual(ctx.exception.to_state, JobState.PRINTING)

        # Cannot jump from QUEUED directly to COMPLETED
        with self.assertRaises(InvalidStateTransitionError):
            self.sm.transition_to(JobState.COMPLETED)

    def test_cancellation_from_queued_and_in_progress_states(self) -> None:
        """Job can be cancelled from QUEUED, CLAIMED, DOWNLOADING, VALIDATING, RENDERING."""
        # 1. From QUEUED
        sm1 = JobStateMachine("job-1", "att-1")
        sm1.transition_to(JobState.CANCELLED, reason="Cancelled in queue")
        self.assertEqual(sm1.current_state, JobState.CANCELLED)
        self.assertTrue(sm1.is_terminal)

        # 2. From VALIDATING
        sm2 = JobStateMachine("job-2", "att-2")
        sm2.transition_to(JobState.VALIDATING)
        sm2.transition_to(JobState.CANCELLED, reason="Owner aborted job")
        self.assertEqual(sm2.current_state, JobState.CANCELLED)

        # 3. From RENDERING
        sm3 = JobStateMachine("job-3", "att-3")
        sm3.transition_to(JobState.VALIDATING)
        sm3.transition_to(JobState.RENDERING)
        sm3.transition_to(JobState.CANCELLED, reason="Out of ink detected before spool")
        self.assertEqual(sm3.current_state, JobState.CANCELLED)

    def test_failure_transition(self) -> None:
        """Failure can be reached from any active state upon error."""
        self.sm.transition_to(JobState.VALIDATING)
        self.sm.transition_to(
            JobState.FAILED,
            reason="PDF corrupted: invalid xref table",
            error_code="DOCUMENT_CORRUPTED",
        )
        self.assertEqual(self.sm.current_state, JobState.FAILED)
        self.assertTrue(self.sm.is_terminal)
        self.assertFalse(self.sm.can_auto_reprint)  # Policy #5
        self.assertEqual(self.sm.to_contract_agent_status(), "FAILED")

    def test_ambiguous_outcome_requires_review(self) -> None:
        """Ambiguous/disappearing spooler job transitions to UNKNOWN_REQUIRES_REVIEW."""
        self.sm.transition_to(JobState.VALIDATING)
        self.sm.transition_to(JobState.RENDERING)
        self.sm.transition_to(JobState.PRINTING)
        self.sm.transition_to(
            JobState.UNKNOWN_REQUIRES_REVIEW,
            reason="Spooler job vanished without active printing confirmation",
            error_code="UNKNOWN_DISAPPEARED",
        )
        self.assertEqual(self.sm.current_state, JobState.UNKNOWN_REQUIRES_REVIEW)
        self.assertTrue(self.sm.is_terminal)
        self.assertFalse(self.sm.can_auto_reprint)  # Strict Policy #5
        self.assertEqual(self.sm.to_contract_agent_status(), "FAILED")

    def test_can_transition_to_predicate(self) -> None:
        self.assertTrue(self.sm.can_transition_to(JobState.CLAIMED))
        self.assertTrue(self.sm.can_transition_to(JobState.CANCELLED))
        self.assertFalse(self.sm.can_transition_to(JobState.PRINTING))
        self.assertFalse(self.sm.can_transition_to(JobState.COMPLETED))

        self.sm.transition_to(JobState.CANCELLED)
        # Terminal state returns False for all
        self.assertFalse(self.sm.can_transition_to(JobState.COMPLETED))
        self.assertFalse(self.sm.can_transition_to(JobState.FAILED))

    def test_serialization_dict(self) -> None:
        self.sm.transition_to(JobState.VALIDATING)
        data = self.sm.to_dict()
        self.assertEqual(data["job_id"], self.job_id)
        self.assertEqual(data["attempt_id"], self.attempt_id)
        self.assertEqual(data["current_state"], JobState.VALIDATING.value)
        self.assertEqual(data["contract_status"], "RENDERING")
        self.assertFalse(data["is_terminal"])
        self.assertFalse(data["can_auto_reprint"])
        self.assertEqual(len(data["history"]), 2)


if __name__ == "__main__":
    unittest.main()
