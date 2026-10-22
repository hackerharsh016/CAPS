"""Unit and contract tests for customer settings to native Windows DEVMODE parameters mapping.

Tests cover:
- Deterministic capability mapping across device profiles (Canon iR2006, Epson L805, HP LaserJet P1102)
- Pre-spooler rejection of unsupported options (A3 on A4 printer, color on mono, duplex on simplex)
- Copies boundary validation (1..max_copies, negative/zero rejection)
- Orientation mapping (portrait vs landscape) and Windows DMORIENT_* constants
- Selected pages resolution and PageCountMismatchError on out-of-bounds page requests
- Sheet count calculation for simplex vs duplex multi-copy print jobs
- DEVMODE fields bitmask verification (DM_ORIENTATION, DM_PAPERSIZE, DM_COLOR, DM_DUPLEX, DM_COPIES)
- Margin policy enforcement (standard 5mm hardware margins vs borderless)
- Geometry scaling policies (FIT_PAGE, FILL_PAGE, SHRINK_TO_FIT)
- Driver DEVMODE adapter verification via FakeDevModeAdapter
- Raw dictionary capability fixture fallback detection
"""

from __future__ import annotations

import unittest

from caps_agent.printing.capabilities import (
    CANON_IR2006_CAPABILITIES,
    DMPAPER_A3,
    DMPAPER_A4,
    DMPAPER_LEGAL,
    DMPAPER_LETTER,
    PrinterCapabilities,
)
from caps_agent.printing.engine import PrintSettings
from caps_agent.printing.pdf_renderer import ScalingMode
from caps_agent.printing.settings_mapper import (
    DM_COLLATE,
    DM_COLOR,
    DM_COPIES,
    DM_DUPLEX,
    DM_ORIENTATION,
    DM_PAPERSIZE,
    DMCOLLATE_TRUE,
    DMCOLOR_COLOR,
    DMCOLOR_MONOCHROME,
    DMDUP_HORIZONTAL,
    DMDUP_SIMPLEX,
    DMDUP_VERTICAL,
    DMORIENT_LANDSCAPE,
    DMORIENT_PORTRAIT,
    FakeDevModeAdapter,
    InvalidSettingValueError,
    PageCountMismatchError,
    PrintMarginPolicy,
    ScalingPolicy,
    SettingsMapper,
    UnsupportedSettingError,
)

# Canonical PrinterCapabilities fixture profiles
HP_LASERJET_P1102 = PrinterCapabilities(
    printer_id="hp-laserjet-p1102",
    name="HP LaserJet Professional P1102",
    supported_paper_sizes=("a4", "legal", "letter"),
    supported_color_modes=("bw",),
    supported_duplex=("simplex",),
    max_copies=99,
)

CANON_IR2006 = PrinterCapabilities(
    printer_id="canon-imagerunner-2006",
    name="Canon imageRUNNER 2006",
    supported_paper_sizes=("a4", "a3", "letter"),
    supported_color_modes=("bw",),
    supported_duplex=("simplex", "duplex_long", "duplex_short"),
    max_copies=99,
    supports_collate=True,
)

EPSON_L805 = PrinterCapabilities(
    printer_id="epson-l805",
    name="Epson L805 Series",
    supported_paper_sizes=("a4", "letter"),
    supported_color_modes=("bw", "color"),
    supported_duplex=("simplex",),
    max_copies=99,
)


