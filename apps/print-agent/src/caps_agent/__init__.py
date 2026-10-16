"""CAPS Desktop Print Agent package."""

from caps_agent.config import AgentConfig, ConfigurationError, load_config
from caps_agent.printing.engine import PrintEngine, PrintResult, PrintSettings
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.utils.logging import redact_sensitive_data, setup_logging

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AgentConfig",
    "ConfigurationError",
    "load_config",
    "PrintEngine",
    "PrintResult",
    "PrintSettings",
    "FakePrintEngine",
    "setup_logging",
    "redact_sensitive_data",
]
