import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';

describe('Cloud API — Health & Readiness Endpoints', () => {
  const env = validateEnv({ NODE_ENV: 'test', PORT: '4000', HOST: '127.0.0.1' });
  const app = buildApp({ env });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with ok status and uptime metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('caps-cloud-api');
    expect(body.version).toBe('0.1.0');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /ready returns 200 with checks passing in healthy state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/ready'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.memory).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /ready returns 503 Service Unavailable when dependency check fails', async () => {
    const degradedApp = buildApp({
      env,
      readinessChecks: [
        () => ({
          name: 'database',
          ok: false,
          message: 'Connection pool exhausted'
        }),
        () => ({
          name: 'memory',
          ok: true
        })
      ]
    });

    const response = await degradedApp.inject({
      method: 'GET',
      url: '/ready'
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('unhealthy');
    expect(body.checks.database).toBe('error');
    expect(body.checks.memory).toBe('ok');
    expect(body.errors).toContain('database: Connection pool exhausted');

    await degradedApp.close();
  });
});
