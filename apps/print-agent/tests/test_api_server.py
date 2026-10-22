"""Unit and integration tests for CAPS Agent loopback diagnostics HTTP server."""

from __future__ import annotations

import json
import logging
import socket
import unittest
import urllib.error
import urllib.request
from unittest.mock import MagicMock

from caps_agent.api.server import (
    DiagnosticsLogBuffer,
    DiagnosticsSecurityError,
    DiagnosticsServer,
)
from caps_agent.auth.credentials import AgentCredentials
from caps_agent.printing.printer_discovery import DiscoveredPrinter, PrinterDiscovery


def get_free_port() -> int:
    """Find an available port on loopback."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestDiagnosticsSecurity(unittest.TestCase):
    """Test loopback binding restrictions, Host validation, and CSRF defenses."""

    def test_non_loopback_host_rejected_at_initialization(self) -> None:
        """DiagnosticsServer must refuse to bind to any non-loopback host."""
        invalid_hosts = ["0.0.0.0", "192.168.1.10", "10.0.0.1", "example.com"]
        for host in invalid_hosts:
            with self.subTest(host=host), self.assertRaises(DiagnosticsSecurityError):
                DiagnosticsServer(host=host, port=9099)

    def test_allowed_loopback_hosts(self) -> None:
        """Only 127.0.0.1, localhost, and ::1 are permitted hosts."""
        for host in ["127.0.0.1", "localhost", "::1"]:
            server = DiagnosticsServer(host=host, port=9099)
            self.assertEqual(server.host, host)


class TestDiagnosticsEndpoints(unittest.TestCase):
    """Integration tests executing HTTP requests against DiagnosticsServer."""

    server: DiagnosticsServer
    port: int

    @classmethod
    def setUpClass(cls) -> None:
        cls.port = get_free_port()
        cls.credentials = AgentCredentials(
            shop_id="SHOP-SEC-01",
            device_id="DEV-PRINT-01",
            device_token="SECRET_TOKEN_DO_NOT_LEAK",
        )

        # Mock discovery
        cls.mock_discovery = MagicMock(spec=PrinterDiscovery)
        cls.mock_discovery.enumerate_printers.return_value = [
            DiscoveredPrinter(
                printer_id="thermal-receipt-printer",
                name="ThermalReceiptPrinter",
                is_default=True,
                status="online",
                port_name="USB001",
                driver_name="Generic / Text Only",
                raw_status=0,
                raw_attributes=0,
            )
        ]

        cls.log_buffer = DiagnosticsLogBuffer(capacity=50)
        # Emit a log entry containing a sensitive token to verify redaction
        test_logger = logging.getLogger("caps_agent.test")
        test_logger.addHandler(cls.log_buffer)
        test_logger.setLevel(logging.INFO)
        test_logger.info(
            "Connecting with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret and token=abc123456789"
        )

        cls.operator_stop_called = False

        def on_stop():
            cls.operator_stop_called = True

        cls.server = DiagnosticsServer(
            host="127.0.0.1",
            port=cls.port,
            credentials=cls.credentials,
            printer_discovery=cls.mock_discovery,
            log_buffer=cls.log_buffer,
            on_operator_stop=on_stop,
        )
        cls.server.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.stop()

    def _http_get(self, path: str, headers: dict[str, str] | None = None) -> tuple[int, dict]:
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return resp.status, data
        except urllib.error.HTTPError as err:
            data = json.loads(err.read().decode("utf-8"))
            return err.code, data

    def _http_post(self, path: str, headers: dict[str, str] | None = None) -> tuple[int, dict]:
        url = f"http://127.0.0.1:{self.port}{path}"
        req = urllib.request.Request(url, data=b"{}", headers=headers or {}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return resp.status, data
        except urllib.error.HTTPError as err:
            data = json.loads(err.read().decode("utf-8"))
            return err.code, data

    def test_health_endpoint(self) -> None:
        status, data = self._http_get("/api/v1/health")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["shop_id"], "SHOP-SEC-01")
        self.assertEqual(data["device_id"], "DEV-PRINT-01")
        self.assertTrue(data["paired"])
        self.assertIn("uptime_seconds", data)
        self.assertNotIn("SECRET_TOKEN_DO_NOT_LEAK", json.dumps(data))

    def test_root_health_endpoint(self) -> None:
        status, data = self._http_get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "healthy")

    def test_printers_endpoint(self) -> None:
        status, data = self._http_get("/api/v1/printers")
        self.assertEqual(status, 200)
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["printers"][0]["name"], "ThermalReceiptPrinter")

    def test_queue_endpoint_empty(self) -> None:
        status, data = self._http_get("/api/v1/queue")
        self.assertEqual(status, 200)
        self.assertEqual(data["queues"], {})

    def test_logs_endpoint_with_redaction(self) -> None:
        status, data = self._http_get("/api/v1/logs")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(data["count"], 1)
        raw_dump = json.dumps(data)
        # Ensure raw token is redacted
        self.assertNotIn("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.secret", raw_dump)
        self.assertNotIn("abc123456789", raw_dump)
        self.assertIn("[REDACTED", raw_dump)

    def test_operator_stop_endpoint(self) -> None:
        status, data = self._http_post("/api/v1/stop")
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "stopping")
        self.assertTrue(self.__class__.operator_stop_called)

    def test_unknown_path_returns_404(self) -> None:
        status, data = self._http_get("/api/v1/nonexistent")
        self.assertEqual(status, 404)
        self.assertIn("error", data)

    def test_dns_rebinding_host_header_rejected(self) -> None:
        """A forged Host header from an attacker site must be rejected with 400."""
        status, data = self._http_get(
            "/api/v1/health",
            headers={"Host": "attacker-controlled-domain.evil"},
        )
        self.assertEqual(status, 400)
        self.assertIn("forbidden", data["error"].lower())

    def test_cross_origin_csrf_header_rejected(self) -> None:
        """A cross-origin request from a malicious website must be rejected with 403."""
        status, data = self._http_get(
            "/api/v1/health",
            headers={"Origin": "https://malicious-website.org"},
        )
        self.assertEqual(status, 403)
        self.assertIn("cross-origin", data["error"].lower())


class TestDiagnosticsServerRestartAndToken(unittest.TestCase):
    """Test safe restart and local authentication token enforcement."""

    def test_local_auth_token_protection(self) -> None:
        port = get_free_port()
        server = DiagnosticsServer(
            host="127.0.0.1",
            port=port,
            local_auth_token="DIAG-LOCAL-TOKEN-12345",
        )
        server.start()
        try:
            url = f"http://127.0.0.1:{port}/api/v1/health"

            # 1. Without token -> 401
            req_unauth = urllib.request.Request(url)
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                urllib.request.urlopen(req_unauth, timeout=3.0)
            self.assertEqual(ctx.exception.code, 401)

            # 2. With valid token -> 200
            req_auth = urllib.request.Request(
                url,
                headers={"X-CAPS-Diagnostics-Token": "DIAG-LOCAL-TOKEN-12345"},
            )
            with urllib.request.urlopen(req_auth, timeout=3.0) as resp:
                self.assertEqual(resp.status, 200)
        finally:
            server.stop()

    def test_safe_restart_without_port_conflict(self) -> None:
        """DiagnosticsServer must safely restart and immediately rebind on the same port."""
        port = get_free_port()
        server = DiagnosticsServer(host="127.0.0.1", port=port)
        server.start()
        self.assertTrue(server.is_running)

        url = f"http://127.0.0.1:{port}/api/v1/health"
        with urllib.request.urlopen(url, timeout=3.0) as resp:
            self.assertEqual(resp.status, 200)

        # Restart
        server.restart()
        self.assertTrue(server.is_running)

        # Must serve requests immediately after restart
        with urllib.request.urlopen(url, timeout=3.0) as resp:
            self.assertEqual(resp.status, 200)

        server.stop()
        self.assertFalse(server.is_running)


if __name__ == "__main__":
    unittest.main()
