"""Tests for Authenticode signature verification, updater security policies, and release workflows."""

import hashlib
import os
import platform
import subprocess
import tempfile
import unittest
from pathlib import Path

from caps_agent.updater.update_policy import (
    UpdatePolicyEngine,
)
from caps_agent.utils.signing import (
    verify_authenticode_signature,
)

AGENT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = AGENT_ROOT.parent.parent
INFRA_DIR = REPO_ROOT / "infra" / "windows-installer"


class TestAuthenticodeSignatureVerification(unittest.TestCase):
    """Verifies Authenticode signature checking, distinguishing valid vs unsigned test builds."""

    def test_nonexistent_binary_handling(self) -> None:
        missing_path = Path("C:/caps_nonexistent_binary.exe")
        result = verify_authenticode_signature(missing_path)

        self.assertFalse(result.is_signed)
        self.assertFalse(result.is_trusted)
        self.assertEqual(result.status, "UnknownError")
        self.assertIn("not found", (result.status_message or "").lower())

    def test_unsigned_test_build_labeled_untrusted(self) -> None:
        """Unsigned test builds MUST be accurately flagged as NOT signed and UNTRUSTED."""
        # Find an unsigned PE binary in the local environment if available (e.g., compiled .pyd in venv)
        unsigned_candidates = list(Path(__file__).resolve().parents[1].glob(".venv/**/*.pyd"))
        if unsigned_candidates and platform.system() == "Windows":
            result = verify_authenticode_signature(unsigned_candidates[0])
            self.assertFalse(result.is_signed)
            self.assertFalse(result.is_trusted)
            self.assertEqual(result.status, "NotSigned")
        else:
            with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
                f.write(b"MZ\x90\x00\x03\x00\x00\x00dummy test executable header")
                temp_path = f.name
            try:
                result = verify_authenticode_signature(temp_path)
                self.assertFalse(result.is_signed)
                self.assertFalse(result.is_trusted)
                self.assertIn(result.status, ("NotSigned", "UnknownError"))
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

    def test_corrupt_or_non_pe_binary_untrusted(self) -> None:
        """Non-PE or corrupted binaries must be flagged as unsigned and untrusted."""
        with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
            f.write(b"corrupted binary data not a valid PE")
            temp_path = f.name
        try:
            result = verify_authenticode_signature(temp_path)
            self.assertFalse(result.is_signed)
            self.assertFalse(result.is_trusted)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    @unittest.skipUnless(
        platform.system() == "Windows", "Requires Windows OS for native catalog verification"
    )
    def test_real_windows_signed_system_binary(self) -> None:
        """Verifies signature extraction against a real Windows signed binary."""
        windir = Path(os.environ.get("WINDIR", "C:\\Windows"))
        candidates = [
            windir / "explorer.exe",
            windir / "System32" / "kernel32.dll",
            windir / "System32" / "notepad.exe",
        ]
        signed_binary = None
        for cand in candidates:
            if cand.exists():
                res = verify_authenticode_signature(cand)
                if res.is_signed and res.status == "Valid":
                    signed_binary = cand
                    break

        if not signed_binary:
            self.skipTest("No genuine signed Windows system binary found in environment")
            return

        # 1. Verify standard signature verification
        result = verify_authenticode_signature(
            signed_binary,
            allowed_publishers=["Microsoft"],
        )

        self.assertTrue(result.is_signed)
        self.assertEqual(result.status, "Valid")
        self.assertTrue(result.is_trusted)
        self.assertTrue(result.has_timestamp)
        self.assertIsNotNone(result.thumbprint)
        self.assertIn("Microsoft", result.subject or "")

        # 2. Verify publisher whitelist enforcement
        untrusted_result = verify_authenticode_signature(
            signed_binary,
            allowed_publishers=["Unauthorized Third Party Corp"],
        )
        self.assertTrue(untrusted_result.is_signed)
        self.assertEqual(untrusted_result.status, "Valid")
        self.assertFalse(untrusted_result.is_trusted)
        self.assertIn("not in authorized publishers", untrusted_result.status_message or "")


