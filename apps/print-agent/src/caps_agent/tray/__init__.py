"""CAPS Agent System Tray UI package."""

from caps_agent.tray.controller import (
    BaseTrayAdapter,
    DesktopTrayAdapter,
    HeadlessTrayAdapter,
    TrayController,
    TrayStateSnapshot,
    TrayStatus,
)

__all__ = [
    "BaseTrayAdapter",
    "DesktopTrayAdapter",
    "HeadlessTrayAdapter",
    "TrayController",
    "TrayStateSnapshot",
    "TrayStatus",
]
