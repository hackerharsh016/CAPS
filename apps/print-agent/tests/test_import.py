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
        self.assertTrue(hasattr(caps_agent, "StartupRecoveryCoordinator"))
        self.assertTrue(hasattr(caps_agent, "RecoveryReport"))
        self.assertTrue(hasattr(caps_agent, "ReconciledJob"))
        self.assertTrue(hasattr(caps_agent, "LocalStateJournal"))
        self.assertTrue(hasattr(caps_agent, "JobAttemptRecord"))
        self.assertTrue(hasattr(caps_agent, "TempFileManager"))
        self.assertTrue(hasattr(caps_agent, "ArtifactCleaner"))
        self.assertTrue(hasattr(caps_agent, "CleanupReport"))
        self.assertTrue(hasattr(caps_agent, "setup_logging"))
        self.assertTrue(hasattr(caps_agent, "redact_sensitive_data"))
        self.assertTrue(hasattr(caps_agent, "AgentCredentials"))
        self.assertTrue(hasattr(caps_agent, "CredentialStore"))
        self.assertTrue(hasattr(caps_agent, "PairingManager"))
        self.assertTrue(hasattr(caps_agent, "CloudApiClient"))
        self.assertTrue(hasattr(caps_agent, "CloudApiError"))
        self.assertTrue(hasattr(caps_agent, "AuthenticationError"))
        self.assertTrue(hasattr(caps_agent, "TenantMismatchError"))
        self.assertTrue(hasattr(caps_agent, "JobClaimResponse"))
        self.assertTrue(hasattr(caps_agent, "RealtimeClient"))
        self.assertTrue(hasattr(caps_agent, "RealtimeClaimCoordinator"))
        self.assertTrue(hasattr(caps_agent, "RealtimeWakeEvent"))
        self.assertTrue(hasattr(caps_agent, "RealtimeTransport"))
        self.assertTrue(hasattr(caps_agent, "MockRealtimeTransport"))
        self.assertTrue(hasattr(caps_agent, "RealtimeError"))


if __name__ == "__main__":
    unittest.main()
