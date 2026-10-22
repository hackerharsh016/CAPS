"""Windows DEVMODE settings mapper for CAPS Print Agent (INT-D4-04).

Maps customer print settings (duplex, color_mode, paper_size, copies, orientation)
into Windows DEVMODE structure and bitmasks for silent Win32 Spooler execution.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("caps_agent.printer_settings_mapper")

# ==============================================================================
# Windows DEVMODE Constants (wingdi.h / winspool.h)
# ==============================================================================

# dmOrientation
DMORIENT_PORTRAIT = 1
DMORIENT_LANDSCAPE = 2

# dmColor
DMCOLOR_MONOCHROME = 1
DMCOLOR_COLOR = 2

# dmDuplex
DMDUP_SIMPLEX = 1
DMDUP_VERTICAL = 2    # Long-edge binding
DMDUP_HORIZONTAL = 3  # Short-edge binding

# dmPaperSize
DMPAPER_LETTER = 1
DMPAPER_LEGAL = 5
DMPAPER_A3 = 8
DMPAPER_A4 = 9
DMPAPER_A5 = 11

# dmFields bitmask
DM_ORIENTATION = 0x00000001
DM_PAPERSIZE = 0x00000002
DM_SCALE = 0x00000010
DM_COPIES = 0x00000100
DM_DEFAULTSOURCE = 0x00000200
DM_COLOR = 0x00000800
DM_DUPLEX = 0x00001000
DM_COLLATE = 0x00008000

PAPER_SIZE_MAP: dict[str, int] = {
    "a4": DMPAPER_A4,
    "a3": DMPAPER_A3,
    "a5": DMPAPER_A5,
    "legal": DMPAPER_LEGAL,
    "letter": DMPAPER_LETTER,
}


@dataclass
class DevModeData:
    """Standardized representation of Windows DEVMODE fields."""

    orientation: int = DMORIENT_PORTRAIT
    paper_size: int = DMPAPER_A4
    color: int = DMCOLOR_MONOCHROME
    duplex: int = DMDUP_SIMPLEX
    copies: int = 1
    fields: int = (
        DM_ORIENTATION
        | DM_PAPERSIZE
        | DM_COLOR
        | DM_DUPLEX
        | DM_COPIES
    )

    def to_dict(self) -> dict[str, Any]:
        """Convert into dictionary matching Win32 DEVMODE structure."""
        return {
            "dmOrientation": self.orientation,
            "dmPaperSize": self.paper_size,
            "dmColor": self.color,
            "dmDuplex": self.duplex,
            "dmCopies": self.copies,
            "dmFields": self.fields,
        }


class PrinterSettingsMapper:
    """Translates CAPS print settings into Windows DEVMODE fields."""

    @staticmethod
    def map_paper_size(paper_size: str | None) -> int:
        """Map canonical paper size to Windows DMPAPER_* constant."""
        if not paper_size:
            return DMPAPER_A4
        norm = str(paper_size).strip().lower()
        return PAPER_SIZE_MAP.get(norm, DMPAPER_A4)

    @staticmethod
    def map_color_mode(color_mode: str | None) -> int:
        """Map color mode to DMCOLOR_MONOCHROME or DMCOLOR_COLOR."""
        if not color_mode:
            return DMCOLOR_MONOCHROME
        norm = str(color_mode).strip().lower()
        if norm in ("color", "colour"):
            return DMCOLOR_COLOR
        return DMCOLOR_MONOCHROME

    @staticmethod
    def map_duplex(duplex: str | bool | None, sides: str | None = None) -> int:
        """Map duplex/sides definitions to DMDUP_SIMPLEX, DMDUP_VERTICAL, or DMDUP_HORIZONTAL."""
        if isinstance(duplex, bool):
            return DMDUP_VERTICAL if duplex else DMDUP_SIMPLEX

        val = str(duplex or sides or "simplex").strip().lower()

        if val in ("duplex_short", "short_edge"):
            return DMDUP_HORIZONTAL
        if val in ("duplex_long", "long_edge", "double", "duplex", "two_sided"):
            return DMDUP_VERTICAL
        return DMDUP_SIMPLEX

    @staticmethod
    def map_orientation(orientation: str | None) -> int:
        """Map orientation to DMORIENT_PORTRAIT or DMORIENT_LANDSCAPE."""
        if not orientation:
            return DMORIENT_PORTRAIT
        norm = str(orientation).strip().lower()
        if norm in ("landscape", "land"):
            return DMORIENT_LANDSCAPE
        return DMORIENT_PORTRAIT

    @classmethod
    def map_settings_to_devmode(cls, settings: dict[str, Any]) -> DevModeData:
        """Map a full CAPS print settings dictionary to DevModeData."""
        paper_size = cls.map_paper_size(settings.get("paper_size"))
        color = cls.map_color_mode(settings.get("color_mode"))
        duplex = cls.map_duplex(settings.get("duplex"), settings.get("sides"))
        orientation = cls.map_orientation(settings.get("orientation"))

        try:
            copies = max(1, int(settings.get("copies", 1)))
        except (ValueError, TypeError):
            copies = 1

        fields = (
            DM_ORIENTATION
            | DM_PAPERSIZE
            | DM_COLOR
            | DM_DUPLEX
            | DM_COPIES
        )

        return DevModeData(
            orientation=orientation,
            paper_size=paper_size,
            color=color,
            duplex=duplex,
            copies=copies,
            fields=fields,
        )

    @classmethod
    def apply_to_win32_devmode(cls, devmode_obj: Any, settings: dict[str, Any]) -> Any:
        """Apply mapped settings directly to a native pywin32 PyDEVMODE or mock object."""
        devmode_data = cls.map_settings_to_devmode(settings)

        # Apply to attributes case-insensitively / pywin32 style
        attrs = [
            ("Orientation", devmode_data.orientation),
            ("dmOrientation", devmode_data.orientation),
            ("PaperSize", devmode_data.paper_size),
            ("dmPaperSize", devmode_data.paper_size),
            ("Color", devmode_data.color),
            ("dmColor", devmode_data.color),
            ("Duplex", devmode_data.duplex),
            ("dmDuplex", devmode_data.duplex),
            ("Copies", devmode_data.copies),
            ("dmCopies", devmode_data.copies),
            ("Fields", getattr(devmode_obj, "Fields", 0) | devmode_data.fields),
            ("dmFields", getattr(devmode_obj, "dmFields", 0) | devmode_data.fields),
        ]

        for attr, value in attrs:
            if hasattr(devmode_obj, attr):
                try:
                    setattr(devmode_obj, attr, value)
                except Exception:
                    pass

        return devmode_obj
