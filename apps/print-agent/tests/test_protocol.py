"""Tests the PrintEngine protocol and FakePrintEngine test double."""

import unittest
from pathlib import Path

from caps_agent.printing.engine import PrintEngine, PrintResult, PrintSettings
from caps_agent.printing.fake_engine import FakePrintEngine


class TestPrintEngineProtocol(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = PrintSettings(
            paper_size="A4",
            color_mode="bw",
            duplex=True,
            copies=2,
            page_range="1-10",
            orientation="portrait",
        )
        self.doc_path = Path("/tmp/test_invoice.pdf")

    def test_fake_implements_protocol(self) -> None:
        engine = FakePrintEngine()
        self.assertIsInstance(engine, PrintEngine)

    def test_fake_print_success(self) -> None:
        engine = FakePrintEngine(simulated_spooler_job_id=4001)
        result = engine.print_document(self.doc_path, "HP LaserJet Pro", self.settings)

        self.assertIsInstance(result, PrintResult)
        self.assertTrue(result.accepted)
        self.assertEqual(result.spooler_job_id, 4001)
        self.assertIsNone(result.error)

        self.assertEqual(len(engine.submission_log), 1)
        logged = engine.submission_log[0]
        self.assertEqual(logged["printer_name"], "HP LaserJet Pro")
        self.assertEqual(logged["settings"], self.settings)

    def test_fake_print_failure_simulation(self) -> None:
        engine = FakePrintEngine(
            should_succeed=False,
            simulated_error="Printer paper jam in tray 2"
        )
        result = engine.print_document(self.doc_path, "Canon LBP2900", self.settings)

        self.assertFalse(result.accepted)
        self.assertIsNone(result.spooler_job_id)
        self.assertEqual(result.error, "Printer paper jam in tray 2")


if __name__ == "__main__":
    unittest.main()
