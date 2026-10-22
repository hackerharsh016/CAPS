"""Unit tests for PrinterSettingsMapper (INT-D4-04)."""

import unittest
from printer_settings_mapper import (
    DM_COLOR,
    DM_COPIES,
    DM_DUPLEX,
    DM_ORIENTATION,
    DM_PAPERSIZE,
    DMCOLOR_COLOR,
    DMCOLOR_MONOCHROME,
    DMDUP_HORIZONTAL,
    DMDUP_SIMPLEX,
    DMDUP_VERTICAL,
    DMORIENT_LANDSCAPE,
    DMORIENT_PORTRAIT,
    DMPAPER_A3,
    DMPAPER_A4,
    DMPAPER_A5,
    DMPAPER_LEGAL,
    DMPAPER_LETTER,
    PrinterSettingsMapper,
)


class TestPrinterSettingsMapper(unittest.TestCase):
    def test_paper_size_mapping(self):
        self.assertEqual(PrinterSettingsMapper.map_paper_size("a4"), DMPAPER_A4)
        self.assertEqual(PrinterSettingsMapper.map_paper_size("A4"), DMPAPER_A4)
        self.assertEqual(PrinterSettingsMapper.map_paper_size("a3"), DMPAPER_A3)
        self.assertEqual(PrinterSettingsMapper.map_paper_size("legal"), DMPAPER_LEGAL)
        self.assertEqual(PrinterSettingsMapper.map_paper_size("letter"), DMPAPER_LETTER)
        self.assertEqual(PrinterSettingsMapper.map_paper_size("unknown_format"), DMPAPER_A4)
        self.assertEqual(PrinterSettingsMapper.map_paper_size(None), DMPAPER_A4)

    def test_color_mode_mapping(self):
        self.assertEqual(PrinterSettingsMapper.map_color_mode("bw"), DMCOLOR_MONOCHROME)
        self.assertEqual(PrinterSettingsMapper.map_color_mode("monochrome"), DMCOLOR_MONOCHROME)
        self.assertEqual(PrinterSettingsMapper.map_color_mode("color"), DMCOLOR_COLOR)
        self.assertEqual(PrinterSettingsMapper.map_color_mode("colour"), DMCOLOR_COLOR)
        self.assertEqual(PrinterSettingsMapper.map_color_mode(None), DMCOLOR_MONOCHROME)

    def test_duplex_mapping(self):
        # Simplex
        self.assertEqual(PrinterSettingsMapper.map_duplex("simplex"), DMDUP_SIMPLEX)
        self.assertEqual(PrinterSettingsMapper.map_duplex("single"), DMDUP_SIMPLEX)
        self.assertEqual(PrinterSettingsMapper.map_duplex(False), DMDUP_SIMPLEX)

        # Duplex Long Edge
        self.assertEqual(PrinterSettingsMapper.map_duplex("duplex_long"), DMDUP_VERTICAL)
        self.assertEqual(PrinterSettingsMapper.map_duplex("double"), DMDUP_VERTICAL)
        self.assertEqual(PrinterSettingsMapper.map_duplex("two_sided"), DMDUP_VERTICAL)
        self.assertEqual(PrinterSettingsMapper.map_duplex(True), DMDUP_VERTICAL)

        # Duplex Short Edge
        self.assertEqual(PrinterSettingsMapper.map_duplex("duplex_short"), DMDUP_HORIZONTAL)
        self.assertEqual(PrinterSettingsMapper.map_duplex("short_edge"), DMDUP_HORIZONTAL)

    def test_orientation_mapping(self):
        self.assertEqual(PrinterSettingsMapper.map_orientation("portrait"), DMORIENT_PORTRAIT)
        self.assertEqual(PrinterSettingsMapper.map_orientation("landscape"), DMORIENT_LANDSCAPE)
        self.assertEqual(PrinterSettingsMapper.map_orientation(None), DMORIENT_PORTRAIT)

    def test_full_settings_to_devmode(self):
        settings = {
            "paper_size": "a4",
            "color_mode": "color",
            "duplex": "duplex_long",
            "orientation": "landscape",
            "copies": 3,
        }

        devmode = PrinterSettingsMapper.map_settings_to_devmode(settings)

        self.assertEqual(devmode.paper_size, DMPAPER_A4)
        self.assertEqual(devmode.color, DMCOLOR_COLOR)
        self.assertEqual(devmode.duplex, DMDUP_VERTICAL)
        self.assertEqual(devmode.orientation, DMORIENT_LANDSCAPE)
        self.assertEqual(devmode.copies, 3)

        expected_fields = (
            DM_ORIENTATION
            | DM_PAPERSIZE
            | DM_COLOR
            | DM_DUPLEX
            | DM_COPIES
        )
        self.assertEqual(devmode.fields, expected_fields)

        as_dict = devmode.to_dict()
        self.assertEqual(as_dict["dmOrientation"], DMORIENT_LANDSCAPE)
        self.assertEqual(as_dict["dmPaperSize"], DMPAPER_A4)
        self.assertEqual(as_dict["dmColor"], DMCOLOR_COLOR)
        self.assertEqual(as_dict["dmDuplex"], DMDUP_VERTICAL)
        self.assertEqual(as_dict["dmCopies"], 3)

    def test_apply_to_mock_pydevmode(self):
        class MockPyDevMode:
            def __init__(self):
                self.Orientation = 0
                self.PaperSize = 0
                self.Color = 0
                self.Duplex = 0
                self.Copies = 0
                self.Fields = 0

        target = MockPyDevMode()
        settings = {
            "paper_size": "legal",
            "color_mode": "bw",
            "duplex": "simplex",
            "copies": 2,
        }

        PrinterSettingsMapper.apply_to_win32_devmode(target, settings)

        self.assertEqual(target.PaperSize, DMPAPER_LEGAL)
        self.assertEqual(target.Color, DMCOLOR_MONOCHROME)
        self.assertEqual(target.Duplex, DMDUP_SIMPLEX)
        self.assertEqual(target.Copies, 2)
        self.assertTrue(target.Fields & DM_PAPERSIZE)
        self.assertTrue(target.Fields & DM_COLOR)
        self.assertTrue(target.Fields & DM_DUPLEX)
        self.assertTrue(target.Fields & DM_COPIES)


if __name__ == "__main__":
    unittest.main()
