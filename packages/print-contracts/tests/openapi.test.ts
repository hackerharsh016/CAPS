import { describe, expect, it } from 'vitest';
import { openApiV1 } from '../src/index.js';

describe('OpenAPI v1 Specification', () => {
  it('defines valid OpenAPI 3.1 metadata', () => {
    expect(openApiV1.openapi).toBe('3.1.0');
    expect(openApiV1.info).toBeDefined();
    expect((openApiV1.info as Record<string, unknown>).title).toBe('CAPS Desktop Agent API');
    expect((openApiV1.info as Record<string, unknown>).version).toBe('1.0.0');
  });

  it('declares the three core desktop agent endpoints', () => {
    const paths = openApiV1.paths as Record<string, unknown>;
    expect(paths).toBeDefined();
    expect(paths['/agent/heartbeat']).toBeDefined();
    expect(paths['/agent/jobs/claim']).toBeDefined();
    expect(paths['/agent/jobs/{job_id}/status']).toBeDefined();
  });

  it('enforces AgentBearerAuth security requirement', () => {
    const security = openApiV1.security as Array<Record<string, unknown>>;
    expect(security).toEqual([{ AgentBearerAuth: [] }]);

    const components = openApiV1.components as Record<string, Record<string, unknown>>;
    expect(components.securitySchemes?.AgentBearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'CAPS-Agent-Token'
    });
  });

  it('requires Idempotency-Key header for status updates', () => {
    const paths = openApiV1.paths as Record<string, Record<string, unknown>>;
    const statusPost = paths['/agent/jobs/{job_id}/status']?.post as Record<string, unknown>;
    expect(statusPost).toBeDefined();

    const parameters = statusPost.parameters as Array<Record<string, unknown>>;
    const idempotencyParam = parameters.find(p => p.name === 'Idempotency-Key');
    expect(idempotencyParam).toBeDefined();
    expect(idempotencyParam?.in).toBe('header');
    expect(idempotencyParam?.required).toBe(true);
  });

  it('defines the canonical ErrorCode enum in components', () => {
    const components = openApiV1.components as Record<string, Record<string, unknown>>;
    const errorCodeSchema = components.schemas?.ErrorCode as Record<string, unknown>;
    expect(errorCodeSchema).toBeDefined();
    expect(errorCodeSchema.enum).toContain('LEASE_EXPIRED');
    expect(errorCodeSchema.enum).toContain('JOB_ALREADY_CLAIMED');
    expect(errorCodeSchema.enum).toContain('CAPABILITIES_MISMATCH');
    expect(errorCodeSchema.enum).toContain('PRINTER_OFFLINE');
    expect(errorCodeSchema.enum).toContain('UNKNOWN_OUTCOME');
  });
});