class TestSettingsMapperHappyPath(unittest.TestCase):
    """Tests successful mapping of customer settings to native Windows DEVMODE parameters."""

    def setUp(self) -> None:
        self.fake_adapter = FakeDevModeAdapter()
        self.mapper = SettingsMapper(devmode_adapter=self.fake_adapter)

    def test_hp_laserjet_p1102_standard_bw_simplex(self) -> None:
        """HP LaserJet P1102: A4, B&W, Simplex, Portrait, 1 Copy."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=HP_LASERJET_P1102,
            total_doc_pages=3,
        )

        self.assertEqual(params.canonical_paper_size, "a4")
        self.assertEqual(params.canonical_color_mode, "bw")
        self.assertEqual(params.canonical_duplex_mode, "simplex")
        self.assertEqual(params.copies, 1)
        self.assertEqual(params.orientation, "portrait")
        self.assertEqual(params.selected_pages, (1, 2, 3))
        self.assertEqual(params.total_sheets_required, 3)

        # Inspect Windows DEVMODE fields
        dm = params.devmode
        self.assertEqual(dm.paper_size, DMPAPER_A4)
        self.assertEqual(dm.color, DMCOLOR_MONOCHROME)
        self.assertEqual(dm.duplex, DMDUP_SIMPLEX)
        self.assertEqual(dm.orientation, DMORIENT_PORTRAIT)
        self.assertEqual(dm.copies, 1)

        # Active fields bitmask
        expected_mask = DM_ORIENTATION | DM_PAPERSIZE | DM_COLOR | DM_DUPLEX | DM_COPIES
        self.assertEqual(dm.fields & expected_mask, expected_mask)

    def test_canon_ir2006_a3_bw_duplex(self) -> None:
        """Canon iR2006: A3, B&W, Duplex (long edge), Landscape, 3 Copies."""
        settings = PrintSettings(
            paper_size="A3",
            color_mode="bw",
            duplex=True,
            copies=3,
            page_range="1-5",
            orientation="landscape",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=CANON_IR2006,
            total_doc_pages=10,
        )

        self.assertEqual(params.canonical_paper_size, "a3")
        self.assertEqual(params.canonical_color_mode, "bw")
        self.assertEqual(params.canonical_duplex_mode, "duplex_long")
        self.assertEqual(params.copies, 3)
        self.assertEqual(params.orientation, "landscape")
        self.assertEqual(params.selected_pages, (1, 2, 3, 4, 5))

        # 5 pages duplex = 3 sheets per copy * 3 copies = 9 physical sheets
        self.assertEqual(params.total_sheets_required, 9)

        dm = params.devmode
        self.assertEqual(dm.paper_size, DMPAPER_A3)
        self.assertEqual(dm.duplex, DMDUP_VERTICAL)
        self.assertEqual(dm.orientation, DMORIENT_LANDSCAPE)
        self.assertEqual(dm.copies, 3)
        self.assertEqual(dm.collate, DMCOLLATE_TRUE)
        self.assertTrue(bool(dm.fields & DM_COLLATE))

    def test_epson_l805_color_simplex_letter(self) -> None:
        """Epson L805: Letter, Color, Simplex, Portrait, 2 Copies."""
        settings = PrintSettings(
            paper_size="Letter",
            color_mode="color",
            duplex=False,
            copies=2,
            page_range="2,4",
            orientation="portrait",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=EPSON_L805,
            total_doc_pages=5,
        )

        self.assertEqual(params.canonical_paper_size, "letter")
        self.assertEqual(params.canonical_color_mode, "color")
        self.assertEqual(params.canonical_duplex_mode, "simplex")
        self.assertEqual(params.selected_pages, (2, 4))
        # 2 pages * 2 copies = 4 sheets
        self.assertEqual(params.total_sheets_required, 4)

        dm = params.devmode
        self.assertEqual(dm.paper_size, DMPAPER_LETTER)
        self.assertEqual(dm.color, DMCOLOR_COLOR)
        self.assertEqual(dm.duplex, DMDUP_SIMPLEX)

    def test_short_edge_duplex_mapping(self) -> None:
        """Custom duplex: Short-edge duplex mapping (DMDUP_HORIZONTAL)."""
        caps = PrinterCapabilities(
            printer_id="custom-duplex",
            name="Custom Duplex Printer",
            supported_paper_sizes=("a4",),
            supported_color_modes=("bw",),
            supported_duplex=("simplex", "duplex_short"),
        )
        settings_short = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex="duplex_short",  # type: ignore[arg-type]
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        params = self.mapper.map_settings(settings=settings_short, capabilities=caps)
        self.assertEqual(params.canonical_duplex_mode, "duplex_short")
        self.assertEqual(params.devmode.duplex, DMDUP_HORIZONTAL)

    def test_driver_adapter_application(self) -> None:
        """Parameters can be applied to driver DEVMODE via adapter."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1",
            orientation="portrait",
        )
        params = self.mapper.map_settings(settings, HP_LASERJET_P1102)
        applied = self.mapper.apply_to_driver(params)

        self.assertEqual(len(self.fake_adapter.applied_devmodes), 1)
        self.assertEqual(applied["printer_name"], HP_LASERJET_P1102.name)
        self.assertEqual(applied["devmode"]["dmPaperSize"], DMPAPER_A4)

    def test_raw_dict_capabilities_fixture_conversion(self) -> None:
        """Raw dictionary fixtures (e.g. CANON_IR2006_CAPABILITIES) are automatically converted."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=CANON_IR2006_CAPABILITIES,
        )
        self.assertEqual(params.canonical_paper_size, "a4")
        self.assertEqual(params.canonical_color_mode, "bw")
        self.assertEqual(params.devmode.paper_size, DMPAPER_A4)


class TestSettingsPreSpoolerRejection(unittest.TestCase):
    """Tests early fail-fast rejection of unsupported options before spooler invocation."""

    def setUp(self) -> None:
        self.mapper = SettingsMapper()

    def test_reject_unsupported_paper_size(self) -> None:
        """HP LaserJet P1102 does not support A3 paper."""
        settings = PrintSettings(
            paper_size="A3",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(UnsupportedSettingError) as ctx:
            self.mapper.map_settings(settings, HP_LASERJET_P1102)
        self.assertIn("does not support paper size 'A3'", str(ctx.exception))

    def test_reject_unsupported_color_mode(self) -> None:
        """HP LaserJet P1102 is monochrome only; must reject color requests."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="color",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(UnsupportedSettingError) as ctx:
            self.mapper.map_settings(settings, HP_LASERJET_P1102)
        self.assertIn("does not support color mode 'color'", str(ctx.exception))

    def test_reject_unsupported_duplex(self) -> None:
        """Epson L805 is simplex only; must reject duplex requests."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="color",
            duplex=True,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(UnsupportedSettingError) as ctx:
            self.mapper.map_settings(settings, EPSON_L805)
        self.assertIn("does not support duplex mode", str(ctx.exception))

    def test_reject_copies_exceeding_printer_maximum(self) -> None:
        """Epson L805 supports up to 99 copies; 150 must be rejected."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="color",
            duplex=False,
            copies=150,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(UnsupportedSettingError) as ctx:
            self.mapper.map_settings(settings, EPSON_L805)
        self.assertIn("exceeds maximum supported (99)", str(ctx.exception))


