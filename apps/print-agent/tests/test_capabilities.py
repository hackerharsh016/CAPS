"""Unit, integration, and contract tests for printer capability detection."""

import json
import unittest
from datetime import UTC, datetime
from pathlib import Path

import jsonschema
from referencing import Registry, Resource

from caps_agent.printing.capabilities import (
    CANON_IR2006_CAPABILITIES,
    DC_COLORDEVICE,
    DC_DUPLEX,
    DC_PAPERNAMES,
    DC_PAPERS,
    DMPAPER_A3,
    DMPAPER_A4,
    DMPAPER_LEGAL,
    DMPAPER_LETTER,
    EPSON_L805_CAPABILITIES,
    HP_LASERJET_P1102_CAPABILITIES,
    CapabilityDetector,
    PrinterCapabilities,
    map_color_modes,
    map_duplex_modes,
    map_paper_sizes,
    map_trays,
)
from caps_agent.printing.printer_discovery import (
    FakeWin32PrintAdapter,
    PyWin32PrintAdapter,
    Win32PrintNotAvailableError,
)

# Reference shared contracts
REPO_ROOT = Path(__file__).resolve().parents[2].parent
CONTRACTS_DIR = REPO_ROOT / "packages" / "print-contracts"
SCHEMA_DIR = CONTRACTS_DIR / "schema"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class TestPaperSizeMapping(unittest.TestCase):
    """Verifies mapping of Win32 paper IDs and driver paper names to CAPS schema."""

    def test_map_standard_paper_ids(self) -> None:
        paper_ids = [DMPAPER_LETTER, DMPAPER_LEGAL, DMPAPER_A4, DMPAPER_A3]
        sizes, reasons = map_paper_sizes(paper_ids, None)

        self.assertEqual(sizes, ["a4", "a3", "legal", "letter"])
        self.assertEqual(len(reasons), 0)

    def test_map_paper_names_case_insensitive(self) -> None:
        paper_names = ["Letter 8.5x11", "Custom A4 Sheet", "Legal Extra", "A3 Ledger Size"]
        sizes, reasons = map_paper_sizes(None, paper_names)

        self.assertEqual(sizes, ["a4", "a3", "legal", "letter"])
        self.assertEqual(len(reasons), 0)

    def test_fallback_when_no_standard_paper_recognized(self) -> None:
        paper_names = ["Photo 4x6 in", "Envelope #10", "Index Card 3x5"]
        sizes, reasons = map_paper_sizes(None, paper_names)

        self.assertEqual(sizes, ["a4"])
        self.assertEqual(len(reasons), 1)
        self.assertIn("defaulted to ['a4']", reasons[0])


class TestColorModeMapping(unittest.TestCase):
    """Verifies mapping of DC_COLORDEVICE to CAPS color modes."""

    def test_color_supported(self) -> None:
        modes, unknown, reasons = map_color_modes(1)
        self.assertEqual(modes, ["bw", "color"])
        self.assertEqual(unknown, [])
        self.assertEqual(reasons, [])

    def test_monochrome_only(self) -> None:
        modes, unknown, reasons = map_color_modes(0)
        self.assertEqual(modes, ["bw"])
        self.assertEqual(unknown, [])
        self.assertEqual(len(reasons), 1)
        self.assertIn("monochrome device only", reasons[0])

    def test_unknown_or_failed_color_query(self) -> None:
        modes, unknown, reasons = map_color_modes(None)
        self.assertEqual(modes, ["bw"])
        self.assertEqual(unknown, ["color"])
        self.assertEqual(len(reasons), 1)
        self.assertIn("defaulting to monochrome", reasons[0])


class TestDuplexModeMapping(unittest.TestCase):
    """Verifies mapping of DC_DUPLEX to CAPS duplex modes."""

    def test_duplex_supported(self) -> None:
        modes, unknown, reasons = map_duplex_modes(1)
        self.assertEqual(modes, ["simplex", "duplex_long", "duplex_short"])
        self.assertEqual(unknown, [])
        self.assertEqual(reasons, [])

    def test_simplex_only_limited_duplex(self) -> None:
        modes, unknown, reasons = map_duplex_modes(0)
        self.assertEqual(modes, ["simplex"])
        self.assertEqual(unknown, [])
        self.assertEqual(len(reasons), 1)
        self.assertIn("Duplex unit absent or not reported", reasons[0])

    def test_unknown_or_failed_duplex_query(self) -> None:
        modes, unknown, reasons = map_duplex_modes(None)
        self.assertEqual(modes, ["simplex"])
        self.assertEqual(unknown, ["duplex"])
        self.assertEqual(len(reasons), 1)
        self.assertIn("defaulting to single-sided", reasons[0])


