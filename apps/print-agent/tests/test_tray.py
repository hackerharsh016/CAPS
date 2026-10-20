"""Unit tests for CAPS Agent system tray UI controller and status tracking."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from caps_agent.api.server import DiagnosticsServer
from caps_agent.jobs.dispatcher import JobDispatcher
from caps_agent.jobs.state_machine import JobState, JobStateMachine
from caps_agent.tray.controller import (
    DesktopTrayAdapter,
    HeadlessTrayAdapter,
    TrayController,
    TrayStateSnapshot,
    TrayStatus,
)


class TestTrayStateAndRedaction(unittest.TestCase):
    """Test state snapshots, tooltip creation, and sensitive data redaction."""

    def test_state_snapshot_creation(self) -> None:
        snap = TrayStateSnapshot.create(
            status=TrayStatus.IDLE,
            active_jobs=2,
            queue_depth=5,
            shop_id="SHOP-123",
            device_id="DEV-456",
            message="Ready for new print jobs",
        )
        self.assertEqual(snap.status, TrayStatus.IDLE)
        self.assertEqual(snap.active_jobs_count, 2)
        self.assertEqual(snap.queue_depth, 5)
        self.assertEqual(snap.shop_id, "SHOP-123")
        self.assertIn("CAPS Print Agent - IDLE", snap.tooltip)
        self.assertIn("Shop: SHOP-123", snap.tooltip)
        self.assertIn("Device: DEV-456", snap.tooltip)
        self.assertIn("2 active, 5 queued", snap.tooltip)

    def test_token_redaction_in_tooltip_and_message(self) -> None:
        raw_msg = "Error connecting with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz and device_token=sec998877"
        snap = TrayStateSnapshot.create(
            status=TrayStatus.ERROR,
            message=raw_msg,
        )
        self.assertNotIn("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz", snap.message)
        self.assertNotIn("sec998877", snap.message)
        self.assertNotIn("sec998877", snap.tooltip)
        self.assertIn("[REDACTED_TOKEN]", snap.message)
        self.assertIn("[REDACTED_TOKEN]", snap.tooltip)


class TestHeadlessTrayAdapter(unittest.TestCase):
    """Test headless tray adapter operation."""

    def test_headless_lifecycle_and_history(self) -> None:
        adapter = HeadlessTrayAdapter()
        controller = TrayController(adapter=adapter)

        self.assertFalse(adapter.is_running)
        controller.start()
        self.assertTrue(adapter.is_running)

        controller.set_status(TrayStatus.PRINTING, "Printing job 101")
        controller.set_status(TrayStatus.IDLE, "Job complete")

        history = adapter.history
        self.assertGreaterEqual(len(history), 3)
        self.assertEqual(history[-1].status, TrayStatus.IDLE)
        self.assertEqual(history[-2].status, TrayStatus.PRINTING)

        controller.stop()
        self.assertFalse(adapter.is_running)


class TestDesktopTrayAdapterFallback(unittest.TestCase):
    """Test DesktopTrayAdapter fallback to headless when GUI/pystray is unavailable."""

    def test_fallback_behavior(self) -> None:
        with patch.dict("sys.modules", {"pystray": None}):
            adapter = DesktopTrayAdapter()
            controller = TrayController(adapter=adapter)
            controller.start()

            self.assertTrue(adapter.is_running)
            self.assertTrue(adapter._using_fallback)

            controller.set_status(TrayStatus.OFFLINE, "Network lost")
            self.assertEqual(controller.current_snapshot.status, TrayStatus.OFFLINE)

            controller.stop()
            self.assertFalse(adapter.is_running)


class TestTrayController(unittest.TestCase):
    """Test TrayController coordination, dispatcher hooks, operator actions, and safe restart."""

    def test_operator_controls_and_callbacks(self) -> None:
        stop_called = False
        pause_called = False
        resume_called = False
        restart_called = False

        def on_stop():
            nonlocal stop_called
            stop_called = True

        def on_pause():
            nonlocal pause_called
            pause_called = True

        def on_resume():
            nonlocal resume_called
            resume_called = True

        def on_restart():
            nonlocal restart_called
            restart_called = True

        controller = TrayController(
            adapter=HeadlessTrayAdapter(),
            on_stop=on_stop,
            on_pause=on_pause,
            on_resume=on_resume,
            on_restart=on_restart,
        )
        controller.start()
        self.assertEqual(controller.current_snapshot.status, TrayStatus.IDLE)

        # Test Pause
        controller.handle_operator_pause()
        self.assertTrue(pause_called)
        self.assertTrue(controller.is_paused)
        self.assertEqual(controller.current_snapshot.status, TrayStatus.PAUSED)

        # Test Resume
        controller.handle_operator_resume()
        self.assertTrue(resume_called)
        self.assertFalse(controller.is_paused)
        self.assertEqual(controller.current_snapshot.status, TrayStatus.IDLE)

        # Test Restart
        controller.handle_operator_restart()
        self.assertTrue(restart_called)
        self.assertTrue(controller.adapter.is_running)

        # Test Stop
        controller.handle_operator_stop()
        self.assertTrue(stop_called)
        self.assertEqual(controller.current_snapshot.status, TrayStatus.STOPPED)

    def test_diagnostics_url_opening(self) -> None:
        diag_server = MagicMock(spec=DiagnosticsServer)
        diag_server.host = "127.0.0.1"
        diag_server.port = 9099

        opened_custom = False

        def on_open():
            nonlocal opened_custom
            opened_custom = True

        controller = TrayController(
            diagnostics_server=diag_server,
            on_open_diagnostics=on_open,
        )
        url = controller.handle_operator_open_diagnostics()
        self.assertEqual(url, "http://127.0.0.1:9099/api/v1/health")
        self.assertTrue(opened_custom)

        # Test default webbrowser open
        controller_default = TrayController(diagnostics_server=diag_server)
        with patch("webbrowser.open") as mock_open:
            url_def = controller_default.handle_operator_open_diagnostics()
            self.assertEqual(url_def, "http://127.0.0.1:9099/api/v1/health")
            mock_open.assert_called_once_with("http://127.0.0.1:9099/api/v1/health")

    def test_dispatcher_event_listener_sync(self) -> None:
        """When dispatcher jobs change state, tray controller reflects active status."""
        dispatcher = MagicMock(spec=JobDispatcher)
        dispatcher._lock = MagicMock()
        dispatcher._lock.__enter__ = MagicMock(return_value=None)
        dispatcher._lock.__exit__ = MagicMock(return_value=None)
        dispatcher._active_jobs = {"printer-1": MagicMock()}
        dispatcher._printer_queues = {}
        dispatcher.shop_id = "SHOP-TRAY-01"
        dispatcher.is_stopped = False

        controller = TrayController(dispatcher=dispatcher)
        controller.start()

        # Simulate dispatcher state transition
        sm = MagicMock(spec=JobStateMachine)
        sm.job_id = "JOB-123"
        controller._on_dispatcher_job_event(sm, JobState.PRINTING)

        self.assertEqual(controller.current_snapshot.status, TrayStatus.PRINTING)
        self.assertIn("Printing 1 active job(s)", controller.current_snapshot.message)

        # Transition to finished
        dispatcher._active_jobs = {}
        controller._on_dispatcher_job_event(sm, JobState.COMPLETED)
        self.assertEqual(controller.current_snapshot.status, TrayStatus.IDLE)


if __name__ == "__main__":
    unittest.main()
