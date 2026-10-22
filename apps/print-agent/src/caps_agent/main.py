"""Entrypoint for the CAPS Desktop Print Agent daemon."""

from __future__ import annotations

import contextlib
import logging
import os
import signal
import sys
import threading
from typing import Any

from caps_agent import __version__
from caps_agent.api.server import DiagnosticsLogBuffer, DiagnosticsServer
from caps_agent.auth.credentials import AgentCredentials, CredentialStore
from caps_agent.config import ConfigurationError, load_config
from caps_agent.jobs.dispatcher import JobDispatcher
from caps_agent.jobs.recovery import StartupRecoveryCoordinator
from caps_agent.printing.printer_discovery import PrinterDiscovery
from caps_agent.storage.cleanup import ArtifactCleaner
from caps_agent.storage.local_state import LocalStateJournal
from caps_agent.storage.temp_files import TempFileManager
from caps_agent.tray.controller import (
    DesktopTrayAdapter,
    HeadlessTrayAdapter,
    TrayController,
    TrayStatus,
)
from caps_agent.utils.logging import setup_logging


def _create_print_engine() -> Any:
    """Instantiate appropriate print engine based on platform."""
    if sys.platform == "win32":
        try:
            from caps_agent.printing.engine import WindowsPrintEngine

            return WindowsPrintEngine()
        except Exception as err:
            logging.getLogger("caps_agent").warning(
                "WindowsPrintEngine unavailable (%s), falling back to FakePrintEngine", err
            )
            from caps_agent.printing.fake_engine import FakePrintEngine

            return FakePrintEngine()
    else:
        from caps_agent.printing.fake_engine import FakePrintEngine

        return FakePrintEngine()


def _pause_if_interactive_windows() -> None:
    """Keep console open if user double-clicked the executable in Windows Explorer."""
    if (
        sys.platform == "win32"
        and sys.stdin
        and hasattr(sys.stdin, "isatty")
        and sys.stdin.isatty()
    ):
        try:
            sys.stderr.write("\n[ERROR] Process halted. Press Enter to close this window...")
            sys.stderr.flush()
            input()
        except Exception:
            pass


