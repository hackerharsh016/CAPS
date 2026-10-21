"""Agent identity pairing, token refresh, and credential revocation coordinator.

Handles:
- One-time device pairing handshake with Cloud API using owner-generated pairing code
- Automatic token refresh before expiration or upon HTTP 401
- Device unpairing / credential revocation
"""

from __future__ import annotations

import logging
import platform
import threading
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from caps_agent.auth.credentials import AgentCredentials, CredentialStore

if TYPE_CHECKING:
    from caps_agent.cloud.api_client import CloudApiClient

logger = logging.getLogger("caps_agent.auth.pairing")


class PairingError(Exception):
    """Base exception for pairing and identity failures."""

    def __init__(self, message: str, error_code: str = "PAIRING_ERROR"):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class InvalidPairingCodeError(PairingError):
    """Raised when pairing code is invalid, expired, or already used."""

    def __init__(self, message: str = "Invalid or expired pairing code"):
        super().__init__(message, error_code="INVALID_PAIRING_CODE")


class TokenRefreshError(PairingError):
    """Raised when refresh token is expired, invalid, or revoked."""

    def __init__(self, message: str = "Token refresh failed"):
        super().__init__(message, error_code="TOKEN_REFRESH_FAILED")


class PairingManager:
    """Coordinates agent identity pairing, persistent credentials, and token refresh."""

    def __init__(
        self,
        credential_store: CredentialStore | None = None,
        api_client: CloudApiClient | None = None,
    ) -> None:
        self.store = credential_store or CredentialStore()
        self.api_client = api_client
        self._lock = threading.RLock()

    @property
    def is_paired(self) -> bool:
        """Return True if valid paired credentials exist in the store."""
        creds = self.store.load()
        return creds is not None and bool(creds.device_token and creds.device_id and creds.shop_id)

    def get_credentials(self) -> AgentCredentials | None:
        """Retrieve current credentials from store."""
        return self.store.load()

    def pair_with_code(
        self,
        pairing_code: str,
        cloud_api_url: str | None = None,
        agent_version: str = "0.1.0",
    ) -> AgentCredentials:
        """Perform one-time pairing handshake using owner dashboard pairing code."""
        with self._lock:
            code = pairing_code.strip()
            if not code:
                raise InvalidPairingCodeError("Pairing code cannot be empty")

            if self.api_client is None:
                raise PairingError("CloudApiClient must be configured on PairingManager to execute pairing")

            payload = {
                "pairing_code": code,
                "hostname": platform.node(),
                "device_name": platform.node(),
                "device_fingerprint": platform.node(),
                "os_version": platform.platform(),
                "agent_version": agent_version,
            }

            try:
                response = self.api_client.post_unauthenticated("/api/v1/agent/pair", payload)
            except Exception as err:
                logger.error("Pairing request failed: %s", err)
                raise PairingError(f"Pairing request failed: {err}") from err

            # Support both root envelope and nested data envelope
            data = response.get("data") if isinstance(response.get("data"), dict) else response
            shop_id = data.get("shop_id") or response.get("shop_id")
            device_id = data.get("device_id") or response.get("device_id")
            device_token = data.get("device_token") or response.get("device_token")
            refresh_token = data.get("refresh_token") or response.get("refresh_token")
            expires_in = data.get("expires_in") or response.get("expires_in", 86400)

            if not (shop_id and device_id and device_token):
                raise PairingError("Malformed pairing response: missing required identity tokens")

            now = datetime.now(UTC)
            paired_at_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            expires_at_dt = now + timedelta(seconds=expires_in)
            expires_at_str = expires_at_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            creds = AgentCredentials(
                shop_id=shop_id,
                device_id=device_id,
                device_token=device_token,
                refresh_token=refresh_token,
                paired_at=paired_at_str,
                token_expires_at=expires_at_str,
            )

            self.store.save(creds)
            logger.info("Agent successfully paired to Shop '%s' as Device '%s'", shop_id, device_id)
            return creds

    def refresh_token(self) -> AgentCredentials:
        """Refresh device token using refresh token."""
        with self._lock:
            current_creds = self.store.load()
            if not current_creds:
                raise TokenRefreshError("Cannot refresh: no credentials found")
            if not current_creds.refresh_token:
                raise TokenRefreshError("Cannot refresh: no refresh_token present in credentials")
            if self.api_client is None:
                raise TokenRefreshError("CloudApiClient not configured on PairingManager")

            payload = {
                "device_id": current_creds.device_id,
                "refresh_token": current_creds.refresh_token,
            }

            try:
                response = self.api_client.post_unauthenticated("/api/v1/agent/token/refresh", payload)
            except Exception as err:
                logger.error("Token refresh request failed: %s", err)
                raise TokenRefreshError(f"Token refresh request failed: {err}") from err

            new_token = response.get("device_token")
            new_refresh = response.get("refresh_token", current_creds.refresh_token)
            expires_in = response.get("expires_in", 86400)

            if not new_token:
                raise TokenRefreshError("Malformed refresh response: missing device_token")

            now = datetime.now(UTC)
            expires_at_dt = now + timedelta(seconds=expires_in)
            expires_at_str = expires_at_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

            updated_creds = AgentCredentials(
                shop_id=current_creds.shop_id,
                device_id=current_creds.device_id,
                device_token=new_token,
                refresh_token=new_refresh,
                paired_at=current_creds.paired_at,
                token_expires_at=expires_at_str,
            )

            self.store.save(updated_creds)
            logger.info("Device token refreshed successfully for Device '%s'", current_creds.device_id)
            return updated_creds

    def revoke_pairing(self) -> None:
        """Revoke device token and unpair agent from cloud."""
        with self._lock:
            current_creds = self.store.load()
            if current_creds and self.api_client is not None:
                try:
                    payload = {"device_id": current_creds.device_id}
                    self.api_client.post("/api/v1/agent/revoke", payload)
                except Exception as err:
                    logger.warning("Revocation notice to cloud failed: %s", err)

            self.store.clear()
            logger.info("Device credentials cleared. Agent is now unpaired.")
