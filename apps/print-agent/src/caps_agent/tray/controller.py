"""System tray UI controller and status tracking for CAPS Print Agent.

Provides desktop shell integration:
- Visual state tracking (IDLE, PRINTING, PAUSED, OFFLINE, STOPPED, ERROR)
- Safe status summary and tooltip formatting (strictly zero secret tokens or PII)
- Operator controls: Pause/Resume, Stop agent, Open local diagnostics, Safe restart
- Pluggable adapter architecture:
  - HeadlessTrayAdapter: for CI, Docker, automated tests, and headless Windows services
  - DesktopTrayAdapter: desktop integration with pystray/PIL fallback to headless
- Safe restart: stops and re-initializes cleanly without resource or thread leaks
"""

from __future__ import annotations

import enum
import logging
import threading
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from caps_agent.utils.logging import redact_sensitive_data

if TYPE_CHECKING:
    from caps_agent.api.server import DiagnosticsServer
    from caps_agent.jobs.dispatcher import JobDispatcher
    from caps_agent.jobs.state_machine import JobState, JobStateMachine

logger = logging.getLogger("caps_agent.tray")


# ==============================================================================
# Tray Status & State Models
# ==============================================================================


class TrayStatus(enum.StrEnum):
    """Operational status states for the system tray icon."""

    IDLE = "IDLE"
    PRINTING = "PRINTING"
    PAUSED = "PAUSED"
    OFFLINE = "OFFLINE"
    STOPPED = "STOPPED"
    ERROR = "ERROR"


@dataclass(frozen=True)
class TrayStateSnapshot:
    """Immutable snapshot of the print agent status for tray display."""

    status: TrayStatus
    active_jobs_count: int = 0
    queue_depth: int = 0
    shop_id: str | None = None
    device_id: str | None = None
    message: str = ""
    tooltip: str = ""

    @classmethod
    def create(
        cls,
        status: TrayStatus,
        active_jobs: int = 0,
        queue_depth: int = 0,
        shop_id: str | None = None,
        device_id: str | None = None,
        message: str = "",
    ) -> TrayStateSnapshot:
        """Create a state snapshot with safely redacted tooltip."""
        safe_msg = redact_sensitive_data(message) if message else ""
        lines = [
            f"CAPS Print Agent - {status.value}",
        ]
        if shop_id:
            lines.append(f"Shop: {shop_id}")
        if device_id:
            lines.append(f"Device: {device_id}")
        lines.append(f"Jobs: {active_jobs} active, {queue_depth} queued")
        if safe_msg:
            lines.append(safe_msg)

        tooltip = "\n".join(lines)
        return cls(
            status=status,
            active_jobs_count=active_jobs,
            queue_depth=queue_depth,
            shop_id=shop_id,
            device_id=device_id,
            message=safe_msg,
            tooltip=tooltip,
        )


# ==============================================================================
# Tray Adapters
# ==============================================================================


class BaseTrayAdapter:
    """Abstract base class for system tray display adapters."""

    def start(self, controller: TrayController) -> None:
        raise NotImplementedError()

    def stop(self) -> None:
        raise NotImplementedError()

    def update(self, snapshot: TrayStateSnapshot) -> None:
        raise NotImplementedError()

    @property
    def is_running(self) -> bool:
        raise NotImplementedError()


class HeadlessTrayAdapter(BaseTrayAdapter):
    """Headless adapter recording state changes without invoking native GUI APIs.

    Ideal for CI runners, Docker containers, Windows service daemons, and unit tests.
    """

    def __init__(self) -> None:
        self._running = False
        self._controller: TrayController | None = None
        self._history: list[TrayStateSnapshot] = []
        self._lock = threading.Lock()

    def start(self, controller: TrayController) -> None:
        with self._lock:
            self._controller = controller
            self._running = True
            if controller.current_snapshot:
                self._history.append(controller.current_snapshot)
        logger.debug("HeadlessTrayAdapter started")

    def stop(self) -> None:
        with self._lock:
            self._running = False
            self._controller = None
        logger.debug("HeadlessTrayAdapter stopped")

    def update(self, snapshot: TrayStateSnapshot) -> None:
        with self._lock:
            self._history.append(snapshot)
        logger.debug(
            "Headless tray status updated: %s - %s", snapshot.status.value, snapshot.message
        )

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    @property
    def history(self) -> list[TrayStateSnapshot]:
        with self._lock:
            return list(self._history)


