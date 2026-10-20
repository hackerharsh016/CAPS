import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { createTestJwt, SupabaseJwtVerifier, MockTokenVerifier } from '../src/plugins/auth.js';
import { redactSensitiveData, redactHeaders } from '../src/plugins/logger.js';

describe('Cloud API — Fastify Core, Auth Middleware, Rate Limiting & Error Taxonomy', () => {
  const testSecret = 'super-secret-jwt-signing-key-for-testing-at-least-32-chars';
  const env = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
    SUPABASE_JWT_SECRET: testSecret,
    RATE_LIMIT_MAX: '100',
    RATE_LIMIT_WINDOW_MS: '10000'
  });

  const app = buildApp({
    env,
    tokenVerifier: new SupabaseJwtVerifier(testSecret),
    rateLimitOptions: {
      max: 100,
      windowMs: 10000
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication Middleware (fastify.authenticate)', () => {
    it('denies access with 401 UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me'
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Missing Authorization header');
      expect(body.error.request_id).toBeDefined();
      expect(response.headers['x-request-id']).toBe(body.error.request_id);
    });

    it('denies access with 401 UNAUTHORIZED when Authorization header scheme is not Bearer', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Basic dXNlcjpwYXNz'
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Expected "Bearer <token>"');
    });

    it('denies access with 401 INVALID_TOKEN when JWT token is malformed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer not-a-valid-jwt-token'
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_TOKEN');
      expect(body.error.message).toContain('Malformed JWT');
    });

    it('denies access with 401 INVALID_TOKEN when JWT signature has been tampered with', async () => {
      const validToken = createTestJwt(
        { sub: '00000000-0000-0000-0000-000000000001', role: 'customer' },
        testSecret
      );
      const tamperedToken = `${validToken.slice(0, -6)}tamper`;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${tamperedToken}`
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_TOKEN');
      expect(body.error.message).toContain('Invalid JWT token signature');
    });

    it('denies access with 401 TOKEN_EXPIRED when JWT expiration is in the past', async () => {
      const expiredToken = createTestJwt(
        { sub: '00000000-0000-0000-0000-000000000001', role: 'customer' },
        testSecret,
        -100 // expired 100 seconds ago
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${expiredToken}`
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('TOKEN_EXPIRED');
      expect(body.error.message).toContain('expired');
    });

    it('successfully authenticates valid JWT and decorates request.user', async () => {
      const validToken = createTestJwt(
        {
          sub: '11111111-1111-1111-1111-111111111111',
          email: 'customer@caps.example.com',
          role: 'customer',
          app_metadata: { role: 'customer' }
        },
        testSecret,
        3600
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${validToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.user.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(body.data.user.role).toBe('customer');
      expect(body.data.user.email).toBe('customer@caps.example.com');
    });
  });

  describe('Role-Based Authorization (fastify.authorize)', () => {
    it('denies customer access to owner-only route with 403 FORBIDDEN_ROLE', async () => {
      const customerToken = createTestJwt(
        {
          sub: '22222222-2222-2222-2222-222222222222',
          app_metadata: { role: 'customer' }
        },
        testSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/owner-only',
        headers: {
          authorization: `Bearer ${customerToken}`
        }
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe('FORBIDDEN_ROLE');
      expect(body.error.message).toContain('customer');
      expect(body.error.request_id).toBeDefined();
    });

    it('grants shop_owner access to owner-only route with 200 OK', async () => {
      const ownerToken = createTestJwt(
        {
          sub: '33333333-3333-3333-3333-333333333333',
          app_metadata: { role: 'shop_owner', shop_id: 'shop-uuid-123' }
        },
        testSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/owner-only',
        headers: {
          authorization: `Bearer ${ownerToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.access).toBe('granted');
      expect(body.data.role).toBe('shop_owner');
    });

    it('denies customer access to agent-only route with 403 FORBIDDEN_ROLE', async () => {
      const customerToken = createTestJwt(
        {
          sub: '44444444-4444-4444-4444-444444444444',
          app_metadata: { role: 'customer' }
        },
        testSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/agent-only',
        headers: {
          authorization: `Bearer ${customerToken}`
        }
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe('FORBIDDEN_ROLE');
    });

    it('grants agent access to agent-only route with 200 OK', async () => {
      const agentToken = createTestJwt(
        {
          sub: '55555555-5555-5555-5555-555555555555',
          app_metadata: { role: 'agent' }
        },
        testSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/agent-only',
        headers: {
          authorization: `Bearer ${agentToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.access).toBe('granted');
      expect(body.data.role).toBe('agent');
    });

    it('grants admin universal access across role-protected routes', async () => {
      const adminToken = createTestJwt(
        {
          sub: '66666666-6666-6666-6666-666666666666',
          app_metadata: { role: 'admin' }
        },
        testSecret
      );

      const ownerRouteRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/owner-only',
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(ownerRouteRes.statusCode).toBe(200);

      const agentRouteRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/agent-only',
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(agentRouteRes.statusCode).toBe(200);
    });
  });

  describe('Rate Limiting (sliding window & headers)', () => {
    it('sets standard X-RateLimit-* headers on incoming requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me'
      });

      expect(Number(response.headers['x-ratelimit-limit'])).toBe(100);
      expect(typeof response.headers['x-ratelimit-remaining']).toBe('string');
      expect(typeof response.headers['x-ratelimit-reset']).toBe('string');
    });

    it('rejects with 429 RATE_LIMIT_EXCEEDED when request limit is exceeded', async () => {
      const rateLimitedApp = buildApp({
        env,
        rateLimitOptions: {
          max: 2,
          windowMs: 5000,
          keyGenerator: () => 'fixed-test-client'
        }
      });

      // Request 1: remaining 1
      const res1 = await rateLimitedApp.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res1.statusCode).toBe(401); // Auth failed, but rate limit counted
      expect(Number(res1.headers['x-ratelimit-remaining'])).toBe(1);

      // Request 2: remaining 0
      const res2 = await rateLimitedApp.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res2.statusCode).toBe(401);
      expect(Number(res2.headers['x-ratelimit-remaining'])).toBe(0);

      // Request 3: exceeded!
      const res3 = await rateLimitedApp.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res3.statusCode).toBe(429);
      expect(res3.headers['retry-after']).toBeDefined();
      const body = res3.json();
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.error.message).toContain('Limit of 2 requests');

      // Verify /health is bypassed from rate limiting
      const healthRes = await rateLimitedApp.inject({ method: 'GET', url: '/health' });
      expect(healthRes.statusCode).toBe(200);

      await rateLimitedApp.close();
    });
  });

  describe('Consistent Error Envelope (§5.4)', () => {
    it('returns consistent error JSON on 404 Not Found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/non-existent-endpoint'
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('GET:/api/v1/non-existent-endpoint not found');
      expect(typeof body.error.request_id).toBe('string');
      expect(response.headers['x-request-id']).toBe(body.error.request_id);
    });

    it('preserves client-supplied X-Request-ID across response and error envelope', async () => {
      const customRequestId = 'client-custom-req-12345';
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/unknown-path',
        headers: {
          'x-request-id': customRequestId
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['x-request-id']).toBe(customRequestId);
      const body = response.json();
      expect(body.error.request_id).toBe(customRequestId);
    });
  });

  describe('Structured Audit Logging & Sensitive Data Redaction', () => {
    it('redacts passwords, tokens, secrets, and raw document payloads', () => {
      const rawPayload = {
        user_id: 'usr-123',
        password: 'PlainTextPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        api_key: 'rzp_live_secretkey',
        pdf_content: 'JVBERi0xLjQKJ...',
        file_bytes: '010101010101',
        raw_document: '<binary>',
        metadata: {
          nested_secret: 'nested-val',
          public_notes: 'Print 2 copies duplex'
        }
      };

      const sanitized = redactSensitiveData(rawPayload) as typeof rawPayload;
      expect(sanitized.user_id).toBe('usr-123');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.api_key).toBe('[REDACTED]');
      expect(sanitized.pdf_content).toBe('[REDACTED]');
      expect(sanitized.file_bytes).toBe('[REDACTED]');
      expect(sanitized.raw_document).toBe('[REDACTED]');
      expect(sanitized.metadata.nested_secret).toBe('[REDACTED]');
      expect(sanitized.metadata.public_notes).toBe('Print 2 copies duplex');
    });

    it('redacts sensitive HTTP headers including Authorization and API keys', () => {
      const headers = {
        authorization: 'Bearer secret_token',
        cookie: 'session_id=abc123xyz',
        'x-api-key': 'secret-api-key',
        'x-razorpay-signature': 'sig-xyz',
        'content-type': 'application/json',
        'x-request-id': 'req-123'
      };

      const sanitized = redactHeaders(headers);
      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['cookie']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['x-razorpay-signature']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized['x-request-id']).toBe('req-123');
    });
  });

  describe('MockTokenVerifier Integration', () => {
    it('supports offline mock tokens with configurable roles', async () => {
      const mockVerifier = new MockTokenVerifier();
      mockVerifier.registerUser('mock-customer-token', {
        id: 'cust-mock-uuid',
        role: 'customer',
        email: 'mock-cust@test.local'
      });
      mockVerifier.registerExpiredToken('mock-expired-token');

      const mockApp = buildApp({
        env,
        tokenVerifier: mockVerifier
      });

      // 1. Valid mock customer
      const resValid = await mockApp.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer mock-customer-token' }
      });
      expect(resValid.statusCode).toBe(200);
      expect(resValid.json().data.user.id).toBe('cust-mock-uuid');

      // 2. Expired mock token
      const resExpired = await mockApp.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer mock-expired-token' }
      });
      expect(resExpired.statusCode).toBe(401);
      expect(resExpired.json().error.code).toBe('TOKEN_EXPIRED');

      // 3. Unknown mock token
      const resUnknown = await mockApp.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer random-unknown' }
      });
      expect(resUnknown.statusCode).toBe(401);
      expect(resUnknown.json().error.code).toBe('INVALID_TOKEN');

      await mockApp.close();
    });
  });
});
