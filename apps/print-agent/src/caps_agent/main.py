"""Entrypoint for the CAPS Desktop Print Agent daemon."""

from __future__ import annotations

import sys

from caps_agent import __version__
from caps_agent.config import ConfigurationError, load_config
from caps_agent.utils.logging import setup_logging


def main() -> int:
    """Bootstrap agent, validate configuration, and initialize subsystems."""
    logger = setup_logging(use_json=False)

    try:
        config = load_config()
    except ConfigurationError as err:
        logger.error("Configuration validation failed: %s", err)
        return 1

    logger.info("Starting CAPS Print Agent v%s", __version__)
    logger.info("Cloud API endpoint: %s", config.cloud_api_url)
    logger.info("Realtime endpoint: %s", config.realtime_url)
    logger.info("Local diagnostics binding: %s:%d", config.local_diagnostics_host, config.local_diagnostics_port)
    logger.info("Spool temporary directory: %s", config.temp_dir)

    if config.device_token:
        logger.info("Device authenticated: [TOKEN CONFIGURED - REDACTED]")
    else:
        logger.warning("Agent unpaired: No device token provided. Standby for pairing.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
