"""Protected credential management and DPAPI-secured storage for CAPS Print Agent.

Handles:
- Agent device credentials and identity tokens
- Machine-scoped DPAPI encryption on Windows (win32crypt)
- Token expiration and clock skew evaluation
- Masking of tokens in string representations to prevent secret leakage in logs
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import sys
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger("caps_agent.auth.credentials")

IS_WINDOWS = sys.platform == "win32"

HAS_DPAPI = False
if IS_WINDOWS:
    try:
        import win32crypt

        HAS_DPAPI = True
    except ImportError:
        HAS_DPAPI = False


@dataclass(frozen=True)
class AgentCredentials:
    """Pairing credentials identifying a Windows Agent device to the CAPS Cloud API."""

    shop_id: str
    device_id: str
    device_token: str
    refresh_token: str | None = None
    paired_at: str = ""
    token_expires_at: str | None = None

    def __post_init__(self) -> None:
        if not self.shop_id or not isinstance(self.shop_id, str):
            raise ValueError("shop_id must be a non-empty string UUID")
        if not self.device_id or not isinstance(self.device_id, str):
            raise ValueError("device_id must be a non-empty string UUID")
        if not self.device_token or not isinstance(self.device_token, str):
            raise ValueError("device_token must be a non-empty string")

    def is_expired(self, skew_seconds: float = 30.0) -> bool:
        """Check if the device token is expired or will expire within skew_seconds window."""
        if not self.token_expires_at:
            return False

        try:
            exp_str = self.token_expires_at.replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(exp_str)
            now_dt = datetime.now(UTC)
            return now_dt + timedelta(seconds=skew_seconds) >= exp_dt
        except Exception as err:
            logger.warning("Failed to parse token_expires_at '%s': %s", self.token_expires_at, err)
            return False

    def to_dict(self) -> dict[str, Any]:
        """Convert credentials to dictionary for storage."""
        return {
            "shop_id": self.shop_id,
            "device_id": self.device_id,
            "device_token": self.device_token,
            "refresh_token": self.refresh_token,
            "paired_at": self.paired_at,
            "token_expires_at": self.token_expires_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AgentCredentials:
        """Create AgentCredentials from dictionary."""
        return cls(
            shop_id=data["shop_id"],
            device_id=data["device_id"],
            device_token=data["device_token"],
            refresh_token=data.get("refresh_token"),
            paired_at=data.get("paired_at", ""),
            token_expires_at=data.get("token_expires_at"),
        )

    def __repr__(self) -> str:
        """Safe representation with redacted secret tokens."""
        masked_token = f"{self.device_token[:4]}...***" if len(self.device_token) > 6 else "***"
        masked_refresh = (
            f"{self.refresh_token[:4]}...***"
            if self.refresh_token and len(self.refresh_token) > 6
            else ("***" if self.refresh_token else "None")
        )
        return (
            f"AgentCredentials(shop_id='{self.shop_id}', device_id='{self.device_id}', "
            f"device_token='{masked_token}', refresh_token='{masked_refresh}', "
            f"paired_at='{self.paired_at}', token_expires_at='{self.token_expires_at}')"
        )


class CredentialStore:
    """Thread-safe persistent credential store.

    Protects secrets using Windows DPAPI (Data Protection API) when available,
    falling back to strict owner-only file permissions on non-Windows/dev environments.
    """

    def __init__(self, store_path: str | Path | None = None) -> None:
        self._lock = threading.RLock()
        if store_path is not None:
            self.store_path = Path(store_path).resolve()
        else:
            base = Path(os.environ.get("LOCALAPPDATA", os.environ.get("TEMP", "/tmp")))
            self.store_path = (base / "caps_agent" / "credentials.dat").resolve()

    def _encrypt(self, plain_bytes: bytes) -> bytes:
        """Encrypt bytes using DPAPI if on Windows, else return plain bytes."""
        if HAS_DPAPI:
            try:
                # CryptProtectData flags: 1 = CRYPTPROTECT_UI_FORBIDDEN
                encrypted = win32crypt.CryptProtectData(
                    plain_bytes,
                    "CAPS Agent Credentials",
                    None,
                    None,
                    None,
                    1,
                )
                return encrypted
            except Exception as err:
                logger.warning("DPAPI encryption failed, storing without DPAPI: %s", err)
                return plain_bytes
        return plain_bytes

    def _decrypt(self, cipher_bytes: bytes) -> bytes:
        """Decrypt bytes using DPAPI if on Windows, else return bytes."""
        if HAS_DPAPI:
            try:
                # win32crypt.CryptUnprotectData returns (description, decrypted_bytes)
                # Parameters: (data, optionalEntropy, reserved, promptStruct, flags)
                _, decrypted = win32crypt.CryptUnprotectData(
                    cipher_bytes,
                    None,
                    None,
                    None,
                    1,
                )
                return decrypted
            except Exception:
                # If decryption fails (e.g. file was written unencrypted or on different machine)
                return cipher_bytes
        return cipher_bytes

    def save(self, credentials: AgentCredentials) -> None:
        """Persist credentials securely to disk."""
        with self._lock:
            self.store_path.parent.mkdir(parents=True, exist_ok=True)
            payload_json = json.dumps(credentials.to_dict()).encode("utf-8")
            encrypted = self._encrypt(payload_json)

            # Write file atomically with restricted permissions
            temp_file = self.store_path.with_suffix(".tmp")
            try:
                temp_file.write_bytes(encrypted)
                if not IS_WINDOWS:
                    with contextlib.suppress(Exception):
                        os.chmod(temp_file, 0o600)
                temp_file.replace(self.store_path)
            finally:
                if temp_file.exists():
                    temp_file.unlink(missing_ok=True)

            logger.info("Agent credentials saved successfully to %s", self.store_path)

    def load(self) -> AgentCredentials | None:
        """Load and decrypt credentials from storage if present."""
        with self._lock:
            if not self.store_path.is_file():
                return None

            try:
                raw_bytes = self.store_path.read_bytes()
                if not raw_bytes:
                    return None

                decrypted_bytes = self._decrypt(raw_bytes)
                data = json.loads(decrypted_bytes.decode("utf-8"))
                return AgentCredentials.from_dict(data)
            except Exception as err:
                logger.error("Failed to load credentials from %s: %s", self.store_path, err)
                return None

    def clear(self) -> None:
        """Remove credentials from disk securely."""
        with self._lock:
            if self.store_path.is_file():
                try:
                    # Overwrite with zeros before deletion
                    size = self.store_path.stat().st_size
                    if size > 0:
                        self.store_path.write_bytes(b"\x00" * size)
                    self.store_path.unlink(missing_ok=True)
                    logger.info("Cleared agent credentials from %s", self.store_path)
                except Exception as err:
                    logger.warning("Error clearing credentials file %s: %s", self.store_path, err)
