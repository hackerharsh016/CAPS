"""Desktop Agent Job Execution State Machine.

Defines the formal local lifecycle, valid state transitions, audit history,
and strict non-reprint policies for CAPS Print Agent jobs (Phase 02, Module 03).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

logger = logging.getLogger("caps_agent.jobs.state_machine")


# ==============================================================================
# Job States
# ==============================================================================


class JobState(StrEnum):
    """Formal lifecycle states for agent print job execution."""

    QUEUED = "QUEUED"
    CLAIMED = "CLAIMED"
    DOWNLOADING = "DOWNLOADING"
    VALIDATING = "VALIDATING"
    RENDERING = "RENDERING"
    PRINTING = "PRINTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    UNKNOWN_REQUIRES_REVIEW = "UNKNOWN_REQUIRES_REVIEW"


# Terminal states cannot be transitioned away from
TERMINAL_STATES: frozenset[JobState] = frozenset({
    JobState.COMPLETED,
    JobState.FAILED,
    JobState.CANCELLED,
    JobState.UNKNOWN_REQUIRES_REVIEW,
})


# Formal allowed transition graph
ALLOWED_TRANSITIONS: dict[JobState, frozenset[JobState]] = {
    JobState.QUEUED: frozenset({
        JobState.CLAIMED,
        JobState.DOWNLOADING,
        JobState.VALIDATING,
        JobState.CANCELLED,
        JobState.FAILED,
    }),
    JobState.CLAIMED: frozenset({
        JobState.DOWNLOADING,
        JobState.VALIDATING,
        JobState.CANCELLED,
        JobState.FAILED,
    }),
    JobState.DOWNLOADING: frozenset({
        JobState.VALIDATING,
        JobState.CANCELLED,
        JobState.FAILED,
    }),
    JobState.VALIDATING: frozenset({
        JobState.RENDERING,
        JobState.CANCELLED,
        JobState.FAILED,
    }),
    JobState.RENDERING: frozenset({
        JobState.PRINTING,
        JobState.CANCELLED,
        JobState.FAILED,
    }),
    JobState.PRINTING: frozenset({
        JobState.COMPLETED,
        JobState.FAILED,
        JobState.UNKNOWN_REQUIRES_REVIEW,
    }),
    # Terminal states have no outgoing transitions
    JobState.COMPLETED: frozenset(),
    JobState.FAILED: frozenset(),
    JobState.CANCELLED: frozenset(),
    JobState.UNKNOWN_REQUIRES_REVIEW: frozenset(),
}


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class StateMachineError(Exception):
    """Base exception for all state machine violations."""

    def __init__(self, message: str, error_code: str = "STATE_MACHINE_ERROR"):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class InvalidStateTransitionError(StateMachineError):
    """Raised when an illegal state transition is attempted."""

    def __init__(self, from_state: JobState, to_state: JobState, job_id: str):
        msg = (
            f"Invalid state transition for job '{job_id}': "
            f"cannot move from {from_state.value} to {to_state.value}."
        )
        super().__init__(msg, error_code="INVALID_STATE_TRANSITION")
        self.from_state = from_state
        self.to_state = to_state
        self.job_id = job_id


class TerminalStateError(StateMachineError):
    """Raised when attempting to transition out of a terminal state."""

    def __init__(self, current_state: JobState, target_state: JobState, job_id: str):
        msg = (
            f"Job '{job_id}' is in terminal state '{current_state.value}'; "
            f"transition to '{target_state.value}' is prohibited."
        )
        super().__init__(msg, error_code="TERMINAL_STATE_LOCKED")
        self.current_state = current_state
        self.target_state = target_state
        self.job_id = job_id


# ==============================================================================
# State Transition Audit Record
# ==============================================================================


@dataclass(frozen=True)
class StateTransitionRecord:
    """Immutable audit entry for a state transition."""

    from_state: JobState
    to_state: JobState
    timestamp: datetime
    reason: str | None = None
    error_code: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "from_state": self.from_state.value,
            "to_state": self.to_state.value,
            "timestamp": self.timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "reason": self.reason,
            "error_code": self.error_code,
            "details": self.details,
        }


# ==============================================================================
# State Machine Controller
# ==============================================================================


class JobStateMachine:
    """Manages state transitions and lifecycle validation for a single print job."""

    def __init__(
        self,
        job_id: str,
        attempt_id: str,
        initial_state: JobState = JobState.QUEUED,
    ) -> None:
        self.job_id = job_id
        self.attempt_id = attempt_id
        self._current_state = initial_state
        self._history: list[StateTransitionRecord] = []
        self._created_at = datetime.now(UTC)

        # Record initial state creation
        self._history.append(
            StateTransitionRecord(
                from_state=initial_state,
                to_state=initial_state,
                timestamp=self._created_at,
                reason="Job initialized in state machine",
            )
        )

    @property
    def current_state(self) -> JobState:
        return self._current_state

    @property
    def is_terminal(self) -> bool:
        return self._current_state in TERMINAL_STATES

    @property
    def can_auto_reprint(self) -> bool:
        """Enforces Non-Negotiable Policy #5.

        Spooler submission does not prove physical printing;
        unknown and failed outcomes MUST NOT auto-reprint.
        """
        return False

    @property
    def history(self) -> list[StateTransitionRecord]:
        return list(self._history)

    def can_transition_to(self, target_state: JobState) -> bool:
        """Check if transition to target_state is formally allowed."""
        if self.is_terminal:
            return False
        return target_state in ALLOWED_TRANSITIONS.get(self._current_state, frozenset())

    def transition_to(
        self,
        new_state: JobState,
        reason: str | None = None,
        error_code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Transition job to a new state after validating transition rules."""
        if self._current_state == new_state:
            logger.debug("Job '%s' already in state %s; no-op.", self.job_id, new_state.value)
            return

        if self.is_terminal:
            raise TerminalStateError(self._current_state, new_state, self.job_id)

        allowed = ALLOWED_TRANSITIONS.get(self._current_state, frozenset())
        if new_state not in allowed:
            raise InvalidStateTransitionError(self._current_state, new_state, self.job_id)

        old_state = self._current_state
        self._current_state = new_state
        timestamp = datetime.now(UTC)

        record = StateTransitionRecord(
            from_state=old_state,
            to_state=new_state,
            timestamp=timestamp,
            reason=reason,
            error_code=error_code,
            details=details or {},
        )
        self._history.append(record)

        logger.info(
            "Job '%s' (attempt '%s') transitioned: %s -> %s%s",
            self.job_id,
            self.attempt_id,
            old_state.value,
            new_state.value,
            f" ({reason})" if reason else "",
        )

    def to_contract_agent_status(self) -> str:
        """Map local agent state to frozen packages/print-contracts JobAgentStatus enum.

        JobAgentStatus: ["CLAIMED", "DOWNLOADING", "RENDERING", "PRINTING", "COMPLETED", "FAILED"]
        """
        match self._current_state:
            case JobState.QUEUED | JobState.CLAIMED:
                return "CLAIMED"
            case JobState.DOWNLOADING:
                return "DOWNLOADING"
            case JobState.VALIDATING | JobState.RENDERING:
                return "RENDERING"
            case JobState.PRINTING:
                return "PRINTING"
            case JobState.COMPLETED:
                return "COMPLETED"
            case JobState.FAILED | JobState.CANCELLED | JobState.UNKNOWN_REQUIRES_REVIEW:
                return "FAILED"
            case _:
                return "FAILED"

    def to_dict(self) -> dict[str, Any]:
        """Convert state machine status to a JSON-serializable dictionary."""
        return {
            "job_id": self.job_id,
            "attempt_id": self.attempt_id,
            "current_state": self._current_state.value,
            "contract_status": self.to_contract_agent_status(),
            "is_terminal": self.is_terminal,
            "can_auto_reprint": self.can_auto_reprint,
            "history": [r.to_dict() for r in self._history],
        }
