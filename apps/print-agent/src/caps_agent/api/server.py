"""Local loopback diagnostics HTTP server for CAPS Print Agent.

Provides local-only inspection and operator control:
- Strict loopback binding (127.0.0.1, localhost, ::1 only); LAN access strictly forbidden
- Host header validation to defend against DNS rebinding attacks
- Origin validation and CSRF protection against malicious browser drive-by queries
- Zero document content or sensitive auth token disclosure
- Endpoints:
  - GET /health and GET /api/v1/health (agent status, uptime, device pairing)
  - GET /api/v1/printers (enumerated local printers and status)
  - GET /api/v1/queue (current per-printer queue depth and active jobs)
  - GET /api/v1/logs (safe redacted in-memory diagnostics log ring buffer)
  - POST /api/v1/stop (operator-controlled graceful shutdown)
"""

from __future__ import annotations

import collections
import contextlib
import http.server
import json
import logging
import threading
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from caps_agent.utils.logging import redact_sensitive_data

if TYPE_CHECKING:
    from caps_agent.auth.credentials import AgentCredentials
    from caps_agent.jobs.dispatcher import JobDispatcher
    from caps_agent.printing.printer_discovery import PrinterDiscovery

logger = logging.getLogger("caps_agent.api.server")

ALLOWED_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "testclient"})


# ==============================================================================
# Security & Diagnostics Exceptions
# ==============================================================================


class DiagnosticsSecurityError(ValueError):
    """Raised when an unauthorized non-loopback host or origin is attempted."""
    pass


# ==============================================================================
# In-Memory Redacted Diagnostics Log Ring Buffer
# ==============================================================================


