"""Structured metadata-only logging with automatic redaction of sensitive data."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

# Sensitive key patterns that must be redacted
SENSITIVE_KEYS = {
    "token",
    "device_token",
    "auth_token",
    "password",
    "secret",
    "authorization",
    "bearer",
    "document_content",
    "customer_phone",
    "phone",
    "customer_name",
}

BEARER_PATTERN = re.compile(r"Bearer\s+([A-Za-z0-9_\-\.]+)", re.IGNORECASE)
JWT_PATTERN = re.compile(r"eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+(?:\.[A-Za-z0-9-_]+)?")
KEY_VALUE_SECRET_PATTERN = re.compile(
    r"\b(token|device_token|auth_token|password|secret)\s*[:=]\s*([^\s,;]+)",
    re.IGNORECASE,
)


def redact_sensitive_data(data: Any) -> Any:
    """Recursively redact sensitive keys and values from dictionary, list, or string."""
    if isinstance(data, dict):
        cleaned: dict[str, Any] = {}
        for k, v in data.items():
            if any(s in k.lower() for s in SENSITIVE_KEYS):
                cleaned[k] = "[REDACTED]"
            else:
                cleaned[k] = redact_sensitive_data(v)
        return cleaned
    if isinstance(data, list):
        return [redact_sensitive_data(item) for item in data]
    if isinstance(data, str):
        res = BEARER_PATTERN.sub("Bearer [REDACTED]", data)
        res = JWT_PATTERN.sub("[REDACTED_TOKEN]", res)
        res = KEY_VALUE_SECRET_PATTERN.sub(r"\1=[REDACTED]", res)
        return res
    return data


class RedactingFilter(logging.Filter):
    """Filter that intercepts log records and redacts tokens and sensitive data."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_sensitive_data(record.msg)
        if hasattr(record, "metadata") and isinstance(record.metadata, dict):
            record.metadata = redact_sensitive_data(record.metadata)
        return True


class StructuredMetadataFormatter(logging.Formatter):
    """Formats log records as structured JSON entries with safe metadata."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        if hasattr(record, "metadata") and isinstance(record.metadata, dict):
            payload["metadata"] = redact_sensitive_data(record.metadata)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload)


def setup_logging(
    level: str = "INFO", logger_name: str = "caps_agent", use_json: bool = True
) -> logging.Logger:
    """Configure structured, redacting logger."""
    logger = logging.getLogger(logger_name)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Avoid duplicate handlers on re-initialization
    if not logger.handlers:
        handler = logging.StreamHandler()
        if use_json:
            handler.setFormatter(StructuredMetadataFormatter())
        else:
            handler.setFormatter(
                logging.Formatter("[%(asctime)s] [%(levelname)s] %(name)s: %(message)s")
            )
        handler.addFilter(RedactingFilter())
        logger.addHandler(handler)

    return logger
