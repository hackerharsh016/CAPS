import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';

describe('Cloud API — Health Endpoint', () => {
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
});
