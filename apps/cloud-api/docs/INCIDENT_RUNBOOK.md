# CAPS Cloud API — Incident Response & Telemetry Runbook

> **Service:** `@caps/cloud-api`  
> **Status:** Production Runbook Locked  
> **Target Audience:** Cloud Backend Engineers, On-Call Operators, Platform Operations

---

## 1. Observability, Distributed Tracing & Correlation

CAPS utilizes end-to-end distributed context propagation across all HTTP requests and background events:
- **`X-Request-ID`:** Uniquely identifies a single HTTP request lifecycle.
- **`X-Correlation-ID`:** Propagates across asynchronous queues, webhooks, and desktop print agent calls to correlate a complete customer order from quote to physical printing.
- **`job_id`:** The authoritative print job UUID.
- **`attempt_id`:** Unique lease attempt identifier when a desktop agent claims and spools a job.

### Inspecting Traces Without Leaking Sensitive Data
All traces and audit logs are stripped of PII, customer credentials, Bearer tokens, and binary PDF contents:
```bash
# Query distributed trace spans by correlation ID
curl -s http://localhost:4000/api/v1/telemetry/traces/<CORRELATION_ID> | jq .
```

---

## 2. Standard Operating Procedures (SOPs)

### SOP-01: High 5xx Server Error Rate (Alert: `HIGH_5XX_ERROR_RATE`)
- **Severity:** Critical  
- **Trigger:** Server-side unhandled exception or repeated 500 error responses.
- **Triage Steps:**
  1. Inspect active alerts:
     ```bash
     curl -s http://localhost:4000/api/v1/telemetry/alerts | jq .
     ```
  2. Query metrics endpoint for affected route and error counts:
     ```bash
     curl -s http://localhost:4000/api/v1/telemetry/metrics | jq '.data.http_errors_total'
     ```
  3. Extract `correlation_id` from the alert context and inspect the trace:
     ```bash
     curl -s http://localhost:4000/api/v1/telemetry/traces/<CORRELATION_ID> | jq .
     ```
  4. Check readiness probe for database or storage disconnections:
     ```bash
     curl -s http://localhost:4000/ready | jq .
     ```
  5. Restart the service container if memory leak or zombie process is detected.

---

### SOP-02: Print Agent Disconnection / Offline Alert (Alert: `PRINT_AGENT_OFFLINE`)
- **Severity:** Warning  
- **Trigger:** Registered desktop print agent has not sent a heartbeat for > 60 seconds.
- **Triage Steps:**
  1. Check registered agent telemetry:
     ```bash
     curl -s http://localhost:4000/api/v1/telemetry/metrics | jq '.data.active_agents_count'
     ```
  2. Verify shop PC status with the shop owner (check internet connection or power).
  3. Verify whether agent loopback binding (`127.0.0.1:7890`) or Windows service encountered an unhandled exception.
  4. Once agent restarts and submits `POST /api/v1/agents/heartbeat`, the offline alert auto-resolves.

---

### SOP-03: Printer Hardware Faults (Paper Jam, Out of Paper)
- **Severity:** Warning  
- **Trigger:** Agent heartbeat telemetry reports `paper_jam`, `out_of_paper`, or `error` in printer status list.
- **Triage Steps:**
  1. Check printer status reported in agent telemetry.
  2. Active jobs on that printer automatically remain in or transition to `requires_review`.
  3. Notify shop owner via dashboard banner to physically inspect the printer hardware.

---

### SOP-04: Document Storage Cleanup & Privacy Lifecycle
- **Severity:** High  
- **Trigger:** Storage object remains unpurged after 24 hours.
- **Triage Steps:**
  1. ADR 0007 dictates strict 24-hour transient document retention.
  2. Invoke manual cleanup job to purge expired objects:
     ```bash
     # Inspect document status
     curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:4000/api/v1/documents/<DOC_ID>
     ```
  3. Confirm underlying storage object deletion via storage API.

---

## 3. Synthetic Alert Simulation for Incident Drills
To test alerting pipelines, telemetry dashboards, or on-call paging during incident drills:
```bash
curl -X POST http://localhost:4000/api/v1/telemetry/alerts/simulate \
  -H "Content-Type: application/json" \
  -d '{"rule_name": "HIGH_5XX_ERROR_RATE", "context": {"simulation": true}}'
```
