"""Unit tests for CAPS Print Agent identity and credential management.

Tests cover:
- AgentCredentials validation, serialization, expiration, and secret redaction.
- CredentialStore DPAPI encryption/fallback, persistence, and zero-wipe clearing.
- PairingManager one-time code pairing, token refresh, and unpairing revocation.
"""

from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

from caps_agent.auth.credentials import AgentCredentials, CredentialStore
from caps_agent.auth.pairing import (
    InvalidPairingCodeError,
    PairingError,
    PairingManager,
    TokenRefreshError,
)


class TestAgentCredentials(unittest.TestCase):
    """Test AgentCredentials model behavior."""

    def test_valid_credentials_creation(self) -> None:
        creds = AgentCredentials(
            shop_id="shop-111",
            device_id="dev-222",
            device_token="tok_secret_99999",
            refresh_token="ref_secret_88888",
            paired_at="2026-10-20T10:00:00Z",
            token_expires_at="2026-10-21T10:00:00Z",
        )
        self.assertEqual(creds.shop_id, "shop-111")
        self.assertEqual(creds.device_id, "dev-222")
        self.assertEqual(creds.device_token, "tok_secret_99999")
        self.assertEqual(creds.refresh_token, "ref_secret_88888")

    def test_invalid_credentials_validation(self) -> None:
        with self.assertRaises(ValueError):
            AgentCredentials(shop_id="", device_id="dev-1", device_token="tok-1")
        with self.assertRaises(ValueError):
            AgentCredentials(shop_id="shop-1", device_id="", device_token="tok-1")
        with self.assertRaises(ValueError):
            AgentCredentials(shop_id="shop-1", device_id="dev-1", device_token="")

    def test_to_dict_and_from_dict_roundtrip(self) -> None:
        creds = AgentCredentials(
            shop_id="shop-abc",
            device_id="dev-xyz",
            device_token="token-12345",
            refresh_token="refresh-67890",
            paired_at="2026-10-20T12:00:00Z",
            token_expires_at="2026-10-22T12:00:00Z",
        )
        data = creds.to_dict()
        self.assertEqual(data["shop_id"], "shop-abc")
        self.assertEqual(data["device_token"], "token-12345")

        restored = AgentCredentials.from_dict(data)
        self.assertEqual(restored, creds)

    def test_secret_redaction_in_repr(self) -> None:
        creds = AgentCredentials(
            shop_id="shop-uuid-1",
            device_id="dev-uuid-2",
            device_token="secret_super_device_token_xyz",
            refresh_token="secret_super_refresh_token_abc",
        )
        repr_str = repr(creds)
        # Secrets must be masked and never printed in plaintext
        self.assertNotIn("secret_super_device_token_xyz", repr_str)
        self.assertNotIn("secret_super_refresh_token_abc", repr_str)
        self.assertIn("secr...***", repr_str)

    def test_is_expired_logic(self) -> None:
        now = datetime.now(UTC)

        # No expiration set -> False
        creds_no_exp = AgentCredentials("s", "d", "t")
        self.assertFalse(creds_no_exp.is_expired())

        # Future expiration -> False
        future_dt = now + timedelta(hours=2)
        creds_future = AgentCredentials(
            "s", "d", "t", token_expires_at=future_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        self.assertFalse(creds_future.is_expired())

        # Expired in past -> True
        past_dt = now - timedelta(minutes=5)
        creds_past = AgentCredentials(
            "s", "d", "t", token_expires_at=past_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        self.assertTrue(creds_past.is_expired())

        # Expiring within skew window -> True
        soon_dt = now + timedelta(seconds=15)
        creds_soon = AgentCredentials(
            "s", "d", "t", token_expires_at=soon_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        self.assertTrue(creds_soon.is_expired(skew_seconds=30.0))
        self.assertFalse(creds_soon.is_expired(skew_seconds=5.0))


class TestCredentialStore(unittest.TestCase):
    """Test CredentialStore persistence, encryption fallback, and wiping."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store_path = Path(self.temp_dir.name) / "credentials.dat"
        self.store = CredentialStore(store_path=self.store_path)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_save_and_load_roundtrip(self) -> None:
        creds = AgentCredentials(
            shop_id="shop-store-1",
            device_id="dev-store-2",
            device_token="tok-9999",
            refresh_token="ref-8888",
            paired_at="2026-10-20T10:00:00Z",
        )
        self.store.save(creds)
        self.assertTrue(self.store_path.exists())

        loaded = self.store.load()
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.shop_id, "shop-store-1")
        self.assertEqual(loaded.device_id, "dev-store-2")
        self.assertEqual(loaded.device_token, "tok-9999")
        self.assertEqual(loaded.refresh_token, "ref-8888")

    def test_load_nonexistent_returns_none(self) -> None:
        self.assertFalse(self.store_path.exists())
        self.assertIsNone(self.store.load())

    def test_load_empty_or_corrupted_returns_none(self) -> None:
        self.store_path.write_bytes(b"garbage-not-json-or-dpapi")
        self.assertIsNone(self.store.load())

    def test_clear_wipes_and_deletes_file(self) -> None:
        creds = AgentCredentials("s", "d", "t")
        self.store.save(creds)
        self.assertTrue(self.store_path.exists())

        self.store.clear()
        self.assertFalse(self.store_path.exists())
        self.assertIsNone(self.store.load())


class TestPairingManager(unittest.TestCase):
    """Test PairingManager handshake, token refresh, and unpairing."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store_path = Path(self.temp_dir.name) / "credentials.dat"
        self.store = CredentialStore(store_path=self.store_path)
        self.mock_client = MagicMock()
        self.manager = PairingManager(
            credential_store=self.store,
            api_client=self.mock_client,
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_is_paired_initially_false(self) -> None:
        self.assertFalse(self.manager.is_paired)
        self.assertIsNone(self.manager.get_credentials())

    def test_pair_with_code_empty_code_raises(self) -> None:
        with self.assertRaises(InvalidPairingCodeError):
            self.manager.pair_with_code("")
        with self.assertRaises(InvalidPairingCodeError):
            self.manager.pair_with_code("   ")

    def test_pair_with_code_missing_client_raises(self) -> None:
        unconfigured_mgr = PairingManager(credential_store=self.store, api_client=None)
        with self.assertRaises(PairingError) as ctx:
            unconfigured_mgr.pair_with_code("ABC-123")
        self.assertIn("CloudApiClient must be configured", str(ctx.exception))

    def test_pair_with_code_success(self) -> None:
        self.mock_client.post_unauthenticated.return_value = {
            "shop_id": "shop-456",
            "device_id": "dev-789",
            "device_token": "token-xyz-100",
            "refresh_token": "refresh-xyz-200",
            "expires_in": 3600,
        }

        creds = self.manager.pair_with_code("PAIR-999")

        self.assertEqual(creds.shop_id, "shop-456")
        self.assertEqual(creds.device_id, "dev-789")
        self.assertEqual(creds.device_token, "token-xyz-100")
        self.assertEqual(creds.refresh_token, "refresh-xyz-200")
        self.assertTrue(self.manager.is_paired)

        # Check call payload
        self.mock_client.post_unauthenticated.assert_called_once()
        args, kwargs = self.mock_client.post_unauthenticated.call_args
        self.assertEqual(args[0], "/api/v1/agent/pair")
        payload = args[1]
        self.assertEqual(payload["pairing_code"], "PAIR-999")
        self.assertIn("hostname", payload)
        self.assertIn("agent_version", payload)

    def test_pair_with_code_incomplete_response_raises(self) -> None:
        self.mock_client.post_unauthenticated.return_value = {
            "shop_id": "shop-456",
            # missing device_id and device_token
        }
        with self.assertRaises(PairingError) as ctx:
            self.manager.pair_with_code("PAIR-999")
        self.assertIn("Malformed pairing response", str(ctx.exception))

    def test_refresh_token_success(self) -> None:
        # Prepopulate store with initial credentials
        initial = AgentCredentials(
            shop_id="shop-1",
            device_id="dev-1",
            device_token="old-token",
            refresh_token="valid-refresh",
            paired_at="2026-10-20T10:00:00Z",
        )
        self.store.save(initial)

        self.mock_client.post_unauthenticated.return_value = {
            "device_token": "new-refreshed-token",
            "refresh_token": "next-refresh-token",
            "expires_in": 7200,
        }

        updated = self.manager.refresh_token()
        self.assertEqual(updated.device_token, "new-refreshed-token")
        self.assertEqual(updated.refresh_token, "next-refresh-token")
        self.assertEqual(updated.shop_id, "shop-1")

        # Verify persisted store contains new token
        persisted = self.store.load()
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted.device_token, "new-refreshed-token")

    def test_refresh_token_without_credentials_raises(self) -> None:
        with self.assertRaises(TokenRefreshError) as ctx:
            self.manager.refresh_token()
        self.assertIn("no credentials found", str(ctx.exception))

    def test_refresh_token_without_refresh_token_raises(self) -> None:
        initial = AgentCredentials(
            shop_id="shop-1",
            device_id="dev-1",
            device_token="old-token",
            refresh_token=None,
        )
        self.store.save(initial)
        with self.assertRaises(TokenRefreshError) as ctx:
            self.manager.refresh_token()
        self.assertIn("no refresh_token present", str(ctx.exception))

    def test_revoke_pairing_calls_cloud_and_clears_store(self) -> None:
        initial = AgentCredentials("s", "d", "t", "r")
        self.store.save(initial)
        self.assertTrue(self.manager.is_paired)

        self.manager.revoke_pairing()
        self.mock_client.post.assert_called_once_with("/api/v1/agent/revoke", {"device_id": "d"})
        self.assertFalse(self.manager.is_paired)
        self.assertIsNone(self.manager.get_credentials())

    def test_revoke_pairing_ignores_cloud_error_and_clears(self) -> None:
        initial = AgentCredentials("s", "d", "t", "r")
        self.store.save(initial)

        self.mock_client.post.side_effect = Exception("Cloud unreachable")
        self.manager.revoke_pairing()
        # Local store must still be cleared
        self.assertFalse(self.manager.is_paired)
        self.assertIsNone(self.manager.get_credentials())


if __name__ == "__main__":
    unittest.main()
