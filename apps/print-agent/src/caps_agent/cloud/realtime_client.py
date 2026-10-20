"""Realtime listener and atomic claim coordinator for CAPS Print Agent.

Provides low-latency event-driven job execution conforming to CAPS architecture:
- Outbound-only WSS/Realtime connectivity
- Non-Negotiable Policy #5: Realtime messages are wake-up signals, NOT ownership claims
- Atomic HTTP claim handshake with lease duration and attempt tracking
- Per-printer serialized execution via JobDispatcher
- Long-disconnect reconciliation: catches up on missed jobs upon reconnect or interval
- Tenant isolation: strictly rejects signals for foreign shops
- Deduplication of replayed wake-up signals
- Zero document content or sensitive auth token logging
"""

from __future__ import annotations

import contextlib
import logging
import os
import queue
import random
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from caps_agent.auth.credentials import AgentCredentials
from caps_agent.cloud.api_client import (
    AuthenticationError,
    CloudApiClient,
    CloudApiError,
    JobClaimResponse,
    TenantMismatchError,
)
from caps_agent.jobs.dispatcher import JobDispatcher, JobItem
from caps_agent.jobs.state_machine import JobState, JobStateMachine
from caps_agent.printing.engine import PrintSettings

logger = logging.getLogger("caps_agent.cloud.realtime_client")


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class RealtimeError(CloudApiError):
    """Base exception for realtime communication and listener errors."""

    def __init__(self, message: str, error_code: str = "REALTIME_ERROR"):
        super().__init__(message, error_code=error_code)


class RealtimeConnectionError(RealtimeError):
    """Raised when realtime connection fails, is dropped, or cannot be established."""

    def __init__(self, message: str = "Realtime connection failed"):
        super().__init__(message, error_code="REALTIME_CONNECTION_ERROR")


class RealtimeAuthError(RealtimeError):
    """Raised when realtime handshake is rejected due to invalid credentials."""

    def __init__(self, message: str = "Realtime authentication rejected"):
        super().__init__(message, error_code="REALTIME_AUTH_ERROR")


# ==============================================================================
# Wake-Up Event Model
# ==============================================================================


@dataclass(frozen=True)
class RealtimeWakeEvent:
    """Represents a wake-up notification received over the realtime channel.

    NOTE: This is strictly an advisory wake-up signal; it confers NO claim
    or authorization to print without an explicit HTTP atomic claim handshake.
    """

    event_type: str
    shop_id: str
    job_id: str | None = None
    timestamp: str = ""
    raw_payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RealtimeWakeEvent:
        """Parse raw event payload into structured RealtimeWakeEvent."""
        event_type = data.get("event") or data.get("event_type") or data.get("type", "unknown")
        shop_id = data.get("shop_id") or ""
        job_id = data.get("job_id")
        ts = data.get("timestamp") or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Support Supabase Realtime CDC payload structure (record/new)
        record = data.get("record") or data.get("new") or {}
        if isinstance(record, dict):
            shop_id = shop_id or record.get("shop_id", "")
            job_id = job_id or record.get("id") or record.get("job_id")

        return cls(
            event_type=event_type,
            shop_id=shop_id,
            job_id=job_id,
            timestamp=ts,
            raw_payload=data,
        )


# ==============================================================================
# Realtime Transport Protocol & Mocks
# ==============================================================================


@runtime_checkable
class RealtimeTransport(Protocol):
    """Protocol abstracting wire-level WebSocket/SSE realtime communication."""

    def connect(self, url: str, headers: dict[str, str], timeout: float = 10.0) -> None:
        """Establish outbound realtime channel."""
        ...

    def disconnect(self) -> None:
        """Close realtime channel gracefully."""
        ...

    def is_connected(self) -> bool:
        """Return True if connection is currently active."""
        ...

    def receive_event(self, timeout: float = 1.0) -> dict[str, Any] | None:
        """Receive the next incoming event, or None if timeout expired."""
        ...

    def send_ping(self) -> None:
        """Send heartbeat ping frame."""
        ...


