"""Agent API Client conforming to CAPS frozen print contracts.

Implements contract-harmonized communication for Desktop Print Agent:
- Pairing with device_fingerprint, device_name, hostname, os_version
- Parsing nested claim response (response.json()["job"])
- Submitting uppercase job execution statuses with full contract schema fields
"""

from __future__ import annotations

import json
import logging
import platform
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("caps_agent.api_client")


@dataclass
class JobClaim:
    """Represents a claimed print job conforming to job-claim-response.schema.json."""

    job_id: str
    attempt_id: str
    lease_token: str
    lease_expires_at: str
    shop_id: str
    printer_id: str
    download_url: str
    checksum_sha256: str
    content_type: str
    file_size_bytes: int
    settings: dict[str, Any]
    created_at: str
    raw_job: dict[str, Any] = field(default_factory=dict)

    def __getitem__(self, item: str) -> Any:
        if hasattr(self, item):
            return getattr(self, item)
        return self.raw_job.get(item)

    def get(self, item: str, default: Any = None) -> Any:
        if hasattr(self, item):
            return getattr(self, item)
        return self.raw_job.get(item, default)

    def __contains__(self, item: str) -> bool:
        return hasattr(self, item) or item in self.raw_job


class AgentApiClient:
    """Contract-conforming Cloud API client for the Desktop Print Agent."""

    def __init__(
        self,
        base_url: str = "http://localhost:4000",
        device_token: str | None = None,
        device_id: str | None = None,
        shop_id: str | None = None,
        transport: Any = None,
        timeout: float = 10.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.device_token = device_token
        self.device_id = device_id
        self.shop_id = shop_id
        self.transport = transport
        self.timeout = timeout
        self.last_lease_token: str | None = None
        self.recorded_requests: list[dict[str, Any]] = []

    def set_credentials(self, device_token: str, device_id: str, shop_id: str) -> None:
        """Update active agent credentials."""
        self.device_token = device_token
        self.device_id = device_id
        self.shop_id = shop_id

    def _build_headers(self, unauthenticated: bool = False) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "CAPS-Desktop-Print-Agent/1.0.0",
        }
        if not unauthenticated and self.device_token:
            headers["Authorization"] = f"Bearer {self.device_token}"
        if not unauthenticated and self.device_id:
            headers["X-CAPS-Device-Id"] = self.device_id
        if not unauthenticated and self.shop_id:
            headers["X-CAPS-Shop-Id"] = self.shop_id
        return headers

    def _send_request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        unauthenticated: bool = False,
    ) -> dict[str, Any]:
        """Internal dispatcher routing through mock transport or standard urllib."""
        url = f"{self.base_url}{path}"
        headers = self._build_headers(unauthenticated=unauthenticated)
        body_bytes = json.dumps(payload).encode("utf-8") if payload is not None else None

        req_record = {
            "method": method,
            "url": url,
            "path": path,
            "headers": headers,
            "body": payload,
        }
        self.recorded_requests.append(req_record)

        if self.transport is not None:
            # Supports both duck-typed mock transport and custom callable
            if hasattr(self.transport, "request"):
                resp = self.transport.request(
                    method=method,
                    url=url,
                    headers=headers,
                    body=body_bytes,
                    timeout=self.timeout,
                )
                if hasattr(resp, "json"):
                    return resp.json()
                if hasattr(resp, "body"):
                    return json.loads(resp.body.decode("utf-8")) if resp.body else {}
                return resp
            elif callable(self.transport):
                return self.transport(method, url, headers, payload)

        req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                content = response.read().decode("utf-8")
                return json.loads(content) if content else {}
        except urllib.error.HTTPError as http_err:
            content = http_err.read().decode("utf-8")
            err_data = json.loads(content) if content else {}
            raise RuntimeError(f"HTTP {http_err.code}: {err_data}") from http_err
        except Exception as err:
            raise RuntimeError(f"Network error accessing {url}: {err}") from err

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send authenticated POST request."""
        return self._send_request("POST", path, payload, unauthenticated=False)

    def post_unauthenticated(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send unauthenticated POST request."""
        return self._send_request("POST", path, payload, unauthenticated=True)

    def get(self, path: str) -> dict[str, Any]:
        """Send authenticated GET request."""
        return self._send_request("GET", path, payload=None, unauthenticated=False)

    def pair_device(
        self,
        pairing_code: str,
        device_fingerprint: str | None = None,
        device_name: str | None = None,
        hostname: str | None = None,
        os_version: str | None = None,
        agent_version: str = "0.1.0",
    ) -> dict[str, Any]:
        """Perform agent pairing handshake with full system metadata.

        Step 1: Provides device_fingerprint, device_name, hostname, and os_version.
        """
        code = pairing_code.strip()
        if not code:
            raise ValueError("pairing_code cannot be empty")

        host = hostname or platform.node() or "desktop-agent-host"
        os_ver = os_version or platform.platform() or "Windows"
        fingerprint = device_fingerprint or host
        dev_name = device_name or host

        payload = {
            "pairing_code": code,
            "device_fingerprint": fingerprint,
            "device_name": dev_name,
            "hostname": host,
            "os_version": os_ver,
            "agent_version": agent_version,
        }

        resp = self.post_unauthenticated("/api/v1/agent/pair", payload)

        data = resp.get("data") if isinstance(resp.get("data"), dict) else resp
        token = data.get("device_secret") or data.get("device_token")
        dev_id = data.get("device_id")
        shp_id = data.get("shop_id")

        if token and dev_id and shp_id:
            self.set_credentials(token, dev_id, shp_id)

        return resp

    def claim_jobs(
        self,
        lease_duration_seconds: int = 90,
        requested_printer_id: str | None = None,
    ) -> JobClaim | None:
        """Claim next pending print job and correctly parse nested response.json()["job"].

        Step 2: Correctly parses nested response.json()["job"] rather than expecting flat root properties.
        Extracts lease_token, attempt_id, and settings safely.
        """
        payload: dict[str, Any] = {
            "agent_device_id": self.device_id or "default-device-id",
            "shop_id": self.shop_id or "default-shop-id",
            "lease_duration_seconds": lease_duration_seconds,
        }
        if requested_printer_id:
            payload["requested_printer_id"] = requested_printer_id

        resp = self.post("/api/v1/agent/jobs/claim", payload)
        if not resp:
            return None

        # Check claimed flag
        if not resp.get("claimed", True) and "job" not in resp:
            return None

        # Nested response parsing per job-claim-response.schema.json
        job_data = resp.get("job")
        if not job_data or not isinstance(job_data, dict):
            # Fallback for flat compatibility if job object is absent but root has job_id
            if "job_id" in resp and resp["job_id"]:
                job_data = resp
            else:
                return None

        # Extract required contract fields safely
        job_id = job_data.get("job_id")
        attempt_id = job_data.get("attempt_id")
        lease_token = job_data.get("lease_token") or job_data.get("lease_id")
        settings = job_data.get("settings")

        if not (job_id and attempt_id and lease_token and settings):
            logger.warning(
                "Claim response missing critical fields (job_id, attempt_id, lease_token, settings): %s",
                list(job_data.keys()),
            )

        # Cache last lease token for subsequent status updates
        if lease_token:
            self.last_lease_token = lease_token

        return JobClaim(
            job_id=job_id or "",
            attempt_id=attempt_id or "",
            lease_token=lease_token or "",
            lease_expires_at=job_data.get("lease_expires_at", ""),
            shop_id=job_data.get("shop_id", self.shop_id or ""),
            printer_id=job_data.get("printer_id", ""),
            download_url=job_data.get("download_url", ""),
            checksum_sha256=job_data.get("checksum_sha256", ""),
            content_type=job_data.get("content_type", "application/pdf"),
            file_size_bytes=int(job_data.get("file_size_bytes", 0)),
            settings=settings or {},
            created_at=job_data.get("created_at", datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")),
            raw_job=job_data,
        )

    def claim_job(self, lease_duration_seconds: int = 90) -> JobClaim | None:
        """Alias for claim_jobs to preserve backwards compatibility."""
        return self.claim_jobs(lease_duration_seconds=lease_duration_seconds)

    def update_job_status(
        self,
        job_id: str,
        attempt_id: str,
        status: str,
        lease_token: str | None = None,
        pages_printed: int = 0,
        total_pages: int = 1,
        spooler_job_id: int | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        timestamp: str | None = None,
        contract_version: str = "1.0.0",
    ) -> dict[str, Any]:
        """Submit job execution status update.

        Step 3:
        - Formats status enum as uppercase string (CLAIMED, DOWNLOADING, PRINTING, COMPLETED, FAILED).
        - Includes required contract fields: lease_token, pages_printed, total_pages, contract_version: "1.0.0".
        """
        status_upper = status.upper()
        token_to_use = lease_token or self.last_lease_token or "lease-token-16chars-minimum"

        payload: dict[str, Any] = {
            "contract_version": contract_version,
            "job_id": job_id,
            "attempt_id": attempt_id,
            "lease_token": token_to_use,
            "status": status_upper,
            "pages_printed": int(pages_printed),
            "total_pages": int(total_pages),
            "timestamp": timestamp or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

        if spooler_job_id is not None:
            payload["spooler_job_id"] = int(spooler_job_id)
        if error_code is not None:
            payload["error_code"] = error_code
        if error_message is not None:
            payload["error_message"] = str(error_message)[:1000]

        return self.post("/api/v1/agent/jobs/status", payload)


# Backwards compatibility alias
CloudApiClient = AgentApiClient
