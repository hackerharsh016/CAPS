"""Tests metadata logging and sensitive data redaction."""

import json
import logging
import unittest

from caps_agent.utils.logging import (
    RedactingFilter,
    StructuredMetadataFormatter,
    redact_sensitive_data,
)


class TestLoggingRedaction(unittest.TestCase):
    def test_redact_sensitive_keys(self) -> None:
        payload = {
            "job_id": "job-101",
            "device_token": "secret-token-xyz",
            "auth_token": "bearer-abc",
            "password": "my-password",
            "printer_name": "Canon LBP2900",
            "customer_phone": "+919876543210",
            "nested": {
                "secret_key": "nested-secret",
                "copies": 3,
            },
        }

        redacted = redact_sensitive_data(payload)

        self.assertEqual(redacted["job_id"], "job-101")
        self.assertEqual(redacted["device_token"], "[REDACTED]")
        self.assertEqual(redacted["auth_token"], "[REDACTED]")
        self.assertEqual(redacted["password"], "[REDACTED]")
        self.assertEqual(redacted["printer_name"], "Canon LBP2900")
        self.assertEqual(redacted["customer_phone"], "[REDACTED]")
        self.assertEqual(redacted["nested"]["secret_key"], "[REDACTED]")
        self.assertEqual(redacted["nested"]["copies"], 3)

    def test_redact_bearer_token_string(self) -> None:
        text = "Sending request with Authorization: Bearer eyJhbGciOiJIUzI1Ni.abc to cloud"
        redacted = redact_sensitive_data(text)
        self.assertNotIn("eyJhbGciOiJIUzI1Ni.abc", redacted)
        self.assertIn("Authorization: Bearer [REDACTED] to cloud", redacted)

    def test_structured_json_formatter(self) -> None:
        formatter = StructuredMetadataFormatter()
        record = logging.LogRecord(
            name="caps_agent.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=42,
            msg="Print attempt submitted",
            args=(),
            exc_info=None,
        )
        record.metadata = {  # type: ignore[attr-defined]
            "job_id": "job-999",
            "pages": 14,
            "device_token": "leak-attempt",
        }

        formatted_json = formatter.format(record)
        data = json.loads(formatted_json)

        self.assertEqual(data["level"], "INFO")
        self.assertEqual(data["message"], "Print attempt submitted")
        self.assertEqual(data["metadata"]["job_id"], "job-999")
        self.assertEqual(data["metadata"]["pages"], 14)
        self.assertEqual(data["metadata"]["device_token"], "[REDACTED]")

    def test_redacting_filter_modifies_record_msg(self) -> None:
        log_filter = RedactingFilter()
        record = logging.LogRecord(
            name="caps_agent.test",
            level=logging.WARNING,
            pathname=__file__,
            lineno=10,
            msg="Connected with Bearer sensitive_token_value_123",
            args=(),
            exc_info=None,
        )
        self.assertTrue(log_filter.filter(record))
        self.assertNotIn("sensitive_token_value_123", record.msg)
        self.assertIn("Bearer [REDACTED]", record.msg)


if __name__ == "__main__":
    unittest.main()