class MockRealtimeTransport:
    """Deterministic in-memory realtime transport for testing and local development."""

    def __init__(self) -> None:
        self.connected = False
        self.connected_url: str | None = None
        self.connected_headers: dict[str, str] = {}
        self.connect_error: Exception | None = None
        self._event_queue: queue.Queue[dict[str, Any] | Exception] = queue.Queue()
        self.ping_count = 0

    def connect(self, url: str, headers: dict[str, str], timeout: float = 10.0) -> None:
        if self.connect_error:
            err = self.connect_error
            self.connect_error = None
            raise err
        self.connected = True
        self.connected_url = url
        self.connected_headers = dict(headers)

    def disconnect(self) -> None:
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected

    def push_event(self, event_data: dict[str, Any]) -> None:
        """Enqueue an event to be received by the client."""
        self._event_queue.put(event_data)

    def push_error(self, exc: Exception) -> None:
        """Enqueue a transport exception."""
        self._event_queue.put(exc)

    def receive_event(self, timeout: float = 1.0) -> dict[str, Any] | None:
        if not self.connected:
            return None
        try:
            item = self._event_queue.get(timeout=timeout)
            if isinstance(item, Exception):
                raise item
            return item
        except queue.Empty:
            return None

    def send_ping(self) -> None:
        self.ping_count += 1


class SimulatedWebSocketTransport:
    """Fallback transport simulating a stable realtime listener."""

    def __init__(self) -> None:
        self.connected = False
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue()

    def connect(self, url: str, headers: dict[str, str], timeout: float = 10.0) -> None:
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False

    def is_connected(self) -> bool:
        return self.connected

    def receive_event(self, timeout: float = 1.0) -> dict[str, Any] | None:
        if not self.connected:
            return None
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def send_ping(self) -> None:
        pass


# ==============================================================================
# Settings Mapping Helper
# ==============================================================================


def map_claim_settings_to_print_settings(raw_settings: dict[str, Any]) -> PrintSettings:
    """Map Cloud API settings dictionary to internal PrintSettings dataclass."""
    raw_color = str(raw_settings.get("color_mode", "monochrome")).lower()
    color_mode = "bw" if raw_color in ("monochrome", "bw", "grayscale") else "color"

    raw_duplex = raw_settings.get("duplex", "simplex")
    if isinstance(raw_duplex, bool):
        duplex_val = "duplex_long" if raw_duplex else "simplex"
    elif isinstance(raw_duplex, str):
        duplex_val = raw_duplex.lower()
    else:
        duplex_val = "simplex"

    return PrintSettings(
        paper_size=str(raw_settings.get("paper_size", "a4")).lower(),
        color_mode=color_mode,
        duplex=duplex_val,
        copies=int(raw_settings.get("copies", 1)),
        page_range=str(raw_settings.get("page_range", "all")),
        orientation=str(raw_settings.get("orientation", "portrait")).lower(),
        binding=raw_settings.get("binding"),
    )


# ==============================================================================
# Realtime Listener & Atomic Claim Coordinator
# ==============================================================================


