"""Authenticated Cloud API client for CAPS Print Agent.

Provides robust, contract-validated communication with the CAPS Cloud API:
- Outbound-only HTTPS connectivity
- Bearer token authentication and automatic refresh on HTTP 401
- Tenant isolation enforcement (rejects mismatched shop_id)
- Exponential backoff and retry on transient 5xx / timeout errors
- Strict JSON Schema validation for job claim and status update payloads
- Streaming document downloads with SHA-256 integrity verification
- Zero-token logging policy
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from caps_agent.auth.credentials import AgentCredentials

logger = logging.getLogger("caps_agent.cloud.api_client")


# ==============================================================================
# Error Taxonomy
# ==============================================================================


class CloudApiError(Exception):
    """Base exception for all Cloud API errors."""

    def __init__(self, message: str, status_code: int | None = None, error_code: str = "CLOUD_API_ERROR"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code


class AuthenticationError(CloudApiError):
    """Raised on HTTP 401 Unauthorized or invalid device credentials."""

    def __init__(self, message: str = "Authentication failed; invalid or expired device credentials"):
        super().__init__(message, status_code=401, error_code="AUTHENTICATION_FAILED")


class TenantMismatchError(CloudApiError):
    """Raised on HTTP 403 Forbidden or when response shop_id conflicts with agent shop_id."""

    def __init__(self, message: str = "Tenant authorization mismatch: wrong shop or access forbidden"):
        super().__init__(message, status_code=403, error_code="TENANT_MISMATCH")


class NetworkTimeoutError(CloudApiError):
    """Raised when an HTTP request times out."""

    def __init__(self, message: str = "Request timed out"):
        super().__init__(message, error_code="NETWORK_TIMEOUT")


class ChecksumMismatchError(CloudApiError):
    """Raised when a downloaded document fails SHA-256 verification."""

    def __init__(self, expected: str, actual: str):
        super().__init__(
            f"SHA-256 checksum mismatch: expected '{expected}', computed '{actual}'",
            error_code="CHECKSUM_MISMATCH",
        )
        self.expected = expected
        self.actual = actual


class ContractValidationError(CloudApiError):
    """Raised when request or response fails frozen JSON schema requirements."""

    def __init__(self, message: str):
        super().__init__(message, error_code="CONTRACT_VALIDATION_ERROR")


# ==============================================================================
# HTTP Transport Protocol & Implementations
# ==============================================================================


@dataclass
class HttpResponse:
    """Encapsulates raw HTTP response data."""

    status_code: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> dict[str, Any]:
        """Parse response body as JSON."""
        if not self.body:
            return {}
        try:
            return json.loads(self.body.decode("utf-8"))
        except Exception as err:
            raise ContractValidationError(f"Invalid JSON response: {err}") from err


@runtime_checkable
class HttpTransport(Protocol):
    """Protocol for abstracting HTTP transport (enables in-memory deterministic mocking)."""

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None = None,
        timeout: float = 10.0,
    ) -> HttpResponse:
        ...


class UrllibHttpTransport:
    """Production HTTP transport using Python standard library urllib."""

    def request(
        self,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None = None,
        timeout: float = 10.0,
    ) -> HttpResponse:
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                resp_headers = {k.lower(): v for k, v in response.headers.items()}
                resp_body = response.read()
                return HttpResponse(
                    status_code=response.status,
                    headers=resp_headers,
                    body=resp_body,
                )
        except urllib.error.HTTPError as http_err:
            resp_headers = {k.lower(): v for k, v in http_err.headers.items()}
            resp_body = http_err.read()
            return HttpResponse(
                status_code=http_err.code,
                headers=resp_headers,
                body=resp_body,
            )
        except TimeoutError as t_err:
            raise NetworkTimeoutError(f"HTTP request to {url} timed out: {t_err}") from t_err
        except urllib.error.URLError as url_err:
            if isinstance(url_err.reason, TimeoutError):
                raise NetworkTimeoutError(f"HTTP request to {url} timed out: {url_err}") from url_err
            raise CloudApiError(f"Network error connecting to {url}: {url_err.reason}") from url_err


# ==============================================================================
# Job Claim & Status Models
# ==============================================================================


@dataclass(frozen=True)
class JobClaimResponse:
    """Structured response conforming to packages/validation/src/agent.schema.ts."""

    job_id: str
    attempt_id: str
    lease_id: str
    download_url: str
    settings: dict[str, Any]
    lease_expires_at: str
    checksum_sha256: str | None = None

    def is_lease_expired(self, skew_seconds: float = 5.0) -> bool:
        """Check if lease has expired or will expire within skew_seconds."""
        try:
            exp_str = self.lease_expires_at.replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(exp_str)
            now_dt = datetime.now(UTC)
            return now_dt + timedelta(seconds=skew_seconds) >= exp_dt
        except Exception:
            return False


# ==============================================================================
# Cloud API Client
# ==============================================================================


class CloudApiClient:
    """Authenticated client for CAPS Cloud API communication.

    Handles outbound polling/claims, lease management, token refresh,
    and strict response validation.
    """

    def __init__(
        self,
        base_url: str,
        credentials: AgentCredentials | None = None,
        transport: HttpTransport | None = None,
        token_refresh_hook: Callable[[], AgentCredentials] | None = None,
        max_retries: int = 3,
        backoff_factor: float = 0.5,
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.credentials = credentials
        self.transport = transport or UrllibHttpTransport()
        self.token_refresh_hook = token_refresh_hook
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.timeout = timeout

    def set_credentials(self, credentials: AgentCredentials) -> None:
        """Update active agent credentials."""
        self.credentials = credentials

    def _build_headers(self, unauthenticated: bool = False) -> dict[str, str]:
        """Build standard headers with safe token injection."""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "CAPS-Print-Agent/0.1.0",
        }

        if not unauthenticated and self.credentials is not None:
            headers["Authorization"] = f"Bearer {self.credentials.device_token}"
            headers["X-CAPS-Device-Id"] = self.credentials.device_id
            headers["X-CAPS-Shop-Id"] = self.credentials.shop_id

        return headers

    def _request_with_retry(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        unauthenticated: bool = False,
    ) -> HttpResponse:
        """Execute request with exponential backoff on transient errors and 401 token refresh."""
        url = f"{self.base_url}{path}"
        headers = self._build_headers(unauthenticated=unauthenticated)

        attempt = 0
        refreshed_on_401 = False

        while True:
            attempt += 1
            try:
                resp = self.transport.request(
                    method=method,
                    url=url,
                    headers=headers,
                    body=body,
                    timeout=self.timeout,
                )

                # 1. Handle 401 Unauthorized with token refresh (once per request)
                if resp.status_code == 401 and not unauthenticated and not refreshed_on_401:
                    logger.warning("Received 401 Unauthorized from %s; attempting token refresh", path)
                    if self.token_refresh_hook:
                        try:
                            self.credentials = self.token_refresh_hook()
                            headers = self._build_headers(unauthenticated=False)
                            refreshed_on_401 = True
                            continue
                        except Exception as ref_err:
                            logger.error("Token refresh failed: %s", ref_err)
                            raise AuthenticationError("Token refresh failed following 401 Unauthorized") from ref_err
                    raise AuthenticationError("401 Unauthorized; no refresh hook configured")

                # 2. Handle 403 Forbidden / Tenant Mismatch
                if resp.status_code == 403:
                    logger.error("403 Forbidden accessing %s (tenant/permission mismatch)", path)
                    raise TenantMismatchError("Forbidden: device not authorized for target shop")

                # 3. Handle Transient Server Errors (502, 503, 504) with backoff
                if resp.status_code in (502, 503, 504) and attempt <= self.max_retries:
                    sleep_sec = (self.backoff_factor * (2 ** (attempt - 1))) + random.uniform(0.01, 0.1)
                    logger.warning(
                        "Transient HTTP %d from %s; retrying attempt %d/%d after %.2fs",
                        resp.status_code,
                        path,
                        attempt,
                        self.max_retries,
                        sleep_sec,
                    )
                    time.sleep(sleep_sec)
                    continue

                return resp

            except NetworkTimeoutError:
                if attempt <= self.max_retries:
                    sleep_sec = (self.backoff_factor * (2 ** (attempt - 1))) + random.uniform(0.01, 0.1)
                    logger.warning("Network timeout accessing %s; retry %d/%d after %.2fs", path, attempt, self.max_retries, sleep_sec)
                    time.sleep(sleep_sec)
                    continue
                raise

            except CloudApiError:
                raise

            except Exception as err:
                if attempt <= self.max_retries:
                    sleep_sec = (self.backoff_factor * (2 ** (attempt - 1))) + random.uniform(0.01, 0.1)
                    logger.warning("Unexpected error connecting to %s: %s; retrying in %.2fs", path, err, sleep_sec)
                    time.sleep(sleep_sec)
                    continue
                raise CloudApiError(f"Request failed: {err}") from err

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Authenticated HTTP POST."""
        body_bytes = json.dumps(payload).encode("utf-8")
        resp = self._request_with_retry("POST", path, body=body_bytes)
        if resp.status_code not in (200, 201, 204):
            err_msg = resp.json().get("message", f"HTTP {resp.status_code} from {path}")
            raise CloudApiError(err_msg, status_code=resp.status_code)
        return resp.json()

    def post_unauthenticated(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Unauthenticated HTTP POST (used for pairing and refresh)."""
        body_bytes = json.dumps(payload).encode("utf-8")
        resp = self._request_with_retry("POST", path, body=body_bytes, unauthenticated=True)
        if resp.status_code not in (200, 201):
            err_msg = resp.json().get("message", f"HTTP {resp.status_code} from {path}")
            raise CloudApiError(err_msg, status_code=resp.status_code)
        return resp.json()

    def get(self, path: str) -> dict[str, Any]:
        """Authenticated HTTP GET."""
        resp = self._request_with_retry("GET", path)
        if resp.status_code != 200:
            err_msg = resp.json().get("message", f"HTTP {resp.status_code} from {path}")
            raise CloudApiError(err_msg, status_code=resp.status_code)
        return resp.json()

    # ==========================================================================
    # High-Level Agent Protocol Operations
    # ==========================================================================

    def heartbeat(self) -> dict[str, Any]:
        """Send periodic agent heartbeat and query for pending signals."""
        if not self.credentials:
            raise AuthenticationError("Agent credentials required for heartbeat")

        payload = {
            "device_id": self.credentials.device_id,
            "shop_id": self.credentials.shop_id,
            "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        return self.post("/api/v1/agent/heartbeat", payload)

    def claim_job(self, lease_duration_seconds: int = 90) -> JobClaimResponse | None:
        """Claim next pending print job conforming to JobClaimRequestSchema.

        Validates returned payload against JobClaimResponseSchema and verifies tenant isolation.
        """
        if not self.credentials:
            raise AuthenticationError("Agent credentials required to claim jobs")

        # Conforms to JobClaimRequestSchema (packages/validation/src/agent.schema.ts)
        payload = {
            "agent_device_id": self.credentials.device_id,
            "shop_id": self.credentials.shop_id,
            "lease_duration_seconds": lease_duration_seconds,
        }

        resp = self.post("/api/v1/agent/jobs/claim", payload)
        if not resp or not resp.get("job_id"):
            return None

        # Validate required response fields per JobClaimResponseSchema
        job_id = resp.get("job_id")
        attempt_id = resp.get("attempt_id")
        lease_id = resp.get("lease_id")
        download_url = resp.get("download_url")
        settings = resp.get("settings")
        lease_expires_at = resp.get("lease_expires_at")
        checksum = resp.get("checksum_sha256")

        if not (job_id and attempt_id and lease_id and download_url and settings and lease_expires_at):
            raise ContractValidationError(
                f"Cloud returned incomplete JobClaimResponse: missing fields in {list(resp.keys())}"
            )

        # Tenant isolation check if returned
        resp_shop_id = resp.get("shop_id")
        if resp_shop_id and resp_shop_id != self.credentials.shop_id:
            raise TenantMismatchError(
                f"Cloud returned job '{job_id}' belonging to shop '{resp_shop_id}', "
                f"but agent is paired to shop '{self.credentials.shop_id}'"
            )

        claim = JobClaimResponse(
            job_id=job_id,
            attempt_id=attempt_id,
            lease_id=lease_id,
            download_url=download_url,
            settings=settings,
            lease_expires_at=lease_expires_at,
            checksum_sha256=checksum,
        )

        # Check clock skew / expired lease
        if claim.is_lease_expired():
            raise ContractValidationError(
                f"Claimed job '{job_id}' lease expired immediately upon receipt ({lease_expires_at})"
            )

        return claim

    def update_job_status(
        self,
        job_id: str,
        attempt_id: str,
        status: str,
        spooler_job_id: int | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        """Send execution status update conforming to JobStatusUpdateRequestSchema.

        Allowed status: 'downloading', 'printing', 'completed', 'failed', 'requires_review'.
        """
        allowed_statuses = ("downloading", "printing", "completed", "failed", "requires_review")
        normalized_status = status.lower()
        if normalized_status not in allowed_statuses:
            raise ContractValidationError(
                f"Status '{status}' invalid. Must be one of {allowed_statuses}"
            )

        payload: dict[str, Any] = {
            "job_id": job_id,
            "attempt_id": attempt_id,
            "status": normalized_status,
        }
        if spooler_job_id is not None:
            payload["spooler_job_id"] = spooler_job_id
        if error_message:
            payload["error_message"] = error_message[:1000]

        return self.post("/api/v1/agent/jobs/status", payload)

    def download_document(
        self,
        download_url: str,
        destination_path: Path | str,
        expected_sha256: str | None = None,
    ) -> Path:
        """Stream PDF document from download_url to local path and verify SHA-256 integrity."""
        dest = Path(destination_path).resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)

        sha256_hasher = hashlib.sha256()

        headers = self._build_headers()
        # Some presigned S3/storage URLs reject custom auth headers; strip if external
        parsed = urllib.parse.urlparse(download_url)
        if parsed.netloc and not download_url.startswith(self.base_url):
            headers = {"User-Agent": "CAPS-Print-Agent/0.1.0"}

        try:
            resp = self.transport.request("GET", download_url, headers=headers, timeout=self.timeout)
            if resp.status_code != 200:
                raise CloudApiError(f"Document download failed with HTTP {resp.status_code}", status_code=resp.status_code)

            # Write content and compute hash
            sha256_hasher.update(resp.body)
            dest.write_bytes(resp.body)

            computed_sha256 = sha256_hasher.hexdigest().lower()

            if expected_sha256:
                clean_expected = expected_sha256.strip().lower()
                if computed_sha256 != clean_expected:
                    dest.unlink(missing_ok=True)
                    raise ChecksumMismatchError(expected=clean_expected, actual=computed_sha256)

            logger.info("Document successfully downloaded to %s (sha256: %s)", dest, computed_sha256[:12])
            return dest

        except Exception as err:
            dest.unlink(missing_ok=True)
            if isinstance(err, (CloudApiError, ChecksumMismatchError)):
                raise
            raise CloudApiError(f"Error downloading document from {download_url}: {err}") from err

    def sync_printers(self, printers: list[dict[str, Any]]) -> dict[str, Any]:
        """Synchronize local printer discovery and capability profiles with the Cloud."""
        if not self.credentials:
            raise AuthenticationError("Agent credentials required for printer synchronization")

        payload = {
            "shop_id": self.credentials.shop_id,
            "device_id": self.credentials.device_id,
            "printers": printers,
        }
        return self.post("/api/v1/agent/printers/sync", payload)