class DesktopTrayAdapter(BaseTrayAdapter):
    """Desktop tray adapter leveraging pystray if installed, with headless fallback."""

    def __init__(self) -> None:
        self._headless_fallback = HeadlessTrayAdapter()
        self._using_fallback = True
        self._icon: Any | None = None
        self._running = False
        self._lock = threading.Lock()

    def start(self, controller: TrayController) -> None:
        with self._lock:
            try:
                import pystray  # type: ignore[import-not-found]
                from PIL import Image, ImageDraw  # type: ignore[import-not-found]

                # If pystray is available, build the tray icon
                self._using_fallback = False
                self._icon = self._build_pystray_icon(pystray, Image, ImageDraw, controller)
                self._running = True

                # Run icon loop on a dedicated daemon thread
                tray_thread = threading.Thread(
                    target=self._run_icon,
                    name="DesktopTrayThread",
                    daemon=True,
                )
                tray_thread.start()
                logger.info("Desktop tray icon started via pystray")
            except Exception as err:
                logger.info(
                    "Native GUI tray unavailable (%s); using HeadlessTrayAdapter fallback",
                    err,
                )
                self._using_fallback = True
                self._headless_fallback.start(controller)
                self._running = True

    def _run_icon(self) -> None:
        if self._icon is not None:
            try:
                self._icon.run()
            except Exception as err:
                logger.warning("Desktop tray loop terminated: %s", err)
                self._running = False

    def _build_pystray_icon(
        self,
        pystray: Any,
        Image: Any,
        ImageDraw: Any,
        controller: TrayController,
    ) -> Any:
        # Create an in-memory 64x64 icon bitmap
        img = Image.new("RGBA", (64, 64), color=(0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.ellipse([8, 8, 56, 56], fill="#1E88E5", outline="#1565C0", width=2)

        def on_open_diag(icon: Any, item: Any) -> None:
            controller.handle_operator_open_diagnostics()

        def on_toggle_pause(icon: Any, item: Any) -> None:
            if controller.is_paused:
                controller.handle_operator_resume()
            else:
                controller.handle_operator_pause()

        def on_restart(icon: Any, item: Any) -> None:
            controller.handle_operator_restart()

        def on_stop(icon: Any, item: Any) -> None:
            controller.handle_operator_stop()

        menu = pystray.Menu(
            pystray.MenuItem("CAPS Print Agent", None, enabled=False),
            pystray.MenuItem("Open Diagnostics", on_open_diag),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                lambda text: "Resume Processing" if controller.is_paused else "Pause Processing",
                on_toggle_pause,
            ),
            pystray.MenuItem("Restart Agent", on_restart),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Stop Agent", on_stop),
        )

        return pystray.Icon("CAPS Print Agent", img, "CAPS Print Agent", menu)

    def stop(self) -> None:
        with self._lock:
            if self._using_fallback:
                self._headless_fallback.stop()
            elif self._icon is not None:
                try:
                    self._icon.stop()
                except Exception as err:
                    logger.debug("Error stopping pystray icon: %s", err)
                self._icon = None
            self._running = False
            logger.info("Desktop tray icon stopped")

    def update(self, snapshot: TrayStateSnapshot) -> None:
        with self._lock:
            if self._using_fallback:
                self._headless_fallback.update(snapshot)
            elif self._icon is not None:
                try:
                    self._icon.title = snapshot.tooltip[:128]
                except Exception as err:
                    logger.debug("Failed to update tray icon title: %s", err)

    @property
    def is_running(self) -> bool:
        with self._lock:
            if self._using_fallback:
                return self._headless_fallback.is_running
            return self._running


# ==============================================================================
# Tray Controller
# ==============================================================================


class TrayController:
    """Coordinates print agent desktop tray UI, state changes, and operator actions."""

    def __init__(
        self,
        adapter: BaseTrayAdapter | None = None,
        dispatcher: JobDispatcher | None = None,
        diagnostics_server: DiagnosticsServer | None = None,
        on_stop: Callable[[], None] | None = None,
        on_pause: Callable[[], None] | None = None,
        on_resume: Callable[[], None] | None = None,
        on_restart: Callable[[], None] | None = None,
        on_open_diagnostics: Callable[[], None] | None = None,
    ) -> None:
        self.adapter = adapter or HeadlessTrayAdapter()
        self.dispatcher = dispatcher
        self.diagnostics_server = diagnostics_server
        self.on_stop = on_stop
        self.on_pause = on_pause
        self.on_resume = on_resume
        self.on_restart = on_restart
        self.on_open_diagnostics = on_open_diagnostics

        self._lock = threading.RLock()
        self._is_paused = False
        self._current_snapshot: TrayStateSnapshot = TrayStateSnapshot.create(TrayStatus.IDLE)
        self._status_listeners: list[Callable[[TrayStateSnapshot], None]] = []

        # Hook dispatcher status changes if provided
        if self.dispatcher is not None:
            self.dispatcher.add_status_listener(self._on_dispatcher_job_event)

    @property
    def is_paused(self) -> bool:
        with self._lock:
            return self._is_paused

    @property
    def current_snapshot(self) -> TrayStateSnapshot:
        with self._lock:
            return self._current_snapshot

    def add_status_listener(self, listener: Callable[[TrayStateSnapshot], None]) -> None:
        with self._lock:
            if listener not in self._status_listeners:
                self._status_listeners.append(listener)

    def remove_status_listener(self, listener: Callable[[TrayStateSnapshot], None]) -> None:
        with self._lock:
            if listener in self._status_listeners:
                self._status_listeners.remove(listener)

    def _notify_listeners(self, snapshot: TrayStateSnapshot) -> None:
        with self._lock:
            listeners = list(self._status_listeners)
        for listener in listeners:
            try:
                listener(snapshot)
            except Exception as err:
                logger.error("Error invoking tray status listener: %s", err)

    def set_status(
        self,
        status: TrayStatus,
        message: str = "",
        shop_id: str | None = None,
        device_id: str | None = None,
    ) -> TrayStateSnapshot:
        """Update the agent status and notify adapter and listeners."""
        with self._lock:
            active_count = 0
            queue_depth = 0
            if self.dispatcher is not None:
                with getattr(self.dispatcher, "_lock", threading.Lock()):
                    active_count = len(getattr(self.dispatcher, "_active_jobs", {}))
                    queue_depth = sum(
                        q.qsize() for q in getattr(self.dispatcher, "_printer_queues", {}).values()
                    )

            eff_shop = shop_id or (self.dispatcher.shop_id if self.dispatcher else None)
            snapshot = TrayStateSnapshot.create(
                status=status,
                active_jobs=active_count,
                queue_depth=queue_depth,
                shop_id=eff_shop,
                device_id=device_id,
                message=message,
            )
            self._current_snapshot = snapshot
            if self.adapter and self.adapter.is_running:
                self.adapter.update(snapshot)

        self._notify_listeners(snapshot)
        return snapshot

    def _on_dispatcher_job_event(self, sm: JobStateMachine, state: JobState) -> None:
        """Callback invoked whenever dispatcher changes state for a print job."""
        with self._lock:
            if self._is_paused:
                self.set_status(TrayStatus.PAUSED, f"Paused - Job {sm.job_id} {state.value}")
                return

            if self.dispatcher and self.dispatcher.is_stopped:
                self.set_status(TrayStatus.STOPPED, "Dispatcher stopped")
                return

            active_jobs = (
                len(getattr(self.dispatcher, "_active_jobs", {})) if self.dispatcher else 0
            )
            if active_jobs > 0:
                self.set_status(TrayStatus.PRINTING, f"Printing {active_jobs} active job(s)")
            else:
                self.set_status(TrayStatus.IDLE, "Ready for jobs")

    def start(self) -> None:
        """Start the tray UI adapter."""
        with self._lock:
            if not self.adapter.is_running:
                self.adapter.start(self)
                self.set_status(TrayStatus.IDLE, "Agent online")
                logger.info("TrayController started")

    def stop(self) -> None:
        """Stop the tray UI adapter cleanly."""
        with self._lock:
            self.set_status(TrayStatus.STOPPED, "Agent stopped")
            if self.adapter.is_running:
                self.adapter.stop()
            if self.dispatcher is not None:
                self.dispatcher.remove_status_listener(self._on_dispatcher_job_event)
            logger.info("TrayController stopped")

    def restart(self) -> None:
        """Safely restart the tray controller and adapter without leaking state."""
        with self._lock:
            logger.info("Restarting TrayController...")
            self.stop()
            self._is_paused = False
            if self.dispatcher is not None:
                self.dispatcher.add_status_listener(self._on_dispatcher_job_event)
            self.start()
            if self.on_restart:
                try:
                    self.on_restart()
                except Exception as err:
                    logger.warning("Error invoking on_restart callback: %s", err)
            logger.info("TrayController restarted successfully")

    # ==========================================================================
    # Operator Actions
    # ==========================================================================

    def handle_operator_stop(self) -> None:
        """Handle operator requesting agent shutdown."""
        logger.info("Operator requested shutdown via tray menu")
        self.set_status(TrayStatus.STOPPED, "Shutdown requested by operator")
        if self.on_stop:
            try:
                self.on_stop()
            except Exception as err:
                logger.warning("Error invoking on_stop callback: %s", err)
        elif self.dispatcher:
            self.dispatcher.shutdown(wait=False)

    def handle_operator_pause(self) -> None:
        """Handle operator pausing job processing."""
        with self._lock:
            self._is_paused = True
            self.set_status(TrayStatus.PAUSED, "Processing paused by operator")
        logger.info("Operator paused job processing via tray menu")
        if self.on_pause:
            try:
                self.on_pause()
            except Exception as err:
                logger.warning("Error invoking on_pause callback: %s", err)

    def handle_operator_resume(self) -> None:
        """Handle operator resuming job processing."""
        with self._lock:
            self._is_paused = False
            self.set_status(TrayStatus.IDLE, "Processing resumed by operator")
        logger.info("Operator resumed job processing via tray menu")
        if self.on_resume:
            try:
                self.on_resume()
            except Exception as err:
                logger.warning("Error invoking on_resume callback: %s", err)

    def handle_operator_restart(self) -> None:
        """Handle operator triggering safe component restart."""
        logger.info("Operator requested restart via tray menu")
        self.restart()

    def handle_operator_open_diagnostics(self) -> str:
        """Open the local loopback diagnostics endpoint in the user's browser."""
        port = 9099
        host = "127.0.0.1"
        if self.diagnostics_server:
            port = self.diagnostics_server.port
            host = self.diagnostics_server.host

        url = f"http://{host}:{port}/api/v1/health"
        logger.info("Opening loopback diagnostics URL: %s", url)

        if self.on_open_diagnostics:
            try:
                self.on_open_diagnostics()
            except Exception as err:
                logger.warning("Error invoking on_open_diagnostics callback: %s", err)
        else:
            try:
                webbrowser.open(url)
            except Exception as err:
                logger.warning("Failed to launch default browser for %s: %s", url, err)

        return url
