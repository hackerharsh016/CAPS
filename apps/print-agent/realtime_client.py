"""Desktop Agent Realtime WebSocket Client & Wakeup Wire (INT-D4-03).

Connects Print Agent to Supabase Realtime or Cloud API gateway over WebSocket/WSS:
- Authenticated handshake and channel subscription on `caps:shop:<shopId>`
- Low-latency event listening for `job.approved` and `job.created`
- Immediate wake-up triggering `Coordinator.poll_and_execute_now()`
- Exponential backoff reconnection with jitter (1s, 2s, 4s, ..., max 30s)
- Tenant isolation strictly rejecting foreign shop events
- Resilient non-blocking daemon thread execution: disconnections never crash the agent process
"""

from __future__ import annotations

import json
import logging
import queue
import random
import threading
import time
from collections.abc import Callable
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger("caps_agent.realtime_client")

# Default backoff parameters
DEFAULT_BASE_BACKOFF = 1.0
DEFAULT_MAX_BACKOFF = 30.0
DEFAULT_JITTER = 0.5
DEFAULT_WS_TIMEOUT = 10.0


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class RealtimeError(Exception):
    """Base exception for realtime client operations."""

    def __init__(self, message: str, error_code: str = "REALTIME_ERROR") -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class RealtimeConnectionError(RealtimeError):
    """Raised when realtime connection fails, is dropped, or cannot be established."""

    def __init__(self, message: str = "Realtime connection failed") -> None:
        super().__init__(message, error_code="REALTIME_CONNECTION_ERROR")


class RealtimeAuthError(RealtimeError):
    """Raised when realtime handshake is rejected due to invalid credentials."""

    def __init__(self, message: str = "Realtime authentication rejected") -> None:
        super().__init__(message, error_code="REALTIME_AUTH_ERROR")


# ==============================================================================
# Pluggable Transport Protocol & Mock Transport for Testing
# ==============================================================================


@runtime_checkable
class RealtimeTransport(Protocol):
    """Protocol abstracting wire-level WebSocket transport."""

    def connect(self, url: str, headers: dict[str, str], timeout: float = 10.0) -> None:
        """Establish connection."""
        ...

    def disconnect(self) -> None:
        """Close connection."""
        ...

    def is_connected(self) -> bool:
        """Return True if connection is currently active."""
        ...

    def send(self, data: str) -> None:
        """Send raw string message."""
        ...

    def recv(self, timeout: float = 1.0) -> str | dict[str, Any] | None:
        """Receive next message or raise TimeoutError if timeout expires."""
        ...


class MockRealtimeTransport:
    """In-memory mock transport for unit testing and offline development."""

    def __init__(self) -> None:
        self.connected = False
        self.connected_url: str | None = None
        self.connected_headers: dict[str, str] = {}
        self.sent_messages: list[str] = []
        self.connect_error: Exception | None = None
        self.disconnect_error: Exception | None = None
        self._queue: queue.Queue[str | dict[str, Any] | Exception] = queue.Queue()
        self.reconnect_count = 0

    def connect(self, url: str, headers: dict[str, str], timeout: float = 10.0) -> None:
        if self.connect_error:
            err = self.connect_error
            self.connect_error = None
            raise err
        self.connected = True
        self.connected_url = url
        self.connected_headers = dict(headers)
        self.reconnect_count += 1

    def disconnect(self) -> None:
        self.connected = False
        if self.disconnect_error:
            err = self.disconnect_error
            self.disconnect_error = None
            raise err

    def is_connected(self) -> bool:
        return self.connected

    def send(self, data: str) -> None:
        if not self.connected:
            raise RealtimeConnectionError("Cannot send on closed transport")
        self.sent_messages.append(data)

    def push_message(self, message: str | dict[str, Any]) -> None:
        """Inject message into inbound queue."""
        self._queue.put(message)

    def push_error(self, exc: Exception) -> None:
        """Inject transport error into inbound queue."""
        self._queue.put(exc)

    def recv(self, timeout: float = 1.0) -> str | dict[str, Any] | None:
        if not self.connected:
            raise RealtimeConnectionError("Transport disconnected")
        try:
            item = self._queue.get(timeout=timeout)
            if isinstance(item, Exception):
                raise item
            return item
        except queue.Empty as err:
            raise TimeoutError("No message available") from err