class TestUpdatePolicyEngine(unittest.TestCase):
    """Verifies update version eligibility, checksum validation, and cryptographic security gates."""

    def setUp(self) -> None:
        self.engine = UpdatePolicyEngine(current_version="0.1.0")

    def test_version_eligibility_upgrade_allowed(self) -> None:
        allowed, msg = self.engine.evaluate_version_eligibility("0.1.1")
        self.assertTrue(allowed)
        self.assertIn("approved", msg.lower())

        allowed_major, _ = self.engine.evaluate_version_eligibility("1.0.0")
        self.assertTrue(allowed_major)

    def test_version_eligibility_same_version_rejected(self) -> None:
        allowed, msg = self.engine.evaluate_version_eligibility("0.1.0")
        self.assertFalse(allowed)
        self.assertIn("already running", msg.lower())

    def test_version_eligibility_downgrade_rejected_by_default(self) -> None:
        allowed, msg = self.engine.evaluate_version_eligibility("0.0.9")
        self.assertFalse(allowed)
        self.assertIn("downgrade", msg.lower())

    def test_version_eligibility_emergency_downgrade_allowed(self) -> None:
        rollback_engine = UpdatePolicyEngine(current_version="0.1.0", allow_downgrades=True)
        allowed, msg = rollback_engine.evaluate_version_eligibility("0.0.9")
        self.assertTrue(allowed)

    def test_verify_installer_checksum_mismatch(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
            f.write(b"binary payload content")
            temp_path = f.name

        try:
            wrong_hash = "0000000000000000000000000000000000000000000000000000000000000000"
            outcome = self.engine.verify_installer_package(temp_path, expected_sha256=wrong_hash)
            self.assertFalse(outcome.allowed)
            self.assertEqual(outcome.status_code, "CHECKSUM_MISMATCH")
            self.assertIn("mismatch", outcome.message.lower())
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_verify_installer_unsigned_rejected(self) -> None:
        content = b"fake unsigned installer executable"
        correct_hash = hashlib.sha256(content).hexdigest()

        with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
            f.write(content)
            temp_path = f.name

        try:
            outcome = self.engine.verify_installer_package(
                temp_path,
                expected_sha256=correct_hash,
                require_signature=True,
            )
            self.assertFalse(outcome.allowed)
            self.assertIn(outcome.status_code, ["NOT_SIGNED", "SIGNATURE_UNTRUSTED"])
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)


class TestReleaseAutomationScripts(unittest.TestCase):
    """Verifies sign-release.ps1, release documentation, and workflow templates."""

    def test_sign_script_exists_and_parameters(self) -> None:
        script_path = INFRA_DIR / "sign-release.ps1"
        self.assertTrue(script_path.exists())

        with open(script_path, encoding="utf-8") as f:
            content = f.read()

        self.assertIn("[string]$CertThumbprint", content)
        self.assertIn("[string]$PfxPath", content)
        self.assertIn("[string]$TimestampUrl", content)
        self.assertIn("[switch]$DryRun", content)
        self.assertIn("http://timestamp.digicert.com", content)

    @unittest.skipUnless(platform.system() == "Windows", "PowerShell required for script dry-run")
    def test_sign_script_dry_run_execution(self) -> None:
        script_path = INFRA_DIR / "sign-release.ps1"
        dist_dir = AGENT_ROOT / "dist"
        if not dist_dir.exists():
            self.skipTest("Agent dist directory not present")

        proc = subprocess.run(
            ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", str(script_path), "-DryRun"],
            capture_output=True,
            text=True,
            check=False,
            timeout=15,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertIn("DryRun", proc.stdout)

    def test_release_plan_document_sections(self) -> None:
        plan_path = INFRA_DIR / "RELEASE_AND_UPDATE_PLAN.md"
        self.assertTrue(plan_path.exists())

        with open(plan_path, encoding="utf-8") as f:
            content = f.read()

        self.assertIn("print-agent/v", content)
        self.assertIn("SHA-256", content)
        self.assertIn("Authenticode", content)
        self.assertIn("Staged Rollout Pipeline", content)
        self.assertIn("Ring 0", content)
        self.assertIn("Ring 1", content)
        self.assertIn("Ring 2", content)
        self.assertIn("Rollback", content)

    def test_workflow_template_exists_and_contents(self) -> None:
        wf_path = INFRA_DIR / "workflows" / "agent-release.yml.template"
        self.assertTrue(wf_path.exists())

        with open(wf_path, encoding="utf-8") as f:
            content = f.read()

        self.assertIn("print-agent/v*.*.*", content)
        self.assertIn("SIGNING_CERT_BASE64", content)
        self.assertIn("softprops/action-gh-release", content)


if __name__ == "__main__":
    unittest.main()
