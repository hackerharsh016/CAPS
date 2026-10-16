"""Tests agent configuration parsing, defaults, and security boundaries."""

import unittest
from pathlib import Path

from caps_agent.config import AgentConfig, ConfigurationError, load_config


class TestAgentConfig(unittest.TestCase):
    def setUp(self) -> None:
        self.valid_env = {
            "CAPS_AGENT_CLOUD_API_URL": "https://api.caps.local/v1",
            "CAPS_AGENT_REALTIME_URL": "wss://api.caps.local/realtime",
            "CAPS_SHOP_ID": "shop-1234",
            "CAPS_DEVICE_ID": "device-5678",
            "CAPS_DEVICE_TOKEN": "secret-device-token-abc",
            "CAPS_AGENT_LOCAL_BIND": "127.0.0.1",
            "CAPS_AGENT_LOCAL_PORT": "9099",
            "CAPS_AGENT_TEMP_DIR": "/custom/spool",
            "CAPS_LOG_LEVEL": "DEBUG",
        }

    def test_load_valid_config(self) -> None:
        config = load_config(self.valid_env)
        self.assertEqual(config.cloud_api_url, "https://api.caps.local/v1")
        self.assertEqual(config.realtime_url, "wss://api.caps.local/realtime")
        self.assertEqual(config.shop_id, "shop-1234")
        self.assertEqual(config.device_id, "device-5678")
        self.assertEqual(config.device_token, "secret-device-token-abc")
        self.assertEqual(config.local_diagnostics_host, "127.0.0.1")
        self.assertEqual(config.local_diagnostics_port, 9099)
        self.assertEqual(config.temp_dir, Path("/custom/spool"))
        self.assertEqual(config.log_level, "DEBUG")

    def test_missing_cloud_api_url_raises_error(self) -> None:
        env = dict(self.valid_env)
        del env["CAPS_AGENT_CLOUD_API_URL"]
        with self.assertRaises(ConfigurationError) as ctx:
            load_config(env)
        self.assertIn("CAPS_AGENT_CLOUD_API_URL", str(ctx.exception))

    def test_missing_realtime_url_raises_error(self) -> None:
        env = dict(self.valid_env)
        del env["CAPS_AGENT_REALTIME_URL"]
        with self.assertRaises(ConfigurationError) as ctx:
            load_config(env)
        self.assertIn("CAPS_AGENT_REALTIME_URL", str(ctx.exception))

    def test_malformed_url_raises_error(self) -> None:
        env = dict(self.valid_env)
        env["CAPS_AGENT_CLOUD_API_URL"] = "ftp://invalid-scheme.com"
        with self.assertRaises(ConfigurationError) as ctx:
            load_config(env)
        self.assertIn("Invalid cloud_api_url", str(ctx.exception))

    def test_security_violation_non_loopback_host_rejected(self) -> None:
        # Crucial security test: agent local diagnostics MUST NOT bind to public interface (0.0.0.0)
        env = dict(self.valid_env)
        env["CAPS_AGENT_LOCAL_BIND"] = "0.0.0.0"
        with self.assertRaises(ConfigurationError) as ctx:
            load_config(env)
        self.assertIn("Security violation", str(ctx.exception))
        self.assertIn("forbidden", str(ctx.exception))

    def test_invalid_port_range_rejected(self) -> None:
        env = dict(self.valid_env)
        env["CAPS_AGENT_LOCAL_PORT"] = "80"  # Privileged / out-of-range port
        with self.assertRaises(ConfigurationError) as ctx:
            load_config(env)
        self.assertIn("between 1024 and 65535", str(ctx.exception))

    def test_invalid_log_level_rejected(self) -> None:
        with self.assertRaises(ConfigurationError):
            AgentConfig(
                cloud_api_url="http://localhost:4000",
                realtime_url="ws://localhost:4000/rt",
                log_level="VERBOSE_INVALID",
            )


if __name__ == "__main__":
    unittest.main()
