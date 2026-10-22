"""Unit tests for Win32 Spooler Execution, DEVMODE Mapping & Fault Trapping (INT-D4-04)."""

import unittest
from unittest.mock import MagicMock
from api_client import AgentApiClient
from spooler import (
    JOB_STATUS_ERROR,
    JOB_STATUS_OFFLINE,
    JOB_STATUS_PAPEROUT,
    JOB_STATUS_PRINTED,
    JOB_STATUS_PRINTING,
    PrinterOfflineError,
    SpoolerService,
)
from win32_print_engine import Win32PrintEngine


class TestWin32Spooler(unittest.TestCase):
    def setUp(self):
        self.mock_api_client = MagicMock(spec=AgentApiClient)
        self.engine = Win32PrintEngine(use_mock=True)
        self.service = SpoolerService(
            api_client=self.mock_api_client,
            engine=self.engine,
            poll_interval=0.01,  # Fast polling for unit tests
            watchdog_timeout=5.0,
        )

        self.sample_job_id = "test-job-uuid-1001"
        self.sample_attempt_id = "attempt-uuid-1001"
        self.sample_printer = "Microsoft Print to PDF"
        self.sample_data = b"%PDF-1.4 test payload bytes"
        self.sample_settings = {
            "paper_size": "a4",
            "color_mode": "bw",
            "duplex": "duplex_long",
            "copies": 2,
        }

    def test_silent_spooler_dispatch_and_completed_lifecycle(self):
        """Happy path: job dispatches silently, polls status, and transitions to COMPLETED."""
        # Setup mock engine to simulate: SPOOLING -> PRINTING (pages 1 then 2) -> PRINTED
        poll_count = 0

        original_get_job = self.engine.get_job

        def get_job_progression(hprinter, job_id, level=2):
            nonlocal poll_count
            poll_count += 1
            if poll_count == 1:
                return {"Status": JOB_STATUS_PRINTING, "PagesPrinted": 1, "TotalPages": 2}
            elif poll_count == 2:
                return {"Status": JOB_STATUS_PRINTING, "PagesPrinted": 2, "TotalPages": 2}
            else:
                return {"Status": JOB_STATUS_PRINTED, "PagesPrinted": 2, "TotalPages": 2}

        self.engine.get_job = get_job_progression

        result = self.service.spool_and_monitor(
            job_id=self.sample_job_id,
            attempt_id=self.sample_attempt_id,
            printer_name=self.sample_printer,
            document_path=self.sample_data,
            settings=self.sample_settings,
            lease_token="lease-xyz-123",
            total_pages=2,
        )

        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["pages_printed"], 2)
        self.assertGreater(result["spooler_job_id"], 0)

        # Verify Cloud API status reports were triggered
        self.assertTrue(self.mock_api_client.update_job_status.called)

        # Check call arguments: must include PRINTING and COMPLETED
        calls = self.mock_api_client.update_job_status.call_args_list
        statuses = [c.kwargs.get("status") for c in calls]
        self.assertIn("PRINTING", statuses)
        self.assertIn("COMPLETED", statuses)

        # Final call must report COMPLETED with total pages
        final_call = calls[-1].kwargs
        self.assertEqual(final_call["status"], "COMPLETED")
        self.assertEqual(final_call["pages_printed"], 2)
        self.assertEqual(final_call["total_pages"], 2)

    def test_traps_paper_out_fault_and_reports_printer_offline(self):
        """Hardware fault: out-of-paper traps and reports PRINTER_OFFLINE to Cloud API."""
        def get_job_paper_out(hprinter, job_id, level=2):
            return {"Status": JOB_STATUS_PAPEROUT, "PagesPrinted": 0, "TotalPages": 1}

        self.engine.get_job = get_job_paper_out

        with self.assertRaises(PrinterOfflineError) as ctx:
            self.service.spool_and_monitor(
                job_id=self.sample_job_id,
                attempt_id=self.sample_attempt_id,
                printer_name=self.sample_printer,
                document_path=self.sample_data,
                settings=self.sample_settings,
                total_pages=1,
            )

        self.assertEqual(ctx.exception.error_code, "PRINTER_OFFLINE")
        self.assertIn("out of paper", str(ctx.exception).lower())

        # Verify Cloud API was notified with FAILED and PRINTER_OFFLINE
        failed_call = [
            c.kwargs
            for c in self.mock_api_client.update_job_status.call_args_list
            if c.kwargs.get("status") == "FAILED"
        ]
        self.assertTrue(len(failed_call) >= 1)
        self.assertEqual(failed_call[0]["error_code"], "PRINTER_OFFLINE")
        self.assertIn("paper", failed_call[0]["error_message"].lower())

    def test_traps_printer_disconnected_or_offline_fault(self):
        """Hardware fault: disconnected or offline printer reports PRINTER_OFFLINE to Cloud API."""
        def get_job_offline(hprinter, job_id, level=2):
            return {"Status": JOB_STATUS_OFFLINE, "PagesPrinted": 0, "TotalPages": 1}

        self.engine.get_job = get_job_offline

        with self.assertRaises(PrinterOfflineError) as ctx:
            self.service.spool_and_monitor(
                job_id=self.sample_job_id,
                attempt_id=self.sample_attempt_id,
                printer_name=self.sample_printer,
                document_path=self.sample_data,
                settings=self.sample_settings,
                total_pages=1,
            )

        self.assertEqual(ctx.exception.error_code, "PRINTER_OFFLINE")

        # Verify Cloud API report
        failed_call = [
            c.kwargs
            for c in self.mock_api_client.update_job_status.call_args_list
            if c.kwargs.get("status") == "FAILED"
        ]
        self.assertTrue(len(failed_call) >= 1)
        self.assertEqual(failed_call[0]["error_code"], "PRINTER_OFFLINE")
        self.assertIn("offline", failed_call[0]["error_message"].lower())

    def test_traps_spooler_general_error(self):
        """Driver or spooler communication error traps and reports PRINTER_OFFLINE."""
        def get_job_error(hprinter, job_id, level=2):
            return {"Status": JOB_STATUS_ERROR, "PagesPrinted": 0, "TotalPages": 1}

        self.engine.get_job = get_job_error

        with self.assertRaises(PrinterOfflineError) as ctx:
            self.service.spool_and_monitor(
                job_id=self.sample_job_id,
                attempt_id=self.sample_attempt_id,
                printer_name=self.sample_printer,
                document_path=self.sample_data,
                settings=self.sample_settings,
                total_pages=1,
            )

        self.assertEqual(ctx.exception.error_code, "PRINTER_OFFLINE")

    def test_win32_print_engine_lifecycle(self):
        """Verify Win32PrintEngine raw print lifecycle without exceptions."""
        engine = Win32PrintEngine(use_mock=True)
        job_id = engine.print_raw_data(
            printer_name="Microsoft Print to PDF",
            data=b"Test Page Payload",
            doc_name="Test Document",
        )
        self.assertIsInstance(job_id, int)
        self.assertGreater(job_id, 0)

        job_info = engine.get_job(handle := engine.open_printer("Microsoft Print to PDF"), job_id)
        engine.close_printer(handle)
        self.assertIsNotNone(job_info)
        self.assertEqual(job_info["JobId"], job_id)


if __name__ == "__main__":
    unittest.main()
