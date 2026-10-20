"""CAPS Desktop Print Agent package."""

from caps_agent.auth import (
    AgentCredentials,
    CredentialStore,
    PairingManager,
)
from caps_agent.cloud import (
    AuthenticationError,
    CloudApiClient,
    CloudApiError,
    JobClaimResponse,
    MockRealtimeTransport,
    RealtimeClaimCoordinator,
    RealtimeClient,
    RealtimeError,
    RealtimeTransport,
    RealtimeWakeEvent,
    TenantMismatchError,
)
from caps_agent.config import AgentConfig, ConfigurationError, load_config
from caps_agent.jobs import (
    JobDispatcher,
    JobItem,
    JobState,
    JobStateMachine,
    ReconciledJob,
    RecoveryReport,
    StartupRecoveryCoordinator,
)
from caps_agent.printing.engine import (
    PrintEngine,
    PrintEngineError,
    PrintResult,
    PrintSettings,
    StandardPrintEngine,
    WindowsPrintEngine,
)
from caps_agent.printing.fake_engine import FakePrintEngine
from caps_agent.storage import (
    ArtifactCleaner,
    CleanupReport,
    JobAttemptRecord,
    LocalStateJournal,
    TempFileManager,
)
from caps_agent.utils.logging import redact_sensitive_data, setup_logging

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "AgentConfig",
    "ConfigurationError",
    "load_config",
    "AgentCredentials",
    "CredentialStore",
    "PairingManager",
    "CloudApiClient",
    "CloudApiError",
    "AuthenticationError",
    "TenantMismatchError",
    "JobClaimResponse",
    "RealtimeClient",
    "RealtimeClaimCoordinator",
    "RealtimeWakeEvent",
    "RealtimeTransport",
    "MockRealtimeTransport",
    "RealtimeError",
    "PrintEngine",
    "PrintResult",
    "PrintSettings",
    "WindowsPrintEngine",
    "StandardPrintEngine",
    "PrintEngineError",
    "FakePrintEngine",
    "JobDispatcher",
    "JobItem",
    "JobState",
    "JobStateMachine",
    "StartupRecoveryCoordinator",
    "RecoveryReport",
    "ReconciledJob",
    "LocalStateJournal",
    "JobAttemptRecord",
    "TempFileManager",
    "ArtifactCleaner",
    "CleanupReport",
    "setup_logging",
    "redact_sensitive_data",
]
