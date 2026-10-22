import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import {
  createAuthHooks,
  createTestJwt,
  SupabaseJwtVerifier,
  CompositeAuthVerifier
} from '../auth.js';
import { registerErrorHandlers } from '../error-handler.js';
import { MockAgentsRepository } from '../../modules/agents/agents.repository.js';
import { AuthService } from '../../services/auth.service.js';

describe('Task INT-D3-02: Composite Agent Device Secret & Supabase JWT Verifier', () => {
  const jwtSecret = 'test-secret-at-least-32-characters-long-key-for-jwt-signing';
  let agentsRepo: MockAgentsRepository;
  let compositeVerifier: CompositeAuthVerifier;
  let app: FastifyInstance;

  const validAgentSecret = 'caps_agent_sec_test123';
  const validAgentTokenHash = crypto.createHash('sha256').update(validAgentSecret).digest('hex');

  const revokedAgentSecret = 'caps_agent_sec_revoked_999';
  const revokedTokenHash = crypto.createHash('sha256').update(revokedAgentSecret).digest('hex');

  const shopIdA = '11111111-1111-1111-1111-111111111111';
  const shopIdB = '22222222-2222-2222-2222-222222222222';
  let deviceIdA: string;
  let deviceIdRevoked: string;

  beforeEach(async () => {
    agentsRepo = new MockAgentsRepository();

    // Register active agent device for shop A
    const activeDev = await agentsRepo.registerDevice({
      shop_id: shopIdA,
      device_fingerprint: 'fp-station-01',
      device_name: 'Main Print Station',
      agent_version: '1.0.0',
      auth_token_hash: validAgentTokenHash,
      paired_by: 'owner-uuid-1'
    });
    deviceIdA = activeDev.id;

    // Register revoked agent device
    const revDev = await agentsRepo.registerDevice({
      shop_id: shopIdA,
      device_fingerprint: 'fp-station-revoked',
      device_name: 'Revoked Print Station',
      agent_version: '1.0.0',
      auth_token_hash: revokedTokenHash,
      paired_by: 'owner-uuid-1'
    });
    deviceIdRevoked = revDev.id;
    await agentsRepo.revokeDevice(deviceIdRevoked, 'Compromised hardware');

    compositeVerifier = new CompositeAuthVerifier(
      new SupabaseJwtVerifier(jwtSecret),
      () => agentsRepo
    );

    app = Fastify({ logger: false });
    registerErrorHandlers(app);

    const { authenticate, authorize } = createAuthHooks(compositeVerifier, () => agentsRepo);
    app.decorateRequest('user', null);
    app.decorateRequest('agent', null);
    app.decorate('authenticate', authenticate);
    app.decorate('authorize', authorize);

    // Protected Test Endpoints
    app.get('/api/v1/auth/inspect', { preHandler: [app.authenticate] }, async (req, reply) => {
      return reply.status(200).send({
        user: req.user,
        agent: req.agent
      });
    });

    app.get(
      '/api/v1/shops/:shopId/agent-check',
      { preHandler: [app.authenticate] },
      async (req, reply) => {
        return reply.status(200).send({
          agent: req.agent,
          shop_id: (req.params as any).shopId
        });
      }
    );

    app.get(
      '/api/v1/agent-only',
      { preHandler: [app.authenticate, app.authorize(['PRINT_AGENT'])] },
      async (_req, reply) => {
        return reply.status(200).send({ access: 'granted', role: 'PRINT_AGENT' });
      }
    );

    app.get(
      '/api/v1/owner-only',
      { preHandler: [app.authenticate, app.authorize(['shop_owner'])] },
      async (_req, reply) => {
        return reply.status(200).send({ access: 'granted', role: 'shop_owner' });
      }
    );
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Step 1 & 2: Desktop Agent Device Secret (caps_agent_sec_*) Authentication', () => {
    it('authorizes successfully with valid agent token caps_agent_sec_test123 and populates request.agent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${validAgentSecret}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.agent).toBeDefined();
      expect(body.agent.device_id).toBe(deviceIdA);
      expect(body.agent.shop_id).toBe(shopIdA);
      expect(body.agent.role).toBe('PRINT_AGENT');

      expect(body.user).toBeDefined();
      expect(body.user.role).toBe('agent');
      expect(body.user.id).toBe(deviceIdA);
      expect(body.user.shop_id).toBe(shopIdA);
    });

    it('rejects with 401 Unauthorized when agent token has malformed/empty payload', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: 'Bearer caps_agent_sec_'
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Malformed');
    });

    it('rejects with 401 Unauthorized when agent secret is unregistered', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: 'Bearer caps_agent_sec_unregistered_unknown'
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 401 Unauthorized when agent device is revoked', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${revokedAgentSecret}`
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toMatch(/revoked|invalid|not registered|not found/i);
    });

    it('rejects with 401 Unauthorized when agent device status is not ACTIVE', async () => {
      const inactiveSecret = 'caps_agent_sec_inactive_456';
      const inactiveHash = crypto.createHash('sha256').update(inactiveSecret).digest('hex');

      const inactiveDev = await agentsRepo.registerDevice({
        shop_id: shopIdA,
        device_fingerprint: 'fp-station-inactive',
        device_name: 'Inactive Station',
        auth_token_hash: inactiveHash,
        paired_by: 'owner-uuid-1'
      });

      const rawDevice = (agentsRepo as any).devices.get(inactiveDev.id);
      if (rawDevice) {
        rawDevice.status = 'INACTIVE';
      }

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${inactiveSecret}`
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects with 401 Unauthorized when agent device shop does not match route shop', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopIdB}/agent-check`,
        headers: {
          authorization: `Bearer ${validAgentSecret}` // Belongs to shopIdA
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('does not belong to shop');
    });

    it('accepts agent when route shop matches device shop', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopIdA}/agent-check`,
        headers: {
          authorization: `Bearer ${validAgentSecret}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.agent.device_id).toBe(deviceIdA);
      expect(body.shop_id).toBe(shopIdA);
    });
  });

  describe('Step 3: Supabase Customer & Owner JWT Authentication', () => {
    it('authorizes customer Supabase JWT and leaves request.agent null', async () => {
      const customerToken = createTestJwt(
        {
          sub: '99999999-9999-9999-9999-999999999999',
          email: 'customer@caps.example.com',
          role: 'customer',
          app_metadata: { role: 'customer' }
        },
        jwtSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${customerToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user).toBeDefined();
      expect(body.user.id).toBe('99999999-9999-9999-9999-999999999999');
      expect(body.user.role).toBe('customer');
      expect(body.user.email).toBe('customer@caps.example.com');
      expect(body.agent).toBeNull();
    });

    it('authorizes shop_owner Supabase JWT and leaves request.agent null', async () => {
      const ownerToken = createTestJwt(
        {
          sub: '88888888-8888-8888-8888-888888888888',
          email: 'owner@caps.example.com',
          role: 'shop_owner',
          shop_id: shopIdA,
          app_metadata: { role: 'shop_owner', shop_id: shopIdA }
        },
        jwtSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${ownerToken}`
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user).toBeDefined();
      expect(body.user.id).toBe('88888888-8888-8888-8888-888888888888');
      expect(body.user.role).toBe('shop_owner');
      expect(body.user.shop_id).toBe(shopIdA);
      expect(body.agent).toBeNull();
    });

    it('rejects expired JWT with 401 TOKEN_EXPIRED', async () => {
      const expiredToken = createTestJwt(
        { sub: '77777777-7777-7777-7777-777777777777', role: 'customer' },
        jwtSecret,
        -50
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${expiredToken}`
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('rejects tampered JWT signature with 401 INVALID_TOKEN', async () => {
      const validToken = createTestJwt(
        { sub: '77777777-7777-7777-7777-777777777777', role: 'customer' },
        jwtSecret
      );
      const tampered = `${validToken.slice(0, -6)}tamper`;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/inspect',
        headers: {
          authorization: `Bearer ${tampered}`
        }
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Role-Based Authorization (fastify.authorize)', () => {
    it('allows valid agent access to PRINT_AGENT protected endpoint', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agent-only',
        headers: {
          authorization: `Bearer ${validAgentSecret}`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().access).toBe('granted');
    });

    it('denies customer access to PRINT_AGENT protected endpoint with 403 FORBIDDEN_ROLE', async () => {
      const customerToken = createTestJwt(
        { sub: '99999999-9999-9999-9999-999999999999', role: 'customer' },
        jwtSecret
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agent-only',
        headers: {
          authorization: `Bearer ${customerToken}`
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ROLE');
    });

    it('denies agent access to shop_owner protected endpoint with 403 FORBIDDEN_ROLE', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/owner-only',
        headers: {
          authorization: `Bearer ${validAgentSecret}`
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('AuthService Integration & Verification Methods', () => {
    it('verifies agent secret and returns AgentAuth via AuthService', async () => {
      const authService = new AuthService({
        jwtSecret,
        agentsRepo
      });

      const agentAuth = await authService.verifyAgentSecret(validAgentSecret, shopIdA);
      expect(agentAuth.device_id).toBe(deviceIdA);
      expect(agentAuth.shop_id).toBe(shopIdA);
      expect(agentAuth.role).toBe('PRINT_AGENT');
      expect(agentAuth.status).toBe('ACTIVE');
    });

    it('dispatches verifyToken seamlessly between agent and JWT in AuthService', async () => {
      const authService = new AuthService({
        jwtSecret,
        agentsRepo
      });

      // Agent dispatch
      const agentResult = await authService.verifyToken(validAgentSecret);
      expect(agentResult.agent).toBeDefined();
      expect(agentResult.agent?.role).toBe('PRINT_AGENT');
      expect(agentResult.user?.role).toBe('agent');

      // JWT dispatch
      const ownerToken = createTestJwt(
        { sub: 'owner-1', role: 'shop_owner', email: 'owner@shop.com' },
        jwtSecret
      );
      const jwtResult = await authService.verifyToken(ownerToken);
      expect(jwtResult.user?.id).toBe('owner-1');
      expect(jwtResult.user?.role).toBe('shop_owner');
      expect(jwtResult.agent).toBeUndefined();
    });
  });
});
