"""Tests for reproducible PyInstaller packaging specification, version metadata, and build pipeline."""

import ast
import io
import unittest
from pathlib import Path
from unittest.mock import patch

from caps_agent import __version__
from caps_agent.main import main

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PACKAGING_DIR = PACKAGE_ROOT / "packaging"
SCRIPTS_DIR = PACKAGE_ROOT / "scripts"


class TestPackagingSpecification(unittest.TestCase):
    """Verifies that PyInstaller agent.spec is valid, reproducible, and signed-ready."""

    def setUp(self) -> None:
        self.spec_path = PACKAGING_DIR / "agent.spec"

    def test_spec_file_exists(self) -> None:
        self.assertTrue(self.spec_path.exists(), f"agent.spec not found at {self.spec_path}")

    def test_spec_file_valid_python_syntax(self) -> None:
        with open(self.spec_path, encoding="utf-8") as f:
            content = f.read()

        # Parse with AST to guarantee no Python syntax errors
        tree = ast.parse(content, filename=str(self.spec_path))
        self.assertIsNotNone(tree)

    def test_spec_critical_directives_and_flags(self) -> None:
        with open(self.spec_path, encoding="utf-8") as f:
            content = f.read()

        # Check required PyInstaller building blocks
        self.assertIn("Analysis(", content)
        self.assertIn("PYZ(", content)
        self.assertIn("EXE(", content)
        self.assertIn("COLLECT(", content)

        # Signing readiness: UPX must be disabled (upx=False) because UPX modifies PE headers
        # and invalidates or complicates Authenticode digital signatures
        self.assertIn("upx=False", content)

        # Version resource must be embedded
        self.assertIn("version_file", content)

        # Main entrypoint referenced
        self.assertIn("main.py", content)

        # Ensure win32 native printing modules are included in hidden imports
        self.assertIn("win32print", content)
        self.assertIn("caps_agent.printing.printer_discovery", content)
        self.assertIn("caps_agent.printing.capabilities", content)


class TestVersionInfoMetadata(unittest.TestCase):
    """Verifies that the Windows PE version info resource contains proper identity attributes."""

    def setUp(self) -> None:
        self.version_path = PACKAGING_DIR / "version_info.txt"

    def test_version_info_exists(self) -> None:
        self.assertTrue(
            self.version_path.exists(), f"version_info.txt not found at {self.version_path}"
        )

    def test_version_info_fields(self) -> None:
        with open(self.version_path, encoding="utf-8") as f:
            content = f.read()

        self.assertIn("VSVersionInfo", content)
        self.assertIn("FixedFileInfo", content)
        self.assertIn("filevers=(0, 1, 0, 0)", content)
        self.assertIn("prodvers=(0, 1, 0, 0)", content)
        self.assertIn("StringFileInfo", content)
        self.assertIn("CompanyName", content)
        self.assertIn("CAPS Desktop Print Agent", content)
        self.assertIn("OriginalFilename", content)
        self.assertIn("caps-agent.exe", content)
        self.assertIn("VarFileInfo", content)


class TestBuildScript(unittest.TestCase):
    """Verifies the PowerShell build script definition and parameter contract."""

    def setUp(self) -> None:
        self.build_ps1_path = SCRIPTS_DIR / "build.ps1"

    def test_build_script_exists(self) -> None:
        self.assertTrue(
            self.build_ps1_path.exists(), f"build.ps1 not found at {self.build_ps1_path}"
        )

    def test_build_script_parameters_and_safety(self) -> None:
        with open(self.build_ps1_path, encoding="utf-8") as f:
            content = f.read()

        self.assertIn("[switch]$Clean", content)
        self.assertIn("[string]$OutputDir", content)
        self.assertIn("[switch]$SkipTests", content)
        self.assertIn("[switch]$SkipSmoke", content)
        self.assertIn("build_manifest.json", content)
        self.assertIn("SHA256", content)
        self.assertIn("signing_ready", content)


class TestMainCliFlags(unittest.TestCase):
    """Verifies that the agent binary runner supports version and smoke check flags without credentials."""

    def test_version_flag(self) -> None:
        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            exit_code = main(["--version"])

        self.assertEqual(exit_code, 0)
        output = stdout_capture.getvalue()
        self.assertIn(__version__, output)
        self.assertIn("caps-agent", output)

    def test_smoke_flag(self) -> None:
        stdout_capture = io.StringIO()
        with patch("sys.stdout", stdout_capture):
            exit_code = main(["--smoke"])

        self.assertEqual(exit_code, 0)
        output = stdout_capture.getvalue()
        self.assertIn("binary runner smoke check OK", output)


class TestNativeModuleImports(unittest.TestCase):
    """Verifies that all native libraries and core agent dependencies are loadable."""

    def test_import_core_subsystems(self) -> None:
        import caps_agent
        import caps_agent.config
        import caps_agent.printing.capabilities
        import caps_agent.printing.engine
        import caps_agent.printing.fake_engine
        import caps_agent.printing.printer_discovery
        import caps_agent.utils.logging

        self.assertIsNotNone(caps_agent.__version__)


if __name__ == "__main__":
    unittest.main()
