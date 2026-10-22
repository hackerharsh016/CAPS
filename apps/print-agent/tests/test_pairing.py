"""Tests for Desktop Print Agent device pairing conformance."""

from __future__ import annotations

import pytest

from api_client import AgentApiClient
from pairing import PairingManager, pair_device


class MockPairingTransport:
    def __init__(self) -> None:
        self.recorded_requests: list[dict] = []
        self.response = {
            "success": True,
            "device_id": "aaaa1111-aaaa-1111-aaaa-111111111111",
            "shop_id": "22222222-2222-2222-2222-222222222222",
            "device_secret": "caps_agent_sec_test99887766554433221100",
            "device_token": "caps_agent_sec_test99887766554433221100",
            "agent_version": "0.1.0",
        }

    def __call__(self, method: str, url: str, headers: dict, payload: dict | None) -> dict:
        self.recorded_requests.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": payload,
            }
        )
        return self.response


def test_pairing_request_payload_contains_required_parameters() -> None:
    """Step 1: Pairing request payload must provide device_fingerprint, device_name, hostname, and os_version."""
    transport = MockPairingTransport()
    client = AgentApiClient(transport=transport)

    resp = pair_device(
        api_client=client,
        pairing_code="CP-ABC123XYZ",
        device_fingerprint="fp-custom-station-01",
        device_name="Front Desk Print Station",
        hostname="DESKTOP-FRONT-01",
        os_version="Windows 11 Pro 23H2",
        agent_version="0.1.0",
    )

    assert len(transport.recorded_requests) == 1
    req = transport.recorded_requests[0]
    body = req["body"]

    assert body["pairing_code"] == "CP-ABC123XYZ"
    assert body["device_fingerprint"] == "fp-custom-station-01"
    assert body["device_name"] == "Front Desk Print Station"
    assert body["hostname"] == "DESKTOP-FRONT-01"
    assert body["os_version"] == "Windows 11 Pro 23H2"
    assert body["agent_version"] == "0.1.0"

    assert resp["success"] is True
    assert client.device_token == "caps_agent_sec_test99887766554433221100"
    assert client.device_id == "aaaa1111-aaaa-1111-aaaa-111111111111"
    assert client.shop_id == "22222222-2222-2222-2222-222222222222"


def test_pairing_manager_workflow() -> None:
    transport = MockPairingTransport()
    client = AgentApiClient(transport=transport)
    manager = PairingManager(api_client=client)

    assert not manager.is_paired
    manager.pair_with_code("CP-TEST-CODE")
    assert manager.is_paired


def test_pairing_rejects_empty_code() -> None:
    transport = MockPairingTransport()
    client = AgentApiClient(transport=transport)

    with pytest.raises(ValueError, match="pairing_code cannot be empty"):
        pair_device(api_client=client, pairing_code="   ")
