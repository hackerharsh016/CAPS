"""Unit and contract tests for Desktop Print Agent's AgentApiClient.

Validates:
- Nested response parsing (response.json()["job"]) with strict JSON schema validation
- Status enum uppercase formatting and compliance with job-status-update-request.schema.json
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
from referencing import Registry, Resource

from api_client import AgentApiClient, JobClaim


def load_schema_validator(schema_name: str) -> jsonschema.Draft202012Validator:
    """Load JSON schema from packages/print-contracts/schema with referenced common definitions."""
    schema_dir = Path(__file__).resolve().parents[3] / "packages" / "print-contracts" / "schema"

    with open(schema_dir / "common.schema.json", encoding="utf-8") as f:
        common_schema = json.load(f)

    with open(schema_dir / schema_name, encoding="utf-8") as f:
        target_schema = json.load(f)

    res_common = Resource.from_contents(common_schema)
    registry = Registry().with_resource(
        "https://caps.internal/schemas/common.schema.json", res_common
    )
    registry = registry.with_resource("common.schema.json", res_common)

    return jsonschema.Draft202012Validator(target_schema, registry=registry)


class MockHttpTransport:
    """Deterministic in-memory HTTP transport."""

    def __init__(self) -> None:
        self.responses: list[dict[str, Any]] = []
        self.recorded_requests: list[dict[str, Any]] = []

    def queue_response(self, data: dict[str, Any]) -> None:
        self.responses.append(data)

    def __call__(
        self, method: str, url: str, headers: dict[str, str], payload: dict[str, Any] | None
    ) -> dict[str, Any]:
        self.recorded_requests.append(
            {
                "method": method,
                "url": url,
                "headers": headers,
                "body": payload,
            }
        )
        if self.responses:
            return self.responses.pop(0)
        return {"status": "ok"}


def test_claim_jobs_parses_nested_response() -> None:
    """Acceptance Criteria 1: test_claim_jobs_parses_nested_response passes with strict JSON schema validation."""
    claim_validator = load_schema_validator("job-claim-response.schema.json")

    transport = MockHttpTransport()
    client = AgentApiClient(
        base_url="https://cloud.caps.example.com",
        device_token="caps_agent_sec_testtoken123456789",
        device_id="aaaa1111-aaaa-1111-aaaa-111111111111",
        shop_id="22222222-2222-2222-2222-222222222222",
        transport=transport,
    )

    # Server response conforming strictly to job-claim-response.schema.json
    raw_claim_response = {
        "contract_version": "1.0.0",
        "claimed": True,
        "job": {
            "job_id": "11111111-1111-1111-1111-111111111111",
            "attempt_id": "attempt-001",
            "lease_token": "lease-token-16chars-minimum-valid",
            "lease_expires_at": "2026-10-21T23:00:00Z",
            "shop_id": "22222222-2222-2222-2222-222222222222",
            "printer_id": "printer-front-01",
            "download_url": "https://storage.example.com/documents/test.pdf",
            "checksum_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "content_type": "application/pdf",
            "file_size_bytes": 4096,
            "settings": {
                "paper_size": "a4",
                "color_mode": "bw",
                "duplex": "simplex",
                "orientation": "portrait",
                "copies": 2,
                "page_range": "all",
                "binding": "none",
            },
            "created_at": "2026-10-21T22:00:00Z",
        },
    }

    # Verify response payload against JSON schema
    claim_validator.validate(raw_claim_response)

    transport.queue_response(raw_claim_response)
    claim = client.claim_jobs(lease_duration_seconds=90)

    assert claim is not None
    assert isinstance(claim, JobClaim)
    assert claim.job_id == "11111111-1111-1111-1111-111111111111"
    assert claim.attempt_id == "attempt-001"
    assert claim.lease_token == "lease-token-16chars-minimum-valid"
    assert claim.download_url == "https://storage.example.com/documents/test.pdf"
    assert claim.printer_id == "printer-front-01"
    assert claim.settings["paper_size"] == "a4"
    assert claim.settings["copies"] == 2
    assert claim["lease_token"] == "lease-token-16chars-minimum-valid"
    assert client.last_lease_token == "lease-token-16chars-minimum-valid"


def test_claim_jobs_empty_when_no_job() -> None:
    """Verifies that an empty claim response (claimed: false, job: null) returns None."""
    claim_validator = load_schema_validator("job-claim-response.schema.json")

    empty_response = {
        "contract_version": "1.0.0",
        "claimed": False,
        "job": None,
    }
    claim_validator.validate(empty_response)

    transport = MockHttpTransport()
    transport.queue_response(empty_response)
    client = AgentApiClient(transport=transport)

    claim = client.claim_jobs()
    assert claim is None


def test_update_job_status_uppercase() -> None:
    """Acceptance Criteria 2: test_update_job_status_uppercase passes against schema validator."""
    status_validator = load_schema_validator("job-status-update-request.schema.json")

    transport = MockHttpTransport()
    client = AgentApiClient(
        base_url="https://cloud.caps.example.com",
        device_token="caps_agent_sec_testtoken123456789",
        transport=transport,
    )

    test_cases = [
        ("downloading", "DOWNLOADING", 0, 5, None),
        ("printing", "PRINTING", 2, 5, 42),
        ("completed", "COMPLETED", 5, 5, 42),
        ("failed", "FAILED", 1, 5, 42),
        ("CLAIMED", "CLAIMED", 0, 5, None),
    ]

    for input_status, expected_status, pages, total, spooler_id in test_cases:
        transport.recorded_requests.clear()
        transport.queue_response({"success": True})

        client.update_job_status(
            job_id="11111111-1111-1111-1111-111111111111",
            attempt_id="attempt-001",
            status=input_status,
            lease_token="lease-token-16chars-minimum-valid",
            pages_printed=pages,
            total_pages=total,
            spooler_job_id=spooler_id,
        )

        assert len(transport.recorded_requests) == 1
        req_body = transport.recorded_requests[0]["body"]

        # Validate that the payload satisfies the frozen JSON schema
        status_validator.validate(req_body)

        # Assert contract field requirements
        assert req_body["status"] == expected_status
        assert req_body["contract_version"] == "1.0.0"
        assert req_body["job_id"] == "11111111-1111-1111-1111-111111111111"
        assert req_body["attempt_id"] == "attempt-001"
        assert req_body["lease_token"] == "lease-token-16chars-minimum-valid"
        assert req_body["pages_printed"] == pages
        assert req_body["total_pages"] == total
        assert "timestamp" in req_body
        if spooler_id is not None:
            assert req_body["spooler_job_id"] == spooler_id
