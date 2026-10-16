# `@caps/print-contracts`

Language-neutral contracts (OpenAPI 3.1 and JSON Schema Draft 2020-12) defining communication between the CAPS Cloud API and Windows Desktop Print Agent.

---

## 1. Directory Structure

```
packages/print-contracts/
├── openapi/
│   └── v1.json                          # Complete OpenAPI 3.1.0 document
├── schema/
│   ├── common.schema.json               # Reusable definitions (UUID, SemVer, Settings, ErrorCode)
│   ├── capabilities.schema.json         # Agent heartbeat and hardware printer capabilities
│   ├── job-claim-request.schema.json    # Agent atomic job claim request
│   ├── job-claim-response.schema.json   # Cloud API claim response with signed lease & token
│   ├── job-status-update-request.schema.json  # Agent progress and completion reporting
│   ├── job-status-update-response.schema.json # Cloud API status acknowledgment
│   └── error-response.schema.json       # Standardized API error payload
├── examples/
│   ├── capabilities.json                # Canonical capabilities payload
│   ├── job-claim-request.json           # Canonical claim request payload
│   ├── job-claim-response.json          # Canonical claim response with download grant
│   ├── job-status-update-request.json   # Canonical status update payload
│   ├── job-status-update-response.json  # Canonical status response payload
│   ├── error-response.json              # Canonical error payload
│   └── fixtures/
│       ├── v1.0.0/                      # Backwards compatibility test fixtures
│       └── invalid/                     # Negative validation rejection test cases
├── src/
│   └── index.ts                         # TypeScript AJV validators & schema loaders
└── tests/
    ├── openapi.test.ts                  # OpenAPI structural and endpoint tests
    └── schemas.test.ts                  # JSON Schema validation & fixture tests
```

---

## 2. API Endpoints (OpenAPI v1)

| Endpoint | Method | Operation | Headers | Description |
|---|---|---|---|---|
| `/api/v1/agent/heartbeat` | `POST` | `reportHeartbeat` | `Authorization: Bearer <token>` | Reports agent heartbeat, status, and attached printer capabilities. |
| `/api/v1/agent/jobs/claim` | `POST` | `claimJob` | `Authorization: Bearer <token>` | Atomically claims next authorized job for shop; returns short-lived signed URL. |
| `/api/v1/agent/jobs/{job_id}/status` | `POST` | `updateJobStatus` | `Authorization: Bearer <token>`, `Idempotency-Key: <uuid>` | Idempotently reports attempt progress, physical page counts, or failure reasons. |

---

## 3. Version Compatibility Policy

1. **Semantic Versioning (`contract_version`):**
   - All agent requests and cloud responses must declare `contract_version` (e.g. `"1.0.0"`).
   - **Patch releases (`1.0.x`)**: Non-breaking documentation or schema commentary updates.
   - **Minor releases (`1.x.0`)**: Backward-compatible additive changes (e.g. optional metadata, new finishing options). Supported by existing agents without mandatory upgrades.
   - **Major releases (`x.0.0`)**: Breaking schema or protocol changes. Cloud API supports multiple major contract versions simultaneously to ensure backwards compatibility with deployed shop agents.

2. **Agent Compatibility Lifecycle:**
   - The Cloud API retains support for previously deployed minor versions of the current major contract.
   - Deprecated contract versions trigger telemetry warnings with a defined retirement notice window.

---

## 4. Error Taxonomy & Status Codes

All API errors adhere to a standardized envelope:
```json
{
  "error": {
    "code": "LEASE_EXPIRED",
    "message": "The atomic execution lease for this job has expired.",
    "request_id": "req-98765-abcd-1234",
    "details": {
      "job_id": "22222222-2222-4222-8222-222222222222"
    }
  }
}
```

| Error Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Invalid or missing Agent Bearer device token. |
| `FORBIDDEN` | 403 | Agent does not possess authorization for the requested shop. |
| `NOT_FOUND` | 404 | Job ID or printer ID does not exist. |
| `LEASE_EXPIRED` | 409 | Atomic claim lease expired before attempt completion. |
| `JOB_ALREADY_CLAIMED` | 409 | Job has already been claimed by another active agent lease. |
| `CAPABILITIES_MISMATCH` | 422 | Target printer cannot satisfy requested settings (e.g. color on B&W printer). |
| `INVALID_PAYLOAD` | 400 | Payload fails JSON Schema validation. |
| `IDEMPOTENCY_CONFLICT` | 409 | Request with identical `Idempotency-Key` was submitted with differing payload. |
| `PRINTER_OFFLINE` | 422 / 503 | Hardware printer is powered off or disconnected. |
| `PAPER_JAM` | 422 / 500 | Physical media jam detected by spooler driver. |
| `SPOOLER_ERROR` | 500 | Windows print spooler rejected the job submission. |
| `DOWNLOAD_FAILED` | 500 | Agent failed to retrieve document from signed download URL. |
| `CHECKSUM_MISMATCH` | 422 | Downloaded file SHA-256 hash does not match server manifest. |
| `UNKNOWN_OUTCOME` | 500 | Spooler status could not be verified; auto-reprint is forbidden. |
| `INTERNAL_ERROR` | 500 | Unexpected server exception. |

---

## 5. Security & Execution Invariants

1. **Wake-up vs Claiming:** Realtime WebSocket events are wake-up signals only. An agent MUST claim a job via authenticated HTTP POST with lease negotiation before accessing files or spooling.
2. **Lease Isolation:** A job claim grants a temporary atomic lease token. Status updates must supply this lease token and stable attempt ID.
3. **Physical vs Spooler Completion:** A Windows spooler job ID confirms spooling submission only, NOT paper ejection. Status transitions distinguish `PRINTING` from physical `COMPLETED`.
4. **Unknown Outcome Protection:** In case of an unknown outcome (power loss, spooler crash), the agent and server MUST NOT trigger automated reprint without manual shop owner review.
