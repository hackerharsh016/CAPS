"""Desktop Print Agent Pairing Module conforming to frozen OpenAPI specifications.

Step 1: Updates pairing request payload to provide:
- device_fingerprint
- device_name
- hostname
- os_version
"""

from __future__ import annotations

import logging
import platform
from typing import Any

from api_client import AgentApiClient

logger = logging.getLogger("caps_agent.pairing")


def pair_device(
    api_client: AgentApiClient,
    pairing_code: str,
    device_fingerprint: str | None = None,
    device_name: str | None = None,
    hostname: str | None = None,
    os_version: str | None = None,
    agent_version: str = "0.1.0",
) -> dict[str, Any]:
    """Execute agent device pairing handshake with cloud API.

    Transmits required hardware identity attributes:
    - device_fingerprint
    - device_name
    - hostname
    - os_version
    """
    code = pairing_code.strip()
    if not code:
        raise ValueError("pairing_code cannot be empty")

    host = hostname or platform.node() or "desktop-agent-host"
    os_ver = os_version or platform.platform() or "Windows"
    fingerprint = device_fingerprint or host
    dev_name = device_name or host

    payload = {
        "pairing_code": code,
        "device_fingerprint": fingerprint,
        "device_name": dev_name,
        "hostname": host,
        "os_version": os_ver,
        "agent_version": agent_version,
    }

    response = api_client.post_unauthenticated("/api/v1/agent/pair", payload)

    data = response.get("data") if isinstance(response.get("data"), dict) else response
    token = data.get("device_secret") or data.get("device_token")
    dev_id = data.get("device_id")
    shp_id = data.get("shop_id")

    if token and dev_id and shp_id:
        api_client.set_credentials(token, dev_id, shp_id)

    return response


class PairingManager:
    """Manages pairing workflow and credential state for Desktop Print Agent."""

    def __init__(self, api_client: AgentApiClient | None = None) -> None:
        self.api_client = api_client or AgentApiClient()
        self.paired = False
        self.credentials: dict[str, Any] = {}

    @property
    def is_paired(self) -> bool:
        return self.paired

    def pair_with_code(
        self,
        pairing_code: str,
        device_fingerprint: str | None = None,
        device_name: str | None = None,
        hostname: str | None = None,
        os_version: str | None = None,
        agent_version: str = "0.1.0",
    ) -> dict[str, Any]:
        """Pair agent device with single-use code."""
        result = pair_device(
            api_client=self.api_client,
            pairing_code=pairing_code,
            device_fingerprint=device_fingerprint,
            device_name=device_name,
            hostname=hostname,
            os_version=os_version,
            agent_version=agent_version,
        )
        self.paired = True
        self.credentials = result
        return result