class TestSettingValueValidation(unittest.TestCase):
    """Tests syntax and domain validation of individual setting values."""

    def setUp(self) -> None:
        self.mapper = SettingsMapper()

    def test_invalid_paper_size_name(self) -> None:
        """Unrecognized paper name raises InvalidSettingValueError."""
        settings = PrintSettings(
            paper_size="BespokeBannerSize",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(InvalidSettingValueError) as ctx:
            self.mapper.map_settings(settings, HP_LASERJET_P1102)
        self.assertIn("Unknown paper size", str(ctx.exception))

    def test_invalid_color_mode(self) -> None:
        """Invalid color mode raises InvalidSettingValueError."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="sepia_vintage",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(InvalidSettingValueError) as ctx:
            self.mapper.map_settings(settings, HP_LASERJET_P1102)
        self.assertIn("Invalid color mode", str(ctx.exception))

    def test_invalid_orientation(self) -> None:
        """Invalid orientation raises InvalidSettingValueError."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="diagonal_45",
        )
        with self.assertRaises(InvalidSettingValueError) as ctx:
            self.mapper.map_settings(settings, HP_LASERJET_P1102)
        self.assertIn("Invalid orientation", str(ctx.exception))

    def test_zero_or_negative_copies(self) -> None:
        """Copies <= 0 raises InvalidSettingValueError."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=0,
            page_range="all",
            orientation="portrait",
        )
        with self.assertRaises(InvalidSettingValueError) as ctx:
            self.mapper.map_settings(settings, HP_LASERJET_P1102)
        self.assertIn("Copies must be >= 1", str(ctx.exception))


class TestSelectedPagesAndRangeValidation(unittest.TestCase):
    """Tests page range parsing against total document pages."""

    def setUp(self) -> None:
        self.mapper = SettingsMapper()

    def test_page_range_exceeds_document_pages(self) -> None:
        """Page range '1-10' for 5-page document raises PageCountMismatchError."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1-10",
            orientation="portrait",
        )
        with self.assertRaises(PageCountMismatchError) as ctx:
            self.mapper.map_settings(
                settings=settings,
                capabilities=HP_LASERJET_P1102,
                total_doc_pages=5,
            )
        self.assertIn("invalid for document with 5 pages", str(ctx.exception))

    def test_inverted_page_range(self) -> None:
        """Inverted page range '5-2' raises PageCountMismatchError."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="5-2",
            orientation="portrait",
        )
        with self.assertRaises(PageCountMismatchError):
            self.mapper.map_settings(
                settings=settings,
                capabilities=HP_LASERJET_P1102,
                total_doc_pages=10,
            )

    def test_complex_valid_range_selection(self) -> None:
        """Range '1-2, 5, 7-8' for 10-page document resolves to exact tuple."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="1-2, 5, 7-8",
            orientation="portrait",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=HP_LASERJET_P1102,
            total_doc_pages=10,
        )
        self.assertEqual(params.selected_pages, (1, 2, 5, 7, 8))


