"""Unit, integration, and contract tests for Windows printer discovery."""

import json
import unittest
from datetime import UTC, datetime
from pathlib import Path

import jsonschema
from referencing import Registry, Resource

from caps_agent.printing.printer_discovery import (
    PRINTER_ATTRIBUTE_DEFAULT,
    PRINTER_ATTRIBUTE_LOCAL,
    PRINTER_ATTRIBUTE_WORK_OFFLINE,
    PRINTER_STATUS_BUSY,
    PRINTER_STATUS_DOOR_OPEN,
    PRINTER_STATUS_ERROR,
    PRINTER_STATUS_NO_TONER,
    PRINTER_STATUS_NOT_AVAILABLE,
    PRINTER_STATUS_OFFLINE,
    PRINTER_STATUS_PAPER_JAM,
    PRINTER_STATUS_PAPER_OUT,
    PRINTER_STATUS_PAUSED,
    PRINTER_STATUS_PRINTING,
    PRINTER_STATUS_WARMING_UP,
    DiscoveredPrinter,
    FakeWin32PrintAdapter,
    PrinterDiscovery,
    PrinterNotFoundError,
    PyWin32PrintAdapter,
    Win32PrintAdapter,
    Win32PrintNotAvailableError,
    map_win32_status,
    normalize_printer_id,
)

# Reference shared contracts
REPO_ROOT = Path(__file__).resolve().parents[2].parent
CONTRACTS_DIR = REPO_ROOT / "packages" / "print-contracts"
SCHEMA_DIR = CONTRACTS_DIR / "schema"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class TestPrinterIdNormalization(unittest.TestCase):
    """Verifies that OS printer names are normalized into valid, stable contract slugs."""

    def test_standard_printer_name(self) -> None:
        self.assertEqual(
            normalize_printer_id("Canon imageRUNNER 2006"),
            "canon-imagerunner-2006",
        )

    def test_name_with_parentheses_and_punctuation(self) -> None:
        self.assertEqual(
            normalize_printer_id("HP LaserJet Pro MFP M428fdw (Copy 1)"),
            "hp-laserjet-pro-mfp-m428fdw-copy-1",
        )

    def test_name_with_slashes_and_symbols(self) -> None:
        self.assertEqual(
            normalize_printer_id("Epson L805 / Photo-Color #2!"),
            "epson-l805-photo-color-2",
        )

    def test_pdf_printer_name(self) -> None:
        self.assertEqual(
            normalize_printer_id("Microsoft Print to PDF"),
            "microsoft-print-to-pdf",
        )

    def test_empty_or_whitespace_name(self) -> None:
        self.assertEqual(normalize_printer_id(""), "printer-device")
        self.assertEqual(normalize_printer_id("   "), "printer-device")
        self.assertEqual(normalize_printer_id("---"), "printer-device")


class TestPrinterStatusMapping(unittest.TestCase):
    """Verifies that Win32 PRINTER_STATUS_* bitmasks map to CAPS PrinterStatus enum."""

    def test_online_when_flags_zero(self) -> None:
        self.assertEqual(map_win32_status(0, 0), "online")

    def test_error_states(self) -> None:
        for flag in [
            PRINTER_STATUS_ERROR,
            PRINTER_STATUS_PAPER_JAM,
            PRINTER_STATUS_PAPER_OUT,
            PRINTER_STATUS_NO_TONER,
            PRINTER_STATUS_DOOR_OPEN,
        ]:
            with self.subTest(flag=hex(flag)):
                self.assertEqual(map_win32_status(flag, 0), "error")

    def test_offline_states(self) -> None:
        for flag in [
            PRINTER_STATUS_OFFLINE,
            PRINTER_STATUS_PAUSED,
            PRINTER_STATUS_NOT_AVAILABLE,
        ]:
            with self.subTest(flag=hex(flag)):
                self.assertEqual(map_win32_status(flag, 0), "offline")

    def test_work_offline_attribute_overrides_ready(self) -> None:
        self.assertEqual(map_win32_status(0, PRINTER_ATTRIBUTE_WORK_OFFLINE), "offline")

    def test_busy_states(self) -> None:
        for flag in [
            PRINTER_STATUS_BUSY,
            PRINTER_STATUS_PRINTING,
            PRINTER_STATUS_WARMING_UP,
        ]:
            with self.subTest(flag=hex(flag)):
                self.assertEqual(map_win32_status(flag, 0), "busy")

    def test_status_precedence_error_over_busy_and_offline(self) -> None:
        # Error bit should take precedence even if printing or offline flag is set
        mixed = PRINTER_STATUS_ERROR | PRINTER_STATUS_PRINTING
        self.assertEqual(map_win32_status(mixed, 0), "error")

    def test_status_precedence_offline_over_busy(self) -> None:
        mixed = PRINTER_STATUS_OFFLINE | PRINTER_STATUS_BUSY
        self.assertEqual(map_win32_status(mixed, 0), "offline")


