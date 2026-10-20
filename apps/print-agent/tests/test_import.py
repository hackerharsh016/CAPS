"""Tests package import and export surface."""

import unittest


class TestPackageImport(unittest.TestCase):
    def test_import_and_version(self) -> None:
        import caps_agent

        self.assertEqual(caps_agent.__version__, "0.1.0")
        self.assertTrue(hasattr(caps_agent, "AgentConfig"))
        self.assertTrue(hasattr(caps_agent, "load_config"))
        self.assertTrue(hasattr(caps_agent, "PrintEngine"))
        self.assertTrue(hasattr(caps_agent, "PrintSettings"))
        self.assertTrue(hasattr(caps_agent, "PrintResult"))
        self.assertTrue(hasattr(caps_agent, "WindowsPrintEngine"))
        self.assertTrue(hasattr(caps_agent, "StandardPrintEngine"))
        self.assertTrue(hasattr(caps_agent, "PrintEngineError"))
        self.assertTrue(hasattr(caps_agent, "FakePrintEngine"))
        self.assertTrue(hasattr(caps_agent, "JobDispatcher"))
        self.assertTrue(hasattr(caps_agent, "JobItem"))
        self.assertTrue(hasattr(caps_agent, "JobState"))
        self.assertTrue(hasattr(caps_agent, "JobStateMachine"))
        self.assertTrue(hasattr(caps_agent, "setup_logging"))
        self.assertTrue(hasattr(caps_agent, "redact_sensitive_data"))


if __name__ == "__main__":
    unittest.main()