class TestMarginAndScalingPolicies(unittest.TestCase):
    """Tests margin boundaries, borderless handling, and geometry scaling."""

    def setUp(self) -> None:
        self.mapper = SettingsMapper()

    def test_default_margins(self) -> None:
        """Default margin policy provides 5mm borders."""
        margins = PrintMarginPolicy()
        self.assertEqual(margins.left_mm, 5.0)
        self.assertEqual(margins.top_mm, 5.0)
        self.assertFalse(margins.is_borderless)
        # 5mm in points: 5.0 / 25.4 * 72.0 ~ 14.17 pts
        self.assertAlmostEqual(margins.left_pts, 14.17, places=1)

    def test_borderless_margins(self) -> None:
        """Borderless margin policy sets all printable offsets to 0 pts."""
        margins = PrintMarginPolicy(left_mm=3.0, top_mm=3.0, is_borderless=True)
        self.assertEqual(margins.left_pts, 0.0)
        self.assertEqual(margins.top_pts, 0.0)
        self.assertEqual(margins.right_pts, 0.0)
        self.assertEqual(margins.bottom_pts, 0.0)

    def test_custom_margins_and_scaling_in_parameters(self) -> None:
        """Custom margins and scaling policies are preserved in NativePrintParameters."""
        custom_margins = PrintMarginPolicy(left_mm=10.0, top_mm=10.0)
        custom_scaling = ScalingPolicy(
            mode=ScalingMode.SHRINK_TO_FIT,
            auto_rotate=False,
            target_dpi=600,
        )
        settings = PrintSettings(
            paper_size="Legal",
            color_mode="bw",
            duplex=False,
            copies=1,
            page_range="all",
            orientation="portrait",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=HP_LASERJET_P1102,
            margin_policy=custom_margins,
            scaling_policy=custom_scaling,
        )

        self.assertEqual(params.devmode.paper_size, DMPAPER_LEGAL)
        self.assertEqual(params.margin_policy.left_mm, 10.0)
        self.assertEqual(params.scaling_policy.mode, ScalingMode.SHRINK_TO_FIT)
        self.assertEqual(params.scaling_policy.target_dpi, 600)
        self.assertFalse(params.scaling_policy.auto_rotate)

    def test_summary_dictionary_serialization(self) -> None:
        """to_summary_dict() produces valid audit dict."""
        settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=True,
            copies=2,
            page_range="1-3",
            orientation="portrait",
        )
        params = self.mapper.map_settings(
            settings=settings,
            capabilities=CANON_IR2006,
            total_doc_pages=5,
        )
        summary = params.to_summary_dict()

        self.assertEqual(summary["printer_id"], CANON_IR2006.printer_id)
        self.assertEqual(summary["paper_size"], "a4")
        self.assertEqual(summary["color_mode"], "bw")
        self.assertEqual(summary["duplex_mode"], "duplex_long")
        self.assertEqual(summary["copies"], 2)
        self.assertEqual(summary["page_count"], 3)
        self.assertEqual(
            summary["sheets_required"], 4
        )  # (3 pages + 1)//2 = 2 sheets * 2 copies = 4
        self.assertIn("devmode", summary)
        self.assertEqual(summary["devmode"]["dmPaperSize"], DMPAPER_A4)


if __name__ == "__main__":
    unittest.main()