class TestTrayMapping(unittest.TestCase):
    """Verifies mapping and cleaning of input bins / trays."""

    def test_clean_trays(self) -> None:
        raw_trays = [" Auto Select ", "Tray 1 (Cassette)", "Bypass Tray ", "Tray 1 (Cassette)"]
        trays = map_trays(raw_trays)
        self.assertEqual(trays, ["Auto Select", "Tray 1 (Cassette)", "Bypass Tray"])

    def test_empty_tray_fallback(self) -> None:
        self.assertEqual(map_trays(None), ["Auto"])
        self.assertEqual(map_trays([]), ["Auto"])


class TestDeviceCapabilityFixtures(unittest.TestCase):
    """Verifies detection using known equipment profiles (monochrome, duplex-limited, photo)."""

    def setUp(self) -> None:
        self.adapter = FakeWin32PrintAdapter()
        self.detector = CapabilityDetector(adapter=self.adapter)

    def test_canon_ir2006_monochrome_duplex_mfp(self) -> None:
        """Canon imageRUNNER 2006: High-capacity monochrome A3/A4 office MFP with duplex."""
        p_name = "Canon imageRUNNER 2006"
        for cap, val in CANON_IR2006_CAPABILITIES.items():
            self.adapter.set_capability(p_name, cap, val)

        caps = self.detector.detect_capabilities(p_name)

        self.assertEqual(caps.printer_id, "canon-imagerunner-2006")
        self.assertEqual(caps.name, p_name)
        self.assertEqual(caps.supported_paper_sizes, ("a4", "a3", "letter"))
        self.assertEqual(caps.supported_color_modes, ("bw",))
        self.assertEqual(caps.supported_duplex, ("simplex", "duplex_long", "duplex_short"))
        self.assertTrue(caps.is_paper_size_supported("A4"))
        self.assertTrue(caps.is_paper_size_supported("a3"))
        self.assertFalse(caps.is_paper_size_supported("legal"))
        self.assertTrue(caps.is_color_mode_supported("bw"))
        self.assertFalse(caps.is_color_mode_supported("color"))
        self.assertTrue(caps.is_duplex_supported(True))
        self.assertTrue(caps.is_duplex_supported("duplex_long"))
        self.assertEqual(len(caps.supported_trays), 4)
        self.assertIn("Drawer 1", caps.supported_trays)

        # Owner diagnostic reason for monochrome
        self.assertTrue(any("monochrome" in r.lower() for r in caps.diagnostic_reasons))

    def test_epson_l805_color_simplex_limited(self) -> None:
        """Epson L805: Color 6-ink photo printer with single-sided feed (duplex-limited)."""
        p_name = "Epson L805 Photo Inkjet"
        for cap, val in EPSON_L805_CAPABILITIES.items():
            self.adapter.set_capability(p_name, cap, val)

        caps = self.detector.detect_capabilities(p_name)

        self.assertEqual(caps.printer_id, "epson-l805-photo-inkjet")
        self.assertEqual(caps.supported_paper_sizes, ("a4", "letter"))
        self.assertEqual(caps.supported_color_modes, ("bw", "color"))
        self.assertEqual(caps.supported_duplex, ("simplex",))
        self.assertTrue(caps.is_color_mode_supported("color"))
        self.assertTrue(caps.is_color_mode_supported("bw"))
        self.assertFalse(caps.is_duplex_supported(True))
        self.assertTrue(caps.is_duplex_supported(False))
        self.assertTrue(caps.is_duplex_supported("simplex"))

        # Owner diagnostic reason for duplex limitation
        self.assertTrue(any("duplex" in r.lower() for r in caps.diagnostic_reasons))

    def test_hp_p1102_budget_monochrome_simplex_limited(self) -> None:
        """HP LaserJet P1102: Budget desktop laser (monochrome, no duplex)."""
        p_name = "HP LaserJet Professional P1102"
        for cap, val in HP_LASERJET_P1102_CAPABILITIES.items():
            self.adapter.set_capability(p_name, cap, val)

        caps = self.detector.detect_capabilities(p_name)

        self.assertEqual(caps.supported_color_modes, ("bw",))
        self.assertEqual(caps.supported_duplex, ("simplex",))
        self.assertFalse(caps.is_duplex_supported(True))
        self.assertFalse(caps.is_color_mode_supported("color"))

    def test_unknown_device_with_capability_query_failures(self) -> None:
        """Test resilience when a driver fails or crashes during capability queries."""
        p_name = "Faulty Virtual Printer"
        self.adapter.set_capability(p_name, DC_PAPERS, RuntimeError("RPC failure"))
        self.adapter.set_capability(p_name, DC_PAPERNAMES, RuntimeError("Access Denied"))
        self.adapter.set_capability(p_name, DC_COLORDEVICE, RuntimeError("Spooler error"))
        self.adapter.set_capability(p_name, DC_DUPLEX, RuntimeError("Driver fault"))

        caps = self.detector.detect_capabilities(p_name)

        # Fallbacks must prevent crash
        self.assertEqual(caps.supported_paper_sizes, ("a4",))
        self.assertEqual(caps.supported_color_modes, ("bw",))
        self.assertEqual(caps.supported_duplex, ("simplex",))
        self.assertIn("paper_ids", caps.unknown_features)
        self.assertIn("paper_names", caps.unknown_features)
        self.assertIn("color", caps.unknown_features)
        self.assertIn("duplex", caps.unknown_features)
        self.assertTrue(len(caps.diagnostic_reasons) >= 3)