class DiagnosticsLogBuffer(logging.Handler):
    """Ring buffer keeping the last N redacted log entries for local inspection."""

    def __init__(self, capacity: int = 200) -> None:
        super().__init__()
        self.capacity = capacity
        self.buffer: collections.deque[dict[str, Any]] = collections.deque(maxlen=capacity)
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = record.getMessage()
            # Enforce redaction
            safe_msg = redact_sensitive_data(msg)
            entry = {
                "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "level": record.levelname,
                "logger": record.name,
                "message": safe_msg,
            }
            with self._lock:
                self.buffer.append(entry)
        except Exception:
            self.handleError(record)

    def get_entries(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            entries = list(self.buffer)
            return entries[-limit:]


# ==============================================================================
# Request Handler with Loopback, Host, and CSRF Safeguards
# ==============================================================================


class DiagnosticsRequestHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler enforcing loopback binding, Host verification, and CSRF checks."""

    # Protocol metadata
    server_version = "CAPS-Agent-Diagnostics/0.1.0"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default stdout access logging."""
        logger.debug("Diagnostics API: %s - %s", self.address_string(), format % args)

    def _send_json(self, status_code: int, data: dict[str, Any]) -> None:
        payload = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(payload)

    def _validate_security(self) -> bool:
        """Enforce LAN isolation, Host header verification, and CSRF/Origin defenses."""
        server: DiagnosticsServer = self.server  # type: ignore[assignment]

        # 1. LAN Isolation: Reject connections from non-loopback client IPs
        client_ip = self.client_address[0]
        if not (client_ip.startswith("127.") or client_ip in ("::1", "localhost", "testclient")):
            logger.warning("Security violation: Rejected connection from non-loopback IP '%s'", client_ip)
            self._send_json(403, {"error": "Forbidden: Local diagnostics only accessible via loopback"})
            return False

        # 2. Host Header Validation (DNS Rebinding Defense)
        host_header = self.headers.get("Host", "").split(":")[0].strip().lower()
        if host_header and host_header not in ALLOWED_LOOPBACK_HOSTS:
            logger.warning("Security violation: Rejected invalid Host header '%s'", host_header)
            self._send_json(400, {"error": f"Bad Request: Host header '{host_header}' forbidden"})
            return False

        # 3. CSRF & Cross-Origin Protection
        origin_header = self.headers.get("Origin")
        if origin_header:
            # Parse origin hostname
            clean_origin = origin_header.split("://")[-1].split(":")[0].lower()
            if clean_origin not in ("localhost", "127.0.0.1", "::1", "null"):
                logger.warning("Security violation: Rejected cross-origin request from '%s'", origin_header)
                self._send_json(403, {"error": f"Forbidden: Cross-origin requests from '{origin_header}' are prohibited"})
                return False

        # 4. Local Diagnostics Token Check (if configured)
        if server.local_auth_token:
            provided_token = self.headers.get("X-CAPS-Diagnostics-Token")
            if provided_token != server.local_auth_token:
                self._send_json(401, {"error": "Unauthorized: Missing or invalid X-CAPS-Diagnostics-Token"})
                return False

        return True

    def do_GET(self) -> None:
        """Handle GET endpoints."""
        if not self._validate_security():
            return

        server: DiagnosticsServer = self.server  # type: ignore[assignment]
        path = self.path.split("?")[0].rstrip("/")

        if path in ("/health", "/api/v1/health"):
            uptime = time.monotonic() - server.start_time
            queue_depth = sum(
                q.qsize() for q in server.dispatcher._printer_queues.values()
            ) if server.dispatcher else 0
            active_jobs = len(server.dispatcher._active_jobs) if server.dispatcher else 0

            response = {
                "status": "healthy",
                "version": "0.1.0",
                "uptime_seconds": round(uptime, 2),
                "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "shop_id": server.credentials.shop_id if server.credentials else None,
                "device_id": server.credentials.device_id if server.credentials else None,
                "paired": server.credentials is not None,
                "queue_depth": queue_depth,
                "active_jobs_count": active_jobs,
                "stopped": server.dispatcher.is_stopped if server.dispatcher else False,
            }
            self._send_json(200, response)
            return

        if path == "/api/v1/printers":
            printers_list: list[dict[str, Any]] = []
            if server.printer_discovery:
                try:
                    if hasattr(server.printer_discovery, "enumerate_printers"):
                        discovered = server.printer_discovery.enumerate_printers()
                    elif hasattr(server.printer_discovery, "discover_printers"):
                        discovered = server.printer_discovery.discover_printers()
                    else:
                        discovered = []
                    for p in discovered:
                        if hasattr(p, "to_contract_dict"):
                            printers_list.append(p.to_contract_dict())
                        elif hasattr(p, "to_dict"):
                            printers_list.append(p.to_dict())
                        elif hasattr(p, "__dict__"):
                            printers_list.append(dict(p.__dict__))
                        else:
                            printers_list.append(dict(p))
                except Exception as err:
                    logger.warning("Printer discovery failed in diagnostics: %s", err)

            self._send_json(200, {"printers": printers_list, "count": len(printers_list)})
            return

        if path == "/api/v1/queue":
            queues_summary: dict[str, Any] = {}
            if server.dispatcher:
                with server.dispatcher._lock:
                    for p_name, q in server.dispatcher._printer_queues.items():
                        active = server.dispatcher._active_jobs.get(p_name)
                        queues_summary[p_name] = {
                            "queue_depth": q.qsize(),
                            "is_busy": server.dispatcher.is_printer_busy(p_name),
                            "active_job_id": active.job_id if active else None,
                            "active_attempt_id": active.attempt_id if active else None,
                        }

            self._send_json(200, {"queues": queues_summary})
            return

        if path == "/api/v1/logs":
            logs = server.log_buffer.get_entries(limit=100)
            self._send_json(200, {"logs": logs, "count": len(logs)})
            return

        self._send_json(404, {"error": f"Path '{self.path}' not found"})

    def do_POST(self) -> None:
        """Handle POST operator actions."""
        if not self._validate_security():
            return

        server: DiagnosticsServer = self.server  # type: ignore[assignment]
        path = self.path.split("?")[0].rstrip("/")

        if path in ("/api/v1/stop", "/api/v1/operator/stop"):
            logger.info("Operator requested shutdown via diagnostics API")
            if server.dispatcher:
                server.dispatcher.shutdown(wait=False)
            if server.on_operator_stop:
                try:
                    server.on_operator_stop()
                except Exception as err:
                    logger.warning("Error invoking operator stop callback: %s", err)

            self._send_json(200, {"status": "stopping", "message": "Agent stop initiated"})
            return

        self._send_json(404, {"error": f"Path '{self.path}' not found"})


# ==============================================================================
# Diagnostics Server Coordinator
# ==============================================================================


class DiagnosticsServer:
    """Thread-safe HTTP server binding strictly to loopback interfaces."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 9099,
        credentials: AgentCredentials | None = None,
        dispatcher: JobDispatcher | None = None,
        printer_discovery: PrinterDiscovery | None = None,
        log_buffer: DiagnosticsLogBuffer | None = None,
        local_auth_token: str | None = None,
        on_operator_stop: Any | None = None,
    ) -> None:
        # Strictly validate that host is loopback
        clean_host = host.strip().lower()
        if clean_host not in ("127.0.0.1", "localhost", "::1"):
            raise DiagnosticsSecurityError(
                f"Security violation: DiagnosticsServer host '{host}' is forbidden. "
                "Must bind strictly to loopback ('127.0.0.1', 'localhost', '::1')."
            )

        self.host = clean_host
        self.port = port
        self.credentials = credentials
        self.dispatcher = dispatcher
        self.printer_discovery = printer_discovery
        self.log_buffer = log_buffer or DiagnosticsLogBuffer()
        self.local_auth_token = local_auth_token
        self.on_operator_stop = on_operator_stop

        self.start_time = time.monotonic()
        self._lock = threading.RLock()
        self._httpd: http.server.ThreadingHTTPServer | None = None
        self._server_thread: threading.Thread | None = None
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running and self._httpd is not None

    def start(self) -> None:
        """Start diagnostics server on background thread."""
        with self._lock:
            if self._running:
                return

            # Re-usable socket setup
            class ReusableThreadingServer(http.server.ThreadingHTTPServer):
                allow_reuse_address = True
                daemon_threads = True

            try:
                self._httpd = ReusableThreadingServer(
                    (self.host, self.port),
                    DiagnosticsRequestHandler,
                )
            except OSError as err:
                logger.error("Failed to bind diagnostics server to %s:%d: %s", self.host, self.port, err)
                raise

            # Copy references to server instance for handler access
            self._httpd.credentials = self.credentials  # type: ignore[attr-defined]
            self._httpd.dispatcher = self.dispatcher  # type: ignore[attr-defined]
            self._httpd.printer_discovery = self.printer_discovery  # type: ignore[attr-defined]
            self._httpd.log_buffer = self.log_buffer  # type: ignore[attr-defined]
            self._httpd.start_time = self.start_time  # type: ignore[attr-defined]
            self._httpd.local_auth_token = self.local_auth_token  # type: ignore[attr-defined]
            self._httpd.on_operator_stop = self.on_operator_stop  # type: ignore[attr-defined]

            self._running = True
            self._server_thread = threading.Thread(
                target=self._serve_loop,
                name=f"DiagnosticsServer-{self.port}",
                daemon=True,
            )
            self._server_thread.start()
            logger.info("Diagnostics loopback server listening on http://%s:%d", self.host, self.port)

    def _serve_loop(self) -> None:
        if self._httpd:
            try:
                self._httpd.serve_forever(poll_interval=0.2)
            except Exception as err:
                if self._running:
                    logger.warning("Diagnostics server stopped with error: %s", err)

    def stop(self) -> None:
        """Gracefully stop diagnostics server and release socket."""
        with self._lock:
            if not self._running or self._httpd is None:
                return

            self._running = False
            with contextlib.suppress(Exception):
                self._httpd.shutdown()
            with contextlib.suppress(Exception):
                self._httpd.server_close()

            if self._server_thread and self._server_thread.is_alive():
                self._server_thread.join(timeout=2.0)

            self._httpd = None
            self._server_thread = None
            logger.info("Diagnostics loopback server stopped")

    def restart(self) -> None:
        """Safely stop and restart diagnostics server without socket leaks."""
        with self._lock:
            self.stop()
            self.start_time = time.monotonic()
            self.start()