# ==============================================================================
# Realtime Client
# ==============================================================================


class RealtimeClient:
    """Manages persistent WebSocket connection to Supabase Realtime or Cloud API gateway.

    Features:
    - Authenticated handshake with device token on channel `caps:shop:<shopId>`.
    - Supabase Realtime (Phoenix Channels) subscription protocol.
    - Automatic exponential backoff reconnection with jitter (1s, 2s, 4s, ..., max 30s).
    - Immediate wake-up on `job.approved` or `job.created` events.
    - Tenant isolation: foreign shop events are discarded.
    - Non-blocking daemon thread: disconnections never crash the print agent process.
    """

    def __init__(
        self,
        ws_url: str,
        shop_id: str,
        device_token: str | None = None,
        device_id: str | None = None,
        coordinator: Any = None,
        on_wake: Callable[[str, dict[str, Any]], Any] | None = None,
        base_backoff: float = DEFAULT_BASE_BACKOFF,
        max_backoff: float = DEFAULT_MAX_BACKOFF,
        jitter: float = DEFAULT_JITTER,
        timeout: float = DEFAULT_WS_TIMEOUT,
        transport: RealtimeTransport | None = None,
    ) -> None:
        self.ws_url = ws_url.rstrip("/")
        self.shop_id = shop_id
        self.device_token = device_token
        self.device_id = device_id
        self.coordinator = coordinator
        self.on_wake = on_wake
        self.base_backoff = base_backoff
        self.max_backoff = max_backoff
        self.jitter = jitter
        self.timeout = timeout
        self.transport = transport

        self.channel_name = f"caps:shop:{self.shop_id}"
        self.phoenix_topic = f"realtime:{self.channel_name}"

        self._connected = False
        self._stop_event = threading.Event()
        self._worker_thread: threading.Thread | None = None
        self._active_socket: Any = None
        self._lock = threading.RLock()

        self.reconnect_attempts = 0
        self.reconnect_count = 0
        self.received_events: list[dict[str, Any]] = []

    @property
    def is_connected(self) -> bool:
        """Return True if connection is currently established and active."""
        if self.transport is not None:
            return self.transport.is_connected()
        return self._connected

    def get_backoff_delay(self, attempt: int) -> float:
        """Calculate exponential backoff delay with jitter.

        Sequence: 1s, 2s, 4s, 8s, 16s, ..., max 30s (+ jitter).
        Formula: min(max_backoff, base_backoff * (2 ** attempt)) + random.uniform(0.0, jitter)
        """
        exponent_delay = self.base_backoff * (2**attempt)
        capped_delay = min(self.max_backoff, exponent_delay)
        jitter_val = random.uniform(0.0, self.jitter) if self.jitter > 0 else 0.0
        return capped_delay + jitter_val

    def _build_headers(self) -> dict[str, str]:
        """Construct authentication and tracing headers for WebSocket handshake."""
        headers: dict[str, str] = {
            "User-Agent": "CAPS-Desktop-Print-Agent/1.0.0",
        }
        if self.device_token:
            headers["Authorization"] = f"Bearer {self.device_token}"
            headers["apikey"] = self.device_token
        if self.device_id:
            headers["X-CAPS-Device-Id"] = self.device_id
        if self.shop_id:
            headers["X-CAPS-Shop-Id"] = self.shop_id
        return headers

    def build_join_message(self) -> dict[str, Any]:
        """Construct Phoenix Channels join message for Supabase Realtime."""
        return {
            "topic": self.phoenix_topic,
            "event": "phx_join",
            "payload": {
                "config": {
                    "broadcast": {"ack": False, "self": False},
                    "presence": {"key": ""},
                }
            },
            "ref": "1",
        }

    def build_heartbeat_message(self) -> dict[str, Any]:
        """Construct Phoenix Channels heartbeat frame."""
        return {
            "topic": "phoenix",
            "event": "heartbeat",
            "payload": {},
            "ref": "hb",
        }

    def handle_message(self, raw_message: str | dict[str, Any]) -> dict[str, Any] | None:
        """Parse incoming message, enforce tenant isolation, and dispatch wake-up signals.

        Supports:
        - Supabase Realtime broadcast frame:
          {"topic": "realtime:caps:shop:<shopId>", "event": "broadcast", "payload": {"event": "job.approved", "payload": {...}}}
        - Phoenix direct event:
          {"topic": "realtime:caps:shop:<shopId>", "event": "job.approved", "payload": {...}}
        - Generic broadcast payload:
          {"type": "broadcast", "event": "job.approved", "payload": {...}}
        - Supabase CDC/Postgres Changes event:
          {"topic": "realtime:caps:shop:<shopId>", "event": "INSERT", "payload": {"record": {...}}}
        """
        try:
            if isinstance(raw_message, str):
                data = json.loads(raw_message)
            elif isinstance(raw_message, dict):
                data = raw_message
            else:
                logger.debug("Ignoring non-JSON message: %s", raw_message)
                return None
        except Exception as parse_err:
            logger.warning("Failed to parse realtime message JSON: %s", parse_err)
            return None

        # Ignore heartbeat replies or internal acks
        event = data.get("event") or data.get("type") or ""
        if event in ("phx_reply", "phx_close", "heartbeat"):
            return None

        # Extract event name and inner payload
        payload = data.get("payload", {})
        event_name = event

        if event == "broadcast" and isinstance(payload, dict):
            # Nested broadcast structure: {event: "broadcast", payload: {event: "job.approved", payload: {...}}}
            event_name = payload.get("event") or payload.get("type") or event
            payload = payload.get("payload", payload)

        # Extract tenant shop ID for isolation check
        target_shop: str | None = None
        if isinstance(payload, dict):
            target_shop = payload.get("shopId") or payload.get("shop_id")
            # If Supabase CDC format (record / new)
            record = payload.get("record") or payload.get("new")
            if isinstance(record, dict):
                target_shop = target_shop or record.get("shop_id") or record.get("shopId")
                if "id" in record and "jobId" not in payload:
                    payload["jobId"] = record["id"]

        # Topic inspection for tenant isolation
        topic = data.get("topic") or data.get("channel") or ""
        if topic and ":" in topic:
            parts = topic.split(":")
            if len(parts) >= 3 and parts[-2] == "shop":
                topic_shop = parts[-1]
                if topic_shop != self.shop_id:
                    logger.warning(
                        "Tenant isolation: ignoring event on foreign channel '%s' (configured: '%s')",
                        topic,
                        self.shop_id,
                    )
                    return None

        # Check explicit shop ID in payload
        if target_shop and target_shop != self.shop_id:
            logger.warning(
                "Tenant isolation: ignoring event for foreign shop '%s' (configured: '%s')",
                target_shop,
                self.shop_id,
            )
            return None

        parsed_event = {
            "event": event_name,
            "shop_id": self.shop_id,
            "payload": payload if isinstance(payload, dict) else {},
            "raw": data,
        }
        self.received_events.append(parsed_event)

        # Check for immediate wake-up signals: job.approved or job.created
        wake_events = {"job.approved", "job.created", "job_approved", "job_created", "INSERT"}
        if event_name in wake_events:
            logger.info(
                "Realtime wake-up signal received: %s for shop %s", event_name, self.shop_id
            )

            # Trigger immediate coordinator poll and execution
            if self.coordinator and hasattr(self.coordinator, "poll_and_execute_now"):
                try:
                    self.coordinator.poll_and_execute_now()
                except Exception as coord_err:
                    logger.error(
                        "Coordinator poll_and_execute_now failed on wake-up: %s", coord_err
                    )

            # Trigger custom on_wake callback if configured
            if self.on_wake:
                try:
                    self.on_wake(event_name, payload if isinstance(payload, dict) else {})
                except Exception as cb_err:
                    logger.warning("on_wake callback raised exception: %s", cb_err)

        return parsed_event

    def _do_connect_and_listen(self) -> None:
        """Establish connection and stream events until disconnected or stopped."""
        headers = self._build_headers()

        if self.transport is not None:
            # Pluggable transport branch (unit tests and mock runners)
            self.transport.connect(self.ws_url, headers, timeout=self.timeout)
            self._connected = True
            self.reconnect_attempts = 0

            # Send join handshake
            join_msg = self.build_join_message()
            self.transport.send(json.dumps(join_msg))

            while not self._stop_event.is_set() and self.transport.is_connected():
                try:
                    msg = self.transport.recv(timeout=1.0)
                    if msg is not None:
                        self.handle_message(msg)
                except TimeoutError:
                    continue
                except Exception as exc:
                    self._connected = False
                    raise exc

        else:
            # Production branch using websockets.sync.client
            import websockets.sync.client

            with websockets.sync.client.connect(
                self.ws_url,
                additional_headers=headers,
                open_timeout=self.timeout,
            ) as ws:
                self._active_socket = ws
                self._connected = True
                self.reconnect_attempts = 0

                # Send Phoenix subscription frame
                join_msg = self.build_join_message()
                ws.send(json.dumps(join_msg))
                logger.info("Realtime connected and subscribed to %s", self.phoenix_topic)

                last_heartbeat = time.time()
                while not self._stop_event.is_set():
                    try:
                        raw_msg = ws.recv(timeout=1.0)
                        self.handle_message(raw_msg)
                    except TimeoutError:
                        pass

                    # Periodic Phoenix heartbeat
                    if time.time() - last_heartbeat > 30.0:
                        try:
                            ws.send(json.dumps(self.build_heartbeat_message()))
                            last_heartbeat = time.time()
                        except Exception:
                            break

    def _run_reconnect_loop(self) -> None:
        """Background worker thread with exponential backoff and jitter."""
        while not self._stop_event.is_set():
            try:
                self._do_connect_and_listen()
            except Exception as exc:
                if self._stop_event.is_set():
                    break
                logger.warning(
                    "Realtime WebSocket disconnected: %s. Initiating exponential backoff...",
                    exc,
                )

            self._connected = False
            if self._stop_event.is_set():
                break

            delay = self.get_backoff_delay(self.reconnect_attempts)
            self.reconnect_attempts += 1
            self.reconnect_count += 1
            logger.info(
                "Reconnection attempt #%d scheduled in %.2f seconds (capped at %.1fs)",
                self.reconnect_attempts,
                delay,
                self.max_backoff,
            )

            # Responsive sleep loop checking _stop_event every 100ms
            end_time = time.time() + delay
            while time.time() < end_time and not self._stop_event.is_set():
                time.sleep(min(0.1, max(0.01, end_time - time.time())))

    def connect(self) -> None:
        """Alias for start() to initiate background connection."""
        self.start()

    def start(self) -> None:
        """Start the realtime client worker thread."""
        with self._lock:
            if self._worker_thread and self._worker_thread.is_alive():
                return
            self._stop_event.clear()
            self._worker_thread = threading.Thread(
                target=self._run_reconnect_loop,
                name=f"RealtimeClient-{self.shop_id}",
                daemon=True,
            )
            self._worker_thread.start()
            logger.info("Realtime client worker thread started for shop %s", self.shop_id)

    def disconnect(self) -> None:
        """Alias for stop() to gracefully terminate connection."""
        self.stop()

    def stop(self, timeout: float = 5.0) -> None:
        """Gracefully stop the realtime connection and wait for thread termination."""
        with self._lock:
            self._stop_event.set()
            self._connected = False

            if self.transport is not None:
                try:
                    self.transport.disconnect()
                except Exception as t_err:
                    logger.debug("Error disconnecting transport: %s", t_err)

            if self._active_socket is not None:
                try:
                    self._active_socket.close()
                except Exception as s_err:
                    logger.debug("Error closing websocket: %s", s_err)
                finally:
                    self._active_socket = None

            if self._worker_thread and self._worker_thread.is_alive():
                self._worker_thread.join(timeout=timeout)
                self._worker_thread = None
                logger.info("Realtime client worker thread stopped for shop %s", self.shop_id)