class TestContractConformance(unittest.TestCase):
    """Verifies that PrinterCapabilities payload strictly satisfies JSON Schema contracts."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.common_schema = load_json(SCHEMA_DIR / "common.schema.json")
        cls.capabilities_schema = load_json(SCHEMA_DIR / "capabilities.schema.json")

        cls.registry = (
            Registry()
            .with_resource("common.schema.json", Resource.from_contents(cls.common_schema))
            .with_resource(
                "https://caps.internal/schemas/common.schema.json",
                Resource.from_contents(cls.common_schema),
            )
            .with_resource(
                "capabilities.schema.json", Resource.from_contents(cls.capabilities_schema)
            )
            .with_resource(
                "https://caps.internal/schemas/capabilities.schema.json",
                Resource.from_contents(cls.capabilities_schema),
            )
        )

    def test_capabilities_to_contract_dict(self) -> None:
        caps = PrinterCapabilities(
            printer_id="canon-ir2006",
            name="Canon imageRUNNER 2006",
            supported_paper_sizes=("a4", "a3"),
            supported_color_modes=("bw",),
            supported_duplex=("simplex", "duplex_long"),
            supported_trays=("Drawer 1", "Drawer 2"),
        )

        printer_dict = caps.to_contract_dict(
            is_default=True,
            status="online",
            last_seen_at=datetime(2026, 10, 19, 12, 0, 0, tzinfo=UTC),
        )

        full_payload = {
            "contract_version": "1.0.0",
            "agent_device_id": "win-agent-shop-01",
            "agent_version": "0.1.0",
            "shop_id": "11111111-1111-4111-8111-111111111111",
            "printers": [printer_dict],
            "reported_at": "2026-10-19T12:00:00Z",
        }

        validator = jsonschema.Draft202012Validator(
            self.capabilities_schema,
            registry=self.registry,
        )
        validator.validate(full_payload)


class TestRealWindowsPrinterCapabilitiesSmoke(unittest.TestCase):
    """Smoke test exercising native Windows driver capability queries when pywin32 is present."""

    def test_native_capabilities_smoke(self) -> None:
        try:
            adapter = PyWin32PrintAdapter()
        except Win32PrintNotAvailableError:
            self.skipTest("pywin32 is not available on this platform")

        detector = CapabilityDetector(adapter=adapter)
        raw_printers = adapter.enum_printers(2 | 4)
        if not raw_printers:
            self.skipTest("No Windows printers installed to query")

        target_printer = raw_printers[0].get("printer_name")
        self.assertIsNotNone(target_printer)
        assert target_printer is not None

        caps = detector.detect_capabilities(target_printer)
        self.assertIsInstance(caps, PrinterCapabilities)
        self.assertEqual(caps.name, target_printer)
        self.assertTrue(len(caps.supported_paper_sizes) >= 1)
        self.assertTrue(len(caps.supported_color_modes) >= 1)
        self.assertTrue(len(caps.supported_duplex) >= 1)


if __name__ == "__main__":
    unittest.main()