class RealtimeClaimCoordinator:
    """Coordinates realtime wake-up signals with atomic HTTP claims and serialized dispatching.

    Architecture Invariants:
    1. Realtime messages are wake-up signals, NEVER ownership claims (Policy #5).
    2. Jobs are claimed atomically via HTTP POST /api/v1/agent/jobs/claim with active leases.
    3. Per-printer execution is serialized strictly via JobDispatcher.
    4. Disconnections automatically trigger exponential backoff reconnection.
    5. Reconnection triggers reconciliation to drain any jobs approved while offline.
    6. Mismatched shop events are strictly rejected (Tenant Isolation).
    """

    def __init__(
        self,
        api_client: CloudApiClient,
        dispatcher: JobDispatcher,
        credentials: AgentCredentials,
        realtime_url: str,
        transport: RealtimeTransport | None = None,
        temp_dir: Path | str | None = None,
        default_printer: str = "DefaultPrinter",
        reconciliation_interval: float = 30.0,
        backoff_initial: float = 0.5,
        backoff_max: float = 30.0,
        lease_duration_seconds: int = 90,
    ) -> None:
        self.api_client = api_client
        self.dispatcher = dispatcher
        self.credentials = credentials
        self.realtime_url = realtime_url
        self.transport = transport or SimulatedWebSocketTransport()
        self.temp_dir = Path(temp_dir or os.environ.get("TEMP", "/tmp")) / "caps_spool"
        self.default_printer = default_printer
        self.reconciliation_interval = reconciliation_interval
        self.backoff_initial = backoff_initial
        self.backoff_max = backoff_max
        self.lease_duration_seconds = lease_duration_seconds

        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._worker_thread: threading.Thread | None = None
        self._recent_events: dict[str, float] = {}  # key -> timestamp for deduplication
        self._claimed_attempts: set[str] = set()

        # Wire dispatcher status changes to Cloud API updates
        self._wire_dispatcher_status_sync()

    def _wire_dispatcher_status_sync(self) -> None:
        """Register listener on dispatcher to report state transitions back to Cloud API."""

        def _on_state_change(sm: JobStateMachine, state: JobState) -> None:
            # Map internal JobState to Cloud API allowed status strings
            status_map = {
                JobState.PRINTING: "printing",
                JobState.COMPLETED: "completed",
                JobState.FAILED: "failed",
                JobState.UNKNOWN_REQUIRES_REVIEW: "requires_review",
            }
            target_status = status_map.get(state)
            if target_status:
                spooler_job_id = None
                print_res = self.dispatcher.get_print_result(sm.job_id)
                if print_res and print_res.spooler_job_id is not None:
                    spooler_job_id = print_res.spooler_job_id

                failure_reason = None
                if sm.history and sm.history[-1].reason:
                    failure_reason = sm.history[-1].reason

                try:
                    self.api_client.update_job_status(
                        job_id=sm.job_id,
                        attempt_id=sm.attempt_id,
                        status=target_status,
                        spooler_job_id=spooler_job_id,
                        error_message=failure_reason,
                    )
                    logger.debug("Synced status '%s' for job '%s' to Cloud API", target_status, sm.job_id)
                except Exception as err:
                    logger.warning("Failed to sync status '%s' for job '%s' to Cloud API: %s", target_status, sm.job_id, err)

        self.dispatcher.add_status_listener(_on_state_change)

    # ==========================================================================
    # Atomic Claim & Dispatch Execution
    # ==========================================================================

    def claim_and_dispatch_next(self) -> JobClaimResponse | None:
        """Atomically claim the next approved job from the Cloud API and dispatch it.

        Returns:
            JobClaimResponse if a job was successfully claimed and enqueued, or
            None if no job was available (or claimed by a competing agent).
        """
        with self._lock:
            try:
                claim = self.api_client.claim_job(lease_duration_seconds=self.lease_duration_seconds)
            except TenantMismatchError:
                logger.error("Tenant authorization mismatch claiming job; aborting claim")
                return None
            except AuthenticationError as auth_err:
                logger.error("Authentication failed claiming job: %s", auth_err)
                return None
            except CloudApiError as api_err:
                logger.warning("Cloud API claim returned error: %s", api_err)
                return None

            if claim is None:
                return None

            # Deduplicate locally claimed attempt IDs
            if claim.attempt_id in self._claimed_attempts:
                logger.warning("Attempt '%s' was already claimed locally; skipping", claim.attempt_id)
                return claim
            self._claimed_attempts.add(claim.attempt_id)

            logger.info("Atomically claimed Job '%s' (Attempt '%s', Lease '%s')", claim.job_id, claim.attempt_id, claim.lease_id)

            # Update status to 'downloading'
            try:
                self.api_client.update_job_status(
                    job_id=claim.job_id,
                    attempt_id=claim.attempt_id,
                    status="downloading",
                )
            except Exception as err:
                logger.warning("Failed to update status to 'downloading' for job '%s': %s", claim.job_id, err)

            # Stream PDF to local temp directory
            job_temp_dir = self.temp_dir / f"job_{claim.job_id}"
            pdf_path = job_temp_dir / f"{claim.job_id}.pdf"
            try:
                self.api_client.download_document(
                    download_url=claim.download_url,
                    destination_path=pdf_path,
                    expected_sha256=claim.checksum_sha256,
                )
            except Exception as dl_err:
                logger.error("Failed to download document for job '%s': %s", claim.job_id, dl_err)
                with contextlib.suppress(Exception):
                    self.api_client.update_job_status(
                        job_id=claim.job_id,
                        attempt_id=claim.attempt_id,
                        status="failed",
                        error_message=f"Document download failed: {dl_err}",
                    )
                return None

            # Resolve printer name
            printer_name = claim.settings.get("printer_name") or self.default_printer
            print_settings = map_claim_settings_to_print_settings(claim.settings)

            job_item = JobItem(
                job_id=claim.job_id,
                attempt_id=claim.attempt_id,
                printer_name=printer_name,
                pdf_path=pdf_path,
                settings=print_settings,
                lease_token=claim.lease_id,
                shop_id=self.credentials.shop_id,
                job_title=f"CAPS Job {claim.job_id[:8]}",
            )

            # Enqueue into per-printer serialized dispatcher
            try:
                self.dispatcher.enqueue_job(job_item)
                logger.info("Dispatched Job '%s' to printer queue '%s'", claim.job_id, printer_name)
            except Exception as enq_err:
                logger.error("Failed to enqueue job '%s' to dispatcher: %s", claim.job_id, enq_err)
                with contextlib.suppress(Exception):
                    self.api_client.update_job_status(
                        job_id=claim.job_id,
                        attempt_id=claim.attempt_id,
                        status="failed",
                        error_message=f"Dispatcher enqueue failed: {enq_err}",
                    )
                return None

            return claim

    def reconcile_backlog(self) -> list[str]:
        """Drain all pending approved jobs currently queued in the Cloud API.

        Guarantees that missed realtime events or offline periods do not cause
        lost print jobs. Returns the list of successfully claimed job IDs.
        """
        claimed_ids: list[str] = []
        logger.debug("Executing backlog reconciliation sweep...")

        while not self._stop_event.is_set():
            claim = self.claim_and_dispatch_next()
            if claim is None:
                break
            claimed_ids.append(claim.job_id)

        if claimed_ids:
            logger.info("Reconciliation sweep claimed %d pending jobs: %s", len(claimed_ids), claimed_ids)
        return claimed_ids

    # ==========================================================================
    # Wake-Up Signal Processing & Deduplication
    # ==========================================================================

    def handle_event(self, event_data: dict[str, Any]) -> bool:
        """Process incoming wake-up notification.

        Returns True if the event was accepted and triggered a claim sweep, False otherwise.
        """
        try:
            event = RealtimeWakeEvent.from_dict(event_data)
        except Exception as err:
            logger.warning("Discarding malformed realtime event: %s", err)
            return False

        # Tenant Isolation Check: strictly reject foreign shop events
        if event.shop_id and event.shop_id != self.credentials.shop_id:
            logger.warning(
                "Tenant mismatch: Dropping wake-up event for shop '%s' (Agent paired to '%s')",
                event.shop_id,
                self.credentials.shop_id,
            )
            return False

        # Deduplication check for rapid event bursts
        dedup_key = f"{event.shop_id}:{event.job_id}:{event.event_type}"
        now = time.monotonic()

        # Clean old deduplication records (> 60 seconds)
        with self._lock:
            expired_keys = [k for k, t in self._recent_events.items() if now - t > 60.0]
            for k in expired_keys:
                del self._recent_events[k]

            if dedup_key in self._recent_events and now - self._recent_events[dedup_key] < 2.0:
                logger.debug("Suppressed duplicate wake-up event within 2.0s: %s", dedup_key)
                return False

            self._recent_events[dedup_key] = now

        logger.info("Received valid wake-up signal: event='%s', job='%s'", event.event_type, event.job_id)

        # Trigger immediate atomic claim & backlog drain
        self.reconcile_backlog()
        return True

    # ==========================================================================
    # Background Listener & Connection Management
    # ==========================================================================

    def start(self) -> None:
        """Start the background listener thread."""
        with self._lock:
            if self._worker_thread is not None and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._run_loop,
                name="RealtimeListenerWorker",
                daemon=True,
            )
            self._worker_thread.start()
            logger.info("RealtimeClaimCoordinator background worker started")

    def stop(self, wait: bool = True) -> None:
        """Stop background worker and disconnect transport."""
        self._stop_event.set()
        with self._lock:
            if self.transport.is_connected():
                with contextlib.suppress(Exception):
                    self.transport.disconnect()

        if wait and self._worker_thread is not None:
            self._worker_thread.join(timeout=5.0)
            logger.info("RealtimeClaimCoordinator background worker stopped")

    @property
    def is_running(self) -> bool:
        """Return True if background worker is actively running."""
        return self._worker_thread is not None and self._worker_thread.is_alive()

    def _build_connection_headers(self) -> dict[str, str]:
        """Build authenticated connection headers."""
        return {
            "Authorization": f"Bearer {self.credentials.device_token}",
            "X-CAPS-Device-Id": self.credentials.device_id,
            "X-CAPS-Shop-Id": self.credentials.shop_id,
            "User-Agent": "CAPS-Print-Agent-Realtime/0.1.0",
        }

    def _run_loop(self) -> None:
        """Main listener loop handling connection, events, backoff, and reconciliation."""
        attempt = 0
        last_reconciliation = time.monotonic()

        while not self._stop_event.is_set():
            # 1. Connect if not connected
            if not self.transport.is_connected():
                attempt += 1
                try:
                    headers = self._build_connection_headers()
                    self.transport.connect(self.realtime_url, headers=headers)
                    logger.info("Connected to Realtime service at %s", self.realtime_url)
                    attempt = 0  # Reset backoff on successful connect

                    # Always reconcile upon (re)connect to catch up on missed jobs
                    self.reconcile_backlog()
                    last_reconciliation = time.monotonic()

                except Exception as conn_err:
                    sleep_sec = min(
                        self.backoff_max,
                        (self.backoff_initial * (2 ** (attempt - 1))) + random.uniform(0.05, 0.2),
                    )
                    logger.warning(
                        "Realtime connection attempt %d failed: %s; retrying in %.2fs",
                        attempt,
                        conn_err,
                        sleep_sec,
                    )
                    self._stop_event.wait(timeout=sleep_sec)
                    continue

            # 2. Receive and process events
            try:
                event_data = self.transport.receive_event(timeout=1.0)
                if event_data:
                    self.handle_event(event_data)

                # Periodic reconciliation sweep (fallback for missed/dropped frames)
                now = time.monotonic()
                if now - last_reconciliation >= self.reconciliation_interval:
                    self.reconcile_backlog()
                    last_reconciliation = now

            except Exception as recv_err:
                logger.warning("Realtime receive error: %s; disconnecting to trigger reconnect", recv_err)
                with contextlib.suppress(Exception):
                    self.transport.disconnect()


# Alias for clean export
RealtimeClient = RealtimeClaimCoordinator