class TestFakeWin32AdapterDiscovery(unittest.TestCase):
    """Tests the discovery service using the in-memory FakeWin32PrintAdapter."""

    def setUp(self) -> None:
        self.adapter = FakeWin32PrintAdapter(default_printer="Canon imageRUNNER 2006")
        self.adapter.add_printer(
            name="Canon imageRUNNER 2006",
            port="192.168.1.50",
            driver="Canon Generic Plus UFR II",
            attributes=PRINTER_ATTRIBUTE_LOCAL | PRINTER_ATTRIBUTE_DEFAULT,
            status=0,
            location="Reception Counter",
        )
        self.adapter.add_printer(
            name="Epson L805",
            port="USB001",
            driver="Epson L805 Series",
            attributes=PRINTER_ATTRIBUTE_LOCAL,
            status=PRINTER_STATUS_PAPER_JAM,
            location="Photo Desk",
        )
        self.adapter.add_printer(
            name="Brother HL-L2321D",
            port="USB002",
            driver="Brother HL-L2320D series",
            attributes=PRINTER_ATTRIBUTE_LOCAL,
            status=PRINTER_STATUS_OFFLINE,
        )
        self.discovery = PrinterDiscovery(adapter=self.adapter)

    def test_adapter_satisfies_protocol(self) -> None:
        self.assertIsInstance(self.adapter, Win32PrintAdapter)

    def test_enumerate_printers_sorting_and_fields(self) -> None:
        printers = self.discovery.enumerate_printers()
        self.assertEqual(len(printers), 3)

        # Default printer must be first
        self.assertEqual(printers[0].name, "Canon imageRUNNER 2006")
        self.assertEqual(printers[0].printer_id, "canon-imagerunner-2006")
        self.assertTrue(printers[0].is_default)
        self.assertEqual(printers[0].status, "online")
        self.assertEqual(printers[0].port_name, "192.168.1.50")
        self.assertEqual(printers[0].driver_name, "Canon Generic Plus UFR II")
        self.assertEqual(printers[0].location, "Reception Counter")

        # Remaining printers must be sorted alphabetically by name
        self.assertEqual(printers[1].name, "Brother HL-L2321D")
        self.assertEqual(printers[1].printer_id, "brother-hl-l2321d")
        self.assertFalse(printers[1].is_default)
        self.assertEqual(printers[1].status, "offline")

        self.assertEqual(printers[2].name, "Epson L805")
        self.assertEqual(printers[2].printer_id, "epson-l805")
        self.assertFalse(printers[2].is_default)
        self.assertEqual(printers[2].status, "error")

    def test_get_default_printer(self) -> None:
        default_p = self.discovery.get_default_printer()
        self.assertIsNotNone(default_p)
        assert default_p is not None
        self.assertEqual(default_p.name, "Canon imageRUNNER 2006")
        self.assertTrue(default_p.is_default)

    def test_get_printer_by_id(self) -> None:
        found = self.discovery.get_printer_by_id("brother-hl-l2321d")
        self.assertIsNotNone(found)
        assert found is not None
        self.assertEqual(found.name, "Brother HL-L2321D")

        # Unknown ID returns None
        self.assertIsNone(self.discovery.get_printer_by_id("non-existent-printer"))

    def test_get_printer_by_name(self) -> None:
        found = self.discovery.get_printer_by_name("epson l805")
        self.assertIsNotNone(found)
        assert found is not None
        self.assertEqual(found.printer_id, "epson-l805")

        self.assertIsNone(self.discovery.get_printer_by_name("Missing Printer"))

    def test_empty_printers_spooler(self) -> None:
        empty_adapter = FakeWin32PrintAdapter(printers=[], default_printer=None)
        empty_discovery = PrinterDiscovery(adapter=empty_adapter)

        self.assertEqual(empty_discovery.enumerate_printers(), [])
        self.assertIsNone(empty_discovery.get_default_printer())

    def test_simulated_adapter_error(self) -> None:
        error_adapter = FakeWin32PrintAdapter(
            simulated_error=RuntimeError("Win32 spooler RPC service terminated")
        )
        error_discovery = PrinterDiscovery(adapter=error_adapter)

        with self.assertRaises(RuntimeError) as ctx:
            error_discovery.enumerate_printers()
        self.assertIn("RPC service terminated", str(ctx.exception))

    def test_fake_adapter_get_printer(self) -> None:
        details = self.adapter.get_printer("Canon imageRUNNER 2006")
        self.assertEqual(details["printer_name"], "Canon imageRUNNER 2006")

        with self.assertRaises(PrinterNotFoundError):
            self.adapter.get_printer("Unknown Hardware")


class TestContractConformance(unittest.TestCase):
    """Verifies discovered printer outputs strictly conform to packages/print-contracts JSON Schema."""

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

    def test_discovered_printer_contract_payload_validity(self) -> None:
        discovered = DiscoveredPrinter(
            printer_id="canon-ir2006",
            name="Canon imageRUNNER 2006",
            is_default=True,
            status="online",
            port_name="192.168.1.50",
            driver_name="Canon Generic UFR II",
            last_seen_at=datetime(2026, 10, 19, 12, 0, 0, tzinfo=UTC),
        )

        printer_dict = discovered.to_contract_dict(
            supported_paper_sizes=["a4", "a3"],
            supported_color_modes=["bw"],
            supported_duplex=["simplex", "duplex_long"],
        )

        # Assemble full capabilities payload to validate against capabilities.schema.json
        capabilities_payload = {
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
        validator.validate(capabilities_payload)


class TestNativeWindowsPyWin32Smoke(unittest.TestCase):
    """Smoke test exercising native Windows discovery when pywin32 is present."""

    def test_native_pywin32_smoke(self) -> None:
        try:
            adapter = PyWin32PrintAdapter()
        except Win32PrintNotAvailableError:
            self.skipTest("pywin32 is not installed or available on this platform")

        discovery = PrinterDiscovery(adapter=adapter)
        printers = discovery.enumerate_printers()

        # On native Windows, there should typically be at least default virtual printers (e.g. PDF/XPS)
        self.assertIsInstance(printers, list)
        for p in printers:
            self.assertIsInstance(p, DiscoveredPrinter)
            self.assertTrue(len(p.printer_id) > 0)
            self.assertTrue(len(p.name) > 0)
            self.assertIn(p.status, ["online", "offline", "busy", "error"])
            self.assertIsInstance(p.is_default, bool)


if __name__ == "__main__":
    unittest.main()
