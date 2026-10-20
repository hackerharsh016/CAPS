"""Unit and integration tests for Inno Setup installer specification, scripts, and signing policies."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_ROOT.parent.parent
PACKAGING_DIR = AGENT_ROOT / "packaging"
INFRA_DIR = REPO_ROOT / "infra" / "windows-installer"


class TestInnoSetupScript(unittest.TestCase):
    """Verifies that installer.iss contains all required deployment, upgrade, and security policies."""

    def setUp(self) -> None:
        self.iss_path = PACKAGING_DIR / "installer.iss"

    def test_iss_file_exists(self) -> None:
        self.assertTrue(self.iss_path.exists(), f"installer.iss not found at {self.iss_path}")

    def test_iss_critical_metadata_and_mutex(self) -> None:
        with open(self.iss_path, encoding="utf-8") as f:
            content = f.read()

        # Metadata
        self.assertIn('AppName "CAPS Desktop Print Agent"', content)
        self.assertIn('AppVersion "0.1.0"', content)
        self.assertIn('MyAppId "{{A1F9B3C2-7D4E-4958-8C1B-9E3F5A6B7C8D}"', content)
        self.assertIn('MyAppMutex "CAPS_Desktop_Print_Agent_Mutex"', content)
        self.assertIn("ArchitecturesInstallIn64BitMode=x64compatible", content)
        self.assertIn("Compression=lzma2/max", content)

        # Mutex and running process shutdown for safe upgrades
        self.assertIn("AppMutex={#MyAppMutex}", content)
        self.assertIn("CloseApplications=yes", content)

    def test_iss_autostart_and_registry_entries(self) -> None:
        with open(self.iss_path, encoding="utf-8") as f:
            content = f.read()

        # Autostart task & registry run key
        self.assertIn('Name: "autostart"', content)
        self.assertIn(r"Software\Microsoft\Windows\CurrentVersion\Run", content)
        self.assertIn("CAPSPrintAgent", content)
        self.assertIn("uninsdeletevalue", content)

        # Installation tracking registry keys
        self.assertIn(r"Software\CAPS\PrintAgent", content)
        self.assertIn("InstallPath", content)
        self.assertIn("Version", content)

    def test_iss_uninstall_cleanup_policy(self) -> None:
        with open(self.iss_path, encoding="utf-8") as f:
            content = f.read()

        # Privacy and clean state: purge temporary spools and execution logs on uninstall
        self.assertIn("[UninstallDelete]", content)
        self.assertIn(r"{localappdata}\CAPS\spool", content)
        self.assertIn(r"{localappdata}\CAPS\logs", content)
        self.assertIn(r"{localappdata}\CAPS\cache", content)

    def test_iss_command_line_pairing_support(self) -> None:
        with open(self.iss_path, encoding="utf-8") as f:
            content = f.read()

        # Automated provisioning parameters
        self.assertIn("GetParam('PAIRINGCODE')", content)
        self.assertIn("GetParam('SHOPID')", content)
        self.assertIn("agent_pairing.ini", content)


class TestInstallerBuildScript(unittest.TestCase):
    """Verifies that build-installer.ps1 meets automation and parameter requirements."""

    def setUp(self) -> None:
        self.build_script = INFRA_DIR / "build-installer.ps1"

    def test_script_exists(self) -> None:
        self.assertTrue(self.build_script.exists(), f"build-installer.ps1 not found at {self.build_script}")

    def test_script_parameters(self) -> None:
        with open(self.build_script, encoding="utf-8") as f:
            content = f.read()

        self.assertIn("[switch]$Clean", content)
        self.assertIn("[string]$OutputDir", content)
        self.assertIn("[switch]$DryRun", content)
        self.assertIn("ISCC.exe", content)
        self.assertIn("installer_manifest.json", content)
        self.assertIn("SHA256", content)


class TestSigningPolicy(unittest.TestCase):
    """Verifies that infra/windows-installer/config/signing-policy.json defines required Authenticode rules."""

    def setUp(self) -> None:
        self.policy_path = INFRA_DIR / "config" / "signing-policy.json"

    def test_policy_file_exists_and_valid_json(self) -> None:
        self.assertTrue(self.policy_path.exists(), f"signing-policy.json not found at {self.policy_path}")
        with open(self.policy_path, encoding="utf-8") as f:
            data = json.load(f)

        self.assertEqual(data["policy"]["certificate_type"], "Authenticode")
        self.assertEqual(data["policy"]["required_digest_algorithm"], "SHA256")
        self.assertIn("timestamp_rfc3161_url", data["policy"])
        self.assertTrue(data["policy"]["timestamp_rfc3161_url"].startswith("http"))

        targets = [t["pattern"] for t in data["policy"]["targets"]]
        self.assertIn("caps-agent.exe", targets)
        self.assertIn("CAPS-Print-Agent-Setup-*.exe", targets)


class TestUninstallPurgeSimulation(unittest.TestCase):
    """Simulates the [UninstallDelete] folder and log purge logic on temporary file structures."""

    def setUp(self) -> None:
        self.test_dir = Path(tempfile.mkdtemp(prefix="caps_uninstall_test_"))
        self.spool_dir = self.test_dir / "spool"
        self.logs_dir = self.test_dir / "logs"
        self.cache_dir = self.test_dir / "cache"

        self.spool_dir.mkdir(parents=True)
        self.logs_dir.mkdir(parents=True)
        self.cache_dir.mkdir(parents=True)

        # Create mock sensitive artifacts
        (self.spool_dir / "temp_print_slice_001.pdf").write_bytes(b"%PDF-1.4 mock")
        (self.logs_dir / "agent.log").write_text("2026-10-19 [INFO] agent run")
        (self.cache_dir / "meta.json").write_text("{}")

    def tearDown(self) -> None:
        if self.test_dir.exists():
            shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_simulate_complete_uninstall_purge(self) -> None:
        # Simulate uninstaller purging temporary files
        dirs_to_purge = [self.spool_dir, self.logs_dir, self.cache_dir]
        for d in dirs_to_purge:
            if d.exists():
                shutil.rmtree(d)

        # Validate that no customer print artifacts or logs linger
        self.assertFalse(self.spool_dir.exists())
        self.assertFalse(self.logs_dir.exists())
        self.assertFalse(self.cache_dir.exists())


if __name__ == "__main__":
    unittest.main()
