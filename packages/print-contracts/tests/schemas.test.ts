import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateContract, validators } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXAMPLES_DIR = path.resolve(__dirname, '../examples');

function readJson<T = unknown>(relativePath: string): T {
  const filePath = path.resolve(EXAMPLES_DIR, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

describe('JSON Schema Validation — Canonical Examples', () => {
  it('validates capabilities.json', () => {
    const payload = readJson('capabilities.json');
    const result = validateContract(validators.validateCapabilities, payload);
    expect(result.success).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('validates job-claim-request.json', () => {
    const payload = readJson('job-claim-request.json');
    const result = validateContract(validators.validateJobClaimRequest, payload);
    expect(result.success).toBe(true);
  });

  it('validates job-claim-response.json', () => {
    const payload = readJson('job-claim-response.json');
    const result = validateContract(validators.validateJobClaimResponse, payload);
    expect(result.success).toBe(true);
  });

  it('validates job-status-update-request.json', () => {
    const payload = readJson('job-status-update-request.json');
    const result = validateContract(validators.validateJobStatusUpdateRequest, payload);
    expect(result.success).toBe(true);
  });

  it('validates job-status-update-response.json', () => {
    const payload = readJson('job-status-update-response.json');
    const result = validateContract(validators.validateJobStatusUpdateResponse, payload);
    expect(result.success).toBe(true);
  });

  it('validates error-response.json', () => {
    const payload = readJson('error-response.json');
    const result = validateContract(validators.validateErrorResponse, payload);
    expect(result.success).toBe(true);
  });
});

describe('JSON Schema Validation — Backwards Compatibility (v1.0.0 Fixtures)', () => {
  it('validates fixtures/v1.0.0/valid-claim-request.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-claim-request.json');
    const result = validateContract(validators.validateJobClaimRequest, payload);
    expect(result.success).toBe(true);
  });

  it('validates fixtures/v1.0.0/valid-claim-response.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-claim-response.json');
    const result = validateContract(validators.validateJobClaimResponse, payload);
    expect(result.success).toBe(true);
  });

  it('validates fixtures/v1.0.0/valid-claim-response-empty.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-claim-response-empty.json');
    const result = validateContract(validators.validateJobClaimResponse, payload);
    expect(result.success).toBe(true);
  });

  it('validates fixtures/v1.0.0/valid-status-update-completed.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-status-update-completed.json');
    const result = validateContract(validators.validateJobStatusUpdateRequest, payload);
    expect(result.success).toBe(true);
  });

  it('validates fixtures/v1.0.0/valid-status-update-failed.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-status-update-failed.json');
    const result = validateContract(validators.validateJobStatusUpdateRequest, payload);
    expect(result.success).toBe(true);
  });

  it('validates fixtures/v1.0.0/valid-capabilities.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-capabilities.json');
    const result = validateContract(validators.validateCapabilities, payload);
    expect(result.success).toBe(true);
  });

  it('validates fixtures/v1.0.0/valid-error.json', () => {
    const payload = readJson('fixtures/v1.0.0/valid-error.json');
    const result = validateContract(validators.validateErrorResponse, payload);
    expect(result.success).toBe(true);
  });
});

describe('JSON Schema Validation — Rejection of Invalid Payloads', () => {
  it('rejects claim request missing required shop_id', () => {
    const payload = readJson('fixtures/invalid/claim-request-missing-shop.json');
    const result = validateContract(validators.validateJobClaimRequest, payload);
    expect(result.success).toBe(false);
    expect(result.errors?.some(e => e.includes("must have required property 'shop_id'"))).toBe(
      true
    );
  });

  it('rejects claim response with non-hex / invalid sha256 checksum', () => {
    const payload = readJson('fixtures/invalid/claim-response-bad-checksum.json');
    const result = validateContract(validators.validateJobClaimResponse, payload);
    expect(result.success).toBe(false);
  });

  it('rejects status update with non-whitelisted status enum', () => {
    const payload = readJson('fixtures/invalid/status-update-invalid-status.json');
    const result = validateContract(validators.validateJobStatusUpdateRequest, payload);
    expect(result.success).toBe(false);
  });

  it('rejects status update with negative pages_printed count', () => {
    const payload = readJson('fixtures/invalid/status-update-negative-pages.json');
    const result = validateContract(validators.validateJobStatusUpdateRequest, payload);
    expect(result.success).toBe(false);
  });

  it('rejects print settings with 0 copies (minimum is 1)', () => {
    const payload = readJson('fixtures/invalid/settings-copies-zero.json');
    const result = validateContract(validators.validateJobClaimResponse, payload);
    expect(result.success).toBe(false);
  });

  it('rejects print settings with 101 copies (maximum is 100)', () => {
    const payload = readJson('fixtures/invalid/settings-copies-101.json');
    const result = validateContract(validators.validateJobClaimResponse, payload);
    expect(result.success).toBe(false);
  });

  it('rejects error response missing required code property', () => {
    const payload = readJson('fixtures/invalid/error-missing-code.json');
    const result = validateContract(validators.validateErrorResponse, payload);
    expect(result.success).toBe(false);
    expect(result.errors?.some(e => e.includes("must have required property 'code'"))).toBe(true);
  });

  it('rejects unauthorized additional properties on claim request (strict boundary)', () => {
    const payload = {
      ...readJson('job-claim-request.json'),
      unauthorized_injection: 'malicious_override'
    };
    const result = validateContract(validators.validateJobClaimRequest, payload);
    expect(result.success).toBe(false);
    expect(result.errors?.some(e => e.includes('must NOT have additional properties'))).toBe(true);
  });
});
