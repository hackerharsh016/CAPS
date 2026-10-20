"""Configuration management and validation for CAPS Print Agent.

Enforces zero-hardcoded secrets, loopback-only local diagnostics, and strict
type validation using standard library dataclasses.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse


class ConfigurationError(ValueError):
    """Raised when agent configuration is missing or malformed."""
    pass


@dataclass(frozen=True)
class AgentConfig:
    cloud_api_url: str
    realtime_url: str
    shop_id: str | None = None
    device_id: str | None = None
    device_token: str | None = None
    local_diagnostics_host: str = "127.0.0.1"
    local_diagnostics_port: int = 9099
    temp_dir: Path = field(default_factory=lambda: Path(os.environ.get("TEMP", "/tmp")) / "caps_spool")
    db_path: Path = field(
        default_factory=lambda: Path(os.environ.get("LOCALAPPDATA", os.environ.get("TEMP", "/tmp")))
        / "caps_agent"
        / "state.db"
    )
    temp_cleanup_max_age_seconds: int = 3600
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        # Validate Cloud API URL
        parsed_api = urlparse(self.cloud_api_url)
        if parsed_api.scheme not in ("http", "https") or not parsed_api.netloc:
            raise ConfigurationError(
                f"Invalid cloud_api_url: '{self.cloud_api_url}'. Must be a valid HTTP/HTTPS URL."
            )

        # Validate Realtime URL
        parsed_rt = urlparse(self.realtime_url)
        if parsed_rt.scheme not in ("ws", "wss", "http", "https") or not parsed_rt.netloc:
            raise ConfigurationError(
                f"Invalid realtime_url: '{self.realtime_url}'. Must be a valid WS/WSS URL."
            )

        # Enforce Loopback-only constraint for local diagnostics
        allowed_loopback = ("127.0.0.1", "localhost", "::1")
        if self.local_diagnostics_host not in allowed_loopback:
            raise ConfigurationError(
                f"Security violation: local_diagnostics_host '{self.local_diagnostics_host}' "
                f"is forbidden. Must bind strictly to loopback ({', '.join(allowed_loopback)})."
            )

        # Validate Port
        if not (1024 <= self.local_diagnostics_port <= 65535):
            raise ConfigurationError(
                f"Invalid local_diagnostics_port: {self.local_diagnostics_port}. "
                "Must be between 1024 and 65535."
            )

        # Validate Log Level
        allowed_levels = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
        if self.log_level.upper() not in allowed_levels:
            raise ConfigurationError(
                f"Invalid log_level: '{self.log_level}'. Must be one of {allowed_levels}."
            )


def load_config(env: dict[str, str] | None = None) -> AgentConfig:
    """Load and validate configuration from environment dictionary or process env."""
    e = os.environ if env is None else env

    api_url = e.get("CAPS_AGENT_CLOUD_API_URL")
    if not api_url:
        raise ConfigurationError("Missing required environment variable: CAPS_AGENT_CLOUD_API_URL")

    rt_url = e.get("CAPS_AGENT_REALTIME_URL")
    if not rt_url:
        raise ConfigurationError("Missing required environment variable: CAPS_AGENT_REALTIME_URL")

    host = e.get("CAPS_AGENT_LOCAL_BIND", "127.0.0.1")
    port_raw = e.get("CAPS_AGENT_LOCAL_PORT", "9099")
    try:
        port = int(port_raw)
    except ValueError:
        raise ConfigurationError(
            f"CAPS_AGENT_LOCAL_PORT must be an integer, got '{port_raw}'"
        ) from None

    temp_raw = e.get("CAPS_AGENT_TEMP_DIR")
    temp_dir = Path(temp_raw) if temp_raw else Path(e.get("TEMP", "/tmp")) / "caps_spool"

    db_raw = e.get("CAPS_AGENT_DB_PATH")
    db_path = (
        Path(db_raw)
        if db_raw
        else Path(e.get("LOCALAPPDATA", e.get("TEMP", "/tmp"))) / "caps_agent" / "state.db"
    )

    max_age_raw = e.get("CAPS_AGENT_CLEANUP_MAX_AGE_SEC", "3600")
    try:
        max_age_sec = int(max_age_raw)
    except ValueError:
        raise ConfigurationError(
            f"CAPS_AGENT_CLEANUP_MAX_AGE_SEC must be an integer, got '{max_age_raw}'"
        ) from None

    return AgentConfig(
        cloud_api_url=api_url,
        realtime_url=rt_url,
        shop_id=e.get("CAPS_SHOP_ID"),
        device_id=e.get("CAPS_DEVICE_ID"),
        device_token=e.get("CAPS_DEVICE_TOKEN"),
        local_diagnostics_host=host,
        local_diagnostics_port=port,
        temp_dir=temp_dir,
        db_path=db_path,
        temp_cleanup_max_age_seconds=max_age_sec,
        log_level=e.get("CAPS_LOG_LEVEL", "INFO"),
    )