def main(argv: list[str] | None = None) -> int:
    """Bootstrap agent, validate configuration, and initialize subsystems."""
    args = argv if argv is not None else sys.argv[1:]

    if "--version" in args or "-v" in args:
        sys.stdout.write(f"caps-agent {__version__}\n")
        return 0

    if "--smoke" in args:
        sys.stdout.write(f"caps-agent {__version__}: binary runner smoke check OK\n")
        return 0

    if "--help" in args or "-h" in args:
        sys.stdout.write(
            f"CAPS Desktop Print Agent v{__version__}\n\n"
            "Usage: caps-agent [OPTIONS]\n\n"
            "Options:\n"
            "  --help, -h       Show this help message and exit\n"
            "  --version, -v    Show agent version and exit\n"
            "  --smoke          Run executable smoke check and exit\n"
            "  --once           Run startup checks and exit without daemon loop\n"
            "  --headless       Run without GUI system tray icon\n"
        )
        return 0

    logger = setup_logging(use_json=False)

    try:
        config = load_config()
    except ConfigurationError as err:
        logger.error("Configuration validation failed: %s", err)
        _pause_if_interactive_windows()
        return 1
    except Exception as err:
        logger.error("Unexpected startup error: %s", err, exc_info=True)
        _pause_if_interactive_windows()
        return 1

    # Attach in-memory ring buffer for local diagnostics endpoint (/api/v1/logs)
    log_buffer = DiagnosticsLogBuffer(capacity=200)
    logging.getLogger().addHandler(log_buffer)

    logger.info("==========================================================")
    logger.info(" Starting CAPS Print Agent v%s", __version__)
    logger.info("==========================================================")
    logger.info("Cloud API endpoint:        %s", config.cloud_api_url)
    logger.info("Realtime endpoint:         %s", config.realtime_url)
    logger.info(
        "Local diagnostics binding: http://%s:%d",
        config.local_diagnostics_host,
        config.local_diagnostics_port,
    )
    logger.info("Spool temporary directory: %s", config.temp_dir)
    logger.info("Local state database:      %s", config.db_path)

    try:
        # 1. Discover local printers
        printer_discovery = PrinterDiscovery()
        try:
            discovered = printer_discovery.enumerate_printers()
            printer_names = [p.name for p in discovered]
            logger.info("Discovered %d local printer(s): %s", len(discovered), printer_names)
        except Exception as err:
            logger.warning("Printer discovery warning: %s", err)

        # 2. Print engine & storage
        print_engine = _create_print_engine()
        journal = LocalStateJournal(db_path=config.db_path)
        temp_mgr = TempFileManager(base_dir=config.temp_dir)
        cleaner = ArtifactCleaner(temp_manager=temp_mgr)
        try:
            cleaner.cleanup_orphans(max_age_seconds=config.temp_cleanup_max_age_seconds)
        except Exception as err:
            logger.debug("Orphan cleanup warning: %s", err)

        # 3. Startup crash recovery
        recovery_coord = StartupRecoveryCoordinator(
            journal=journal,
            cleaner=cleaner,
        )
        try:
            recovery_report = recovery_coord.reconcile_startup()
            if recovery_report.reconciled_jobs:
                logger.info(
                    "Startup crash recovery reconciled %d interrupted job(s)",
                    len(recovery_report.reconciled_jobs),
                )
        except Exception as err:
            logger.warning("Startup crash recovery check warning: %s", err)

        # 4. Job dispatcher
        dispatcher = JobDispatcher(
            engine=print_engine,
            journal=journal,
            cleaner=cleaner,
            shop_id=config.shop_id or "default_shop",
        )

        # 5. Check pairing & credentials
        cred_store = CredentialStore()
        stored_creds = None
        try:
            stored_creds = cred_store.load()
        except Exception as err:
            logger.debug("No stored credentials found: %s", err)

        active_token = config.device_token or (
            stored_creds.device_token if stored_creds else None
        )
        active_shop = config.shop_id or (stored_creds.shop_id if stored_creds else None)
        active_device = config.device_id or (
            stored_creds.device_id if stored_creds else None
        )

        credentials = None
        if active_token and active_shop and active_device:
            credentials = AgentCredentials(
                device_token=active_token,
                shop_id=active_shop,
                device_id=active_device,
            )

        # 6. Stop event coordination
        stop_event = threading.Event()

        def request_stop() -> None:
            stop_event.set()

        # 7. Local diagnostics loopback HTTP server
        diag_server = DiagnosticsServer(
            host=config.local_diagnostics_host,
            port=config.local_diagnostics_port,
            credentials=credentials,
            dispatcher=dispatcher,
            printer_discovery=printer_discovery,
            log_buffer=log_buffer,
            on_operator_stop=request_stop,
        )
        try:
            diag_server.start()
        except Exception as err:
            logger.error(
                "Failed to bind diagnostics server to %s:%d: %s",
                config.local_diagnostics_host,
                config.local_diagnostics_port,
                err,
            )

        # 8. System tray controller
        adapter = (
            HeadlessTrayAdapter() if "--headless" in args else DesktopTrayAdapter()
        )
        tray_controller = TrayController(
            adapter=adapter,
            dispatcher=dispatcher,
            diagnostics_server=diag_server,
            on_stop=request_stop,
        )
        try:
            tray_controller.start()
        except Exception as err:
            logger.warning("TrayController start warning: %s", err)

        # 9. Realtime cloud connection if paired
        realtime_coordinator = None
        sync_manager = None

        if credentials:
            from caps_agent.cloud.api_client import CloudApiClient
            from caps_agent.cloud.realtime_client import RealtimeClaimCoordinator
            from caps_agent.cloud.status_sync import (
                StatusSyncManager,
                bind_status_sync_to_dispatcher,
            )

            api_client = CloudApiClient(
                base_url=config.cloud_api_url,
                credentials=credentials,
            )
            sync_manager = StatusSyncManager(
                api_client=api_client,
                journal=journal,
            )
            bind_status_sync_to_dispatcher(dispatcher, sync_manager)
            sync_manager.start()

            realtime_coordinator = RealtimeClaimCoordinator(
                api_client=api_client,
                dispatcher=dispatcher,
                credentials=credentials,
                realtime_url=config.realtime_url,
                temp_dir=config.temp_dir,
            )
            realtime_coordinator.start()
            logger.info(
                "Agent paired: Authenticated as device '%s' for shop '%s'",
                credentials.device_id,
                credentials.shop_id,
            )
            tray_controller.set_status(TrayStatus.IDLE, "Online - connected to cloud")
        else:
            logger.warning("Agent unpaired: No device token provided. Standby for pairing.")
            logger.info("Diagnostics dashboard: http://%s:%d/health", config.local_diagnostics_host, config.local_diagnostics_port)
            logger.info("Pair this agent via the Shop Owner Dashboard or set CAPS_DEVICE_TOKEN in .env")
            tray_controller.set_status(TrayStatus.IDLE, "Standby for pairing")

        # Handle --once flag (used in automated checks / tests)
        if "--once" in args:
            logger.info("Run-once flag passed. Stopping agent cleanly.")
            if realtime_coordinator:
                realtime_coordinator.stop(wait=True)
            if sync_manager:
                sync_manager.stop()
            dispatcher.shutdown(wait=True)
            diag_server.stop()
            tray_controller.stop()
            return 0

        # Register signal handlers for graceful shutdown on Ctrl+C / SIGINT / SIGTERM
        def _sig_handler(sig: int, frame: Any) -> None:
            logger.info("Received termination signal %s. Shutting down...", sig)
            request_stop()

        try:
            signal.signal(signal.SIGINT, _sig_handler)
            if hasattr(signal, "SIGTERM"):
                signal.signal(signal.SIGTERM, _sig_handler)
        except Exception:
            pass

        logger.info("----------------------------------------------------------")
        logger.info(" CAPS Print Agent is running (PID: %d).", os.getpid())
        logger.info(" Health endpoint: http://%s:%d/health", config.local_diagnostics_host, config.local_diagnostics_port)
        logger.info(" Press Ctrl+C or close this window to stop.")
        logger.info("----------------------------------------------------------")

        # Daemon main loop: stays alive until stop requested
        try:
            while not stop_event.is_set():
                stop_event.wait(timeout=0.5)
        except (KeyboardInterrupt, SystemExit):
            logger.info("Shutdown requested by user.")
        finally:
            logger.info("Shutting down CAPS Print Agent subsystems...")
            if realtime_coordinator:
                with contextlib.suppress(Exception):
                    realtime_coordinator.stop(wait=True)
            if sync_manager:
                with contextlib.suppress(Exception):
                    sync_manager.stop()
            with contextlib.suppress(Exception):
                dispatcher.shutdown(wait=True)
            with contextlib.suppress(Exception):
                diag_server.stop()
            with contextlib.suppress(Exception):
                tray_controller.stop()
            logger.info("CAPS Print Agent stopped cleanly.")

        return 0

    except Exception as err:
        logger.error("Fatal runtime error in CAPS Print Agent: %s", err, exc_info=True)
        _pause_if_interactive_windows()
        return 1


if __name__ == "__main__":
    sys.exit(main())
