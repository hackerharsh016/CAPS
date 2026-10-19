"""Windows Authenticode signature inspection and trust verification for CAPS Print Agent.

Provides cryptographic verification of PE binaries (.exe, .dll) to ensure:
- The executable is digitally signed with an active Authenticode certificate.
- The signature is intact with valid cryptographic digest (no tampering or hash mismatch).
- The certificate chains to a trusted root and optionally matches authorized publisher subjects.
- Unsigned test builds or corrupted binaries are explicitly flagged as UNTRUSTED.
"""

from __future__ import annotations

import json
import logging
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("caps_agent.utils.signing")


@dataclass(frozen=True)
class SignatureVerificationResult:
    """Detailed outcome of an Authenticode digital signature check."""

    file_path: str
    is_signed: bool
    is_trusted: bool
    status: str  # 'Valid', 'NotSigned', 'HashMismatch', 'UntrustedRoot', 'UnknownError'
    subject: str | None = None
    issuer: str | None = None
    thumbprint: str | None = None
    has_timestamp: bool = False
    status_message: str | None = None


def verify_authenticode_signature(
    binary_path: str | Path,
    allowed_publishers: list[str] | None = None,
    allowed_thumbprints: list[str] | None = None,
) -> SignatureVerificationResult:
    """Inspect and cryptographically verify the Authenticode signature of a Windows PE binary.

    Args:
        binary_path: Absolute or relative path to the PE file (.exe, .dll).
        allowed_publishers: Optional list of acceptable publisher CN substrings.
        allowed_thumbprints: Optional whitelist of SHA-1/SHA-256 certificate thumbprints.

    Returns:
        SignatureVerificationResult detailing trust state and certificate metadata.
    """
    path = Path(binary_path).resolve()
    if not path.exists():
        return SignatureVerificationResult(
            file_path=str(path),
            is_signed=False,
            is_trusted=False,
            status="UnknownError",
            status_message=f"Binary file not found: {path}",
        )

    # 1. On Windows, use PowerShell's Get-AuthenticodeSignature
    if platform.system() == "Windows":
        try:
            ps_command = (
                f"$sig = Get-AuthenticodeSignature -LiteralPath '{path}'; "
                "$res = @{ "
                "  Status = $sig.Status.ToString(); "
                "  StatusMessage = $sig.StatusMessage; "
                "  HasTimestamp = [bool]$sig.TimeStamperCertificate; "
                "  Subject = $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }); "
                "  Issuer = $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Issuer } else { $null }); "
                "  Thumbprint = $(if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { $null }) "
                "}; "
                "$res | ConvertTo-Json -Compress"
            )

            proc = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps_command],
                capture_output=True,
                text=True,
                check=False,
                timeout=15,
            )

            if proc.returncode == 0 and proc.stdout.strip():
                data = json.loads(proc.stdout.strip())
                status = data.get("Status", "UnknownError")
                status_msg = data.get("StatusMessage")
                subject = data.get("Subject")
                issuer = data.get("Issuer")
                thumbprint = data.get("Thumbprint")
                has_timestamp = bool(data.get("HasTimestamp", False))

                is_signed = status in ("Valid", "HashMismatch", "NotTrusted") or (
                    bool(thumbprint) and status not in ("NotSigned", "UnknownError", "NotSupportedFileFormat")
                )
                is_trusted = False

                if status == "Valid":
                    # Check publisher whitelist if specified
                    publisher_ok = True
                    if allowed_publishers:
                        publisher_ok = any(
                            pub.lower() in (subject or "").lower() for pub in allowed_publishers
                        )

                    # Check thumbprint whitelist if specified
                    thumbprint_ok = True
                    if allowed_thumbprints:
                        clean_tp = (thumbprint or "").replace(" ", "").upper()
                        clean_allowed = [tp.replace(" ", "").upper() for tp in allowed_thumbprints]
                        thumbprint_ok = clean_tp in clean_allowed

                    is_trusted = publisher_ok and thumbprint_ok
                    if not is_trusted:
                        status_msg = "Signature valid but signer is not in authorized publishers list."

                return SignatureVerificationResult(
                    file_path=str(path),
                    is_signed=is_signed,
                    is_trusted=is_trusted,
                    status=status,
                    subject=subject,
                    issuer=issuer,
                    thumbprint=thumbprint,
                    has_timestamp=has_timestamp,
                    status_message=status_msg,
                )
        except Exception as err:
            logger.debug("PowerShell Get-AuthenticodeSignature failed: %s", err)

    # 2. Cross-platform / fallback inspection via pefile
    try:
        import pefile

        pe = pefile.PE(str(path), fast_load=True)
        pe.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]]
        )
        sec_dir = pe.OPTIONAL_HEADER.DATA_DIRECTORY[
            pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]
        ]
        has_security_dir = sec_dir.VirtualAddress != 0 and sec_dir.Size > 0

        if not has_security_dir:
            return SignatureVerificationResult(
                file_path=str(path),
                is_signed=False,
                is_trusted=False,
                status="NotSigned",
                status_message="File contains no security directory certificate entry (unsigned test build).",
            )

        return SignatureVerificationResult(
            file_path=str(path),
            is_signed=True,
            is_trusted=False,
            status="UnknownError",
            status_message="Security directory present, but platform trust chain verification requires Windows host.",
        )
    except Exception as err:
        return SignatureVerificationResult(
            file_path=str(path),
            is_signed=False,
            is_trusted=False,
            status="UnknownError",
            status_message=f"Failed to inspect PE file headers: {err}",
        )
