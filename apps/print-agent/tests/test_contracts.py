"""
Contract conformance tests for the Python print agent.
Validates shared JSON Schemas and fixtures from packages/print-contracts/
using the Python jsonschema validator.
"""

import json
import unittest
from pathlib import Path

import jsonschema
from referencing import Registry, Resource

# Locate the packages/print-contracts directory relative to repo root
REPO_ROOT = Path(__file__).resolve().parents[2].parent
CONTRACTS_DIR = REPO_ROOT / "packages" / "print-contracts"

SCHEMA_DIR = CONTRACTS_DIR / "schema"
EXAMPLES_DIR = CONTRACTS_DIR / "examples"


def load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class TestPrintContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.common_schema = load_json(SCHEMA_DIR / "common.schema.json")
        cls.capabilities_schema = load_json(SCHEMA_DIR / "capabilities.schema.json")
        cls.claim_request_schema = load_json(SCHEMA_DIR / "job-claim-request.schema.json")
        cls.claim_response_schema = load_json(SCHEMA_DIR / "job-claim-response.schema.json")
        cls.status_request_schema = load_json(SCHEMA_DIR / "job-status-update-request.schema.json")
        cls.status_response_schema = load_json(
            SCHEMA_DIR / "job-status-update-response.schema.json"
        )
        cls.error_response_schema = load_json(SCHEMA_DIR / "error-response.schema.json")

        # Set up registry with common.schema.json
        common_resource = Resource.from_contents(cls.common_schema)
        cls.registry = Registry().with_resources(
            [
                ("common.schema.json", common_resource),
                ("https://caps.internal/schemas/common.schema.json", common_resource),
            ]
        )

    def _validate(self, schema: dict, instance: dict):
        validator = jsonschema.Draft202012Validator(schema, registry=self.registry)
        validator.validate(instance)

    # 1. Canonical Examples
    def test_canonical_capabilities_valid(self):
        instance = load_json(EXAMPLES_DIR / "capabilities.json")
        self._validate(self.capabilities_schema, instance)

    def test_canonical_claim_request_valid(self):
        instance = load_json(EXAMPLES_DIR / "job-claim-request.json")
        self._validate(self.claim_request_schema, instance)

    def test_canonical_claim_response_valid(self):
        instance = load_json(EXAMPLES_DIR / "job-claim-response.json")
        self._validate(self.claim_response_schema, instance)

    def test_canonical_status_update_request_valid(self):
        instance = load_json(EXAMPLES_DIR / "job-status-update-request.json")
        self._validate(self.status_request_schema, instance)

    def test_canonical_status_update_response_valid(self):
        instance = load_json(EXAMPLES_DIR / "job-status-update-response.json")
        self._validate(self.status_response_schema, instance)

    def test_canonical_error_response_valid(self):
        instance = load_json(EXAMPLES_DIR / "error-response.json")
        self._validate(self.error_response_schema, instance)

    # 2. Backwards Compatibility Fixtures (v1.0.0)
    def test_fixture_v1_valid_claim_request(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-claim-request.json")
        self._validate(self.claim_request_schema, instance)

    def test_fixture_v1_valid_claim_response(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-claim-response.json")
        self._validate(self.claim_response_schema, instance)

    def test_fixture_v1_valid_claim_response_empty(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-claim-response-empty.json"
        )
        self._validate(self.claim_response_schema, instance)

    def test_fixture_v1_valid_status_update_completed(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-status-update-completed.json"
        )
        self._validate(self.status_request_schema, instance)

    def test_fixture_v1_valid_status_update_failed(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-status-update-failed.json"
        )
        self._validate(self.status_request_schema, instance)

    def test_fixture_v1_valid_capabilities(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-capabilities.json")
        self._validate(self.capabilities_schema, instance)

    def test_fixture_v1_valid_error(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "v1.0.0" / "valid-error.json")
        self._validate(self.error_response_schema, instance)

    # 3. Validation Rejection on Invalid Fixtures
    def test_invalid_claim_request_missing_shop(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "invalid" / "claim-request-missing-shop.json"
        )
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.claim_request_schema, instance)

    def test_invalid_claim_response_bad_checksum(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "invalid" / "claim-response-bad-checksum.json"
        )
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.claim_response_schema, instance)

    def test_invalid_status_update_unknown_status(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "invalid" / "status-update-invalid-status.json"
        )
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.status_request_schema, instance)

    def test_invalid_status_update_negative_pages(self):
        instance = load_json(
            EXAMPLES_DIR / "fixtures" / "invalid" / "status-update-negative-pages.json"
        )
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.status_request_schema, instance)

    def test_invalid_settings_zero_copies(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "invalid" / "settings-copies-zero.json")
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.claim_response_schema, instance)

    def test_invalid_settings_copies_exceeded(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "invalid" / "settings-copies-101.json")
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.claim_response_schema, instance)

    def test_invalid_error_missing_code(self):
        instance = load_json(EXAMPLES_DIR / "fixtures" / "invalid" / "error-missing-code.json")
        with self.assertRaises(jsonschema.ValidationError):
            self._validate(self.error_response_schema, instance)

    # 4. Agent PrintSettings Python Dataclass Alignment
    def test_python_agent_print_settings_aligns_with_schema(self):
        from caps_agent.printing.engine import PrintSettings

        agent_settings = PrintSettings(
            paper_size="a4",
            color_mode="bw",
            duplex="duplex_long",
            copies=2,
            page_range="1-5",
            orientation="portrait",
        )

        # Convert to dictionary matching contract settings (including default binding)
        contract_dict = {
            "paper_size": agent_settings.paper_size,
            "color_mode": agent_settings.color_mode,
            "duplex": agent_settings.duplex,
            "copies": agent_settings.copies,
            "page_range": agent_settings.page_range,
            "orientation": agent_settings.orientation,
            "binding": "none",
        }

        # Validate against common.schema.json PrintSettings definition
        settings_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$ref": "common.schema.json#/$defs/PrintSettings",
        }
        self._validate(settings_schema, contract_dict)


if __name__ == "__main__":
    unittest.main()
