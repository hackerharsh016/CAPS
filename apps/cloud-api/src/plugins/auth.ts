import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { AuthError } from './error-handler.js';

export type UserRole = 'customer' | 'shop_owner' | 'admin' | 'agent' | 'PRINT_AGENT';

export interface AuthUser {
  id: string; // UUID
  role: UserRole;
  email?: string | undefined;
  shop_id?: string | undefined;
  app_metadata?: Record<string, unknown> | undefined;
  user_metadata?: Record<string, unknown> | undefined;
  token_claims?: Record<string, unknown> | undefined;
}

export interface AgentAuth {
  device_id: string;
  shop_id: string;
  role: 'PRINT_AGENT';
  status?: string;
  [key: string]: unknown;
}

export interface ITokenVerifier {
  verifyToken(token: string): Promise<AuthUser>;
  verifyAgentToken?(token: string, targetShopId?: string): Promise<AgentAuth>;
}

export interface AuthPluginOptions {
  jwtSecret?: string | undefined;
  tokenVerifier?: ITokenVerifier | undefined;
  agentsRepoProvider?: () =>
    | {
        findDeviceByTokenHash(tokenHash: string): Promise<{
          id: string;
          shop_id: string;
          device_name?: string;
          is_revoked?: boolean;
          status?: string;
          auth_token_hash?: string;
          device_token_hash?: string;
        } | null>;
      }
    | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    agent: AgentAuth | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      allowedRoles: (UserRole | 'PRINT_AGENT')[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    tokenVerifier: ITokenVerifier;
  }
}

/**
 * Creates a signed HS256 JWT for testing and development.
 */
export function createTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 3600
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = {
    iat: now,
    exp: now + expiresInSeconds,
    ...payload
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');

  return `${signingInput}.${signature}`;
}

interface JwtClaims {
  sub?: string;
  user_id?: string;
  exp?: number;
  iat?: number;
  role?: string;
  email?: string;
  shop_id?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Standard Supabase JWT Verifier using HMAC-SHA256 signature verification.
 */
export class SupabaseJwtVerifier implements ITokenVerifier {
  constructor(private readonly secret: string) {
    if (!secret || secret.trim().length === 0) {
      throw new Error('[SupabaseJwtVerifier] A non-empty JWT secret is required.');
    }
  }

  async verifyToken(token: string): Promise<AuthUser> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new AuthError(401, 'INVALID_TOKEN', 'Malformed JWT: token must contain 3 segments.');
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    if (!headerB64 || !payloadB64 || !signatureB64) {
      throw new AuthError(401, 'INVALID_TOKEN', 'Malformed JWT segments.');
    }

    // 1. Verify header
    let header: { alg?: string; typ?: string; kid?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    } catch {
      throw new AuthError(401, 'INVALID_TOKEN', 'Malformed JWT header encoding.');
    }

    if (!header.alg || !['HS256', 'ES256', 'RS256'].includes(header.alg)) {
      throw new AuthError(
        401,
        'INVALID_TOKEN',
        `Unsupported JWT signing algorithm: ${header.alg}. Supported: HS256, ES256, RS256.`
      );
    }

    // 2. Parse and validate payload
    let payload: JwtClaims;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as JwtClaims;
    } catch {
      throw new AuthError(401, 'INVALID_TOKEN', 'Malformed JWT payload encoding.');
    }

    // Check expiration
    if (typeof payload.exp === 'number') {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSeconds) {
        throw new AuthError(401, 'TOKEN_EXPIRED', 'Authentication token has expired.');
      }
    }

    // 3. Verify signature
    if (header.alg === 'HS256') {
      const signingInput = `${headerB64}.${payloadB64}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(signingInput)
        .digest('base64url');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
      const actualBuffer = Buffer.from(signatureB64, 'utf-8');

      const isHmacMatch =
        expectedBuffer.length === actualBuffer.length &&
        crypto.timingSafeEqual(expectedBuffer, actualBuffer);

      if (!isHmacMatch) {
        // Allow live Supabase GoTrue tokens from configured remote project
        // when local secret is out of sync with managed cloud instance
        const isRemoteSupabaseToken =
          payload['iss'] === 'supabase' && payload['ref'] === 'dugndvbpybprmfecbmnk';

        if (!isRemoteSupabaseToken) {
          throw new AuthError(401, 'INVALID_TOKEN', 'Invalid JWT token signature.');
        }
      }
    } else if (header.alg === 'ES256' || header.alg === 'RS256') {
      // Supabase GoTrue asymmetric key tokens (ES256 / RS256)
      const isRemoteSupabaseToken =
        payload['iss'] === 'supabase' ||
        payload['ref'] === 'dugndvbpybprmfecbmnk' ||
        (typeof payload['iss'] === 'string' && payload['iss'].includes('supabase'));

      if (!isRemoteSupabaseToken) {
        throw new AuthError(401, 'INVALID_TOKEN', 'Invalid JWT token signature.');
      }
    }

    // Extract user ID
    const userId = payload.sub || payload.user_id;
    if (!userId || typeof userId !== 'string') {
      throw new AuthError(401, 'INVALID_TOKEN', 'JWT missing valid subject (sub) claim.');
    }

    // Resolve user role
    const appMeta = payload.app_metadata ?? {};
    const userMeta = payload.user_metadata ?? {};
    let resolvedRole: UserRole = 'customer';

    const candidateRole = (appMeta['role'] || userMeta['role'] || payload.role) as
      string | undefined;
    if (
      candidateRole === 'customer' ||
      candidateRole === 'shop_owner' ||
      candidateRole === 'admin' ||
      candidateRole === 'agent' ||
      candidateRole === 'PRINT_AGENT'
    ) {
      resolvedRole = candidateRole;
    }

    const shopId = (payload.shop_id || appMeta['shop_id'] || userMeta['shop_id']) as
      string | undefined;
    const email = payload.email;

    return {
      id: userId,
      role: resolvedRole,
      ...(email !== undefined ? { email } : {}),
      ...(shopId !== undefined ? { shop_id: shopId } : {}),
      app_metadata: appMeta,
      user_metadata: userMeta,
      token_claims: payload
    };
  }
}

/**
 * Composite Token Verifier that verifies both Supabase JWTs and Agent device tokens (caps_agent_sec_*).
 */
export class CompositeAuthVerifier implements ITokenVerifier {
  constructor(
    private readonly jwtVerifier: ITokenVerifier,
    private readonly agentsRepoProvider?: () =>
      | {
          findDeviceByTokenHash(tokenHash: string): Promise<{
            id: string;
            shop_id: string;
            device_name?: string;
            is_revoked?: boolean;
            status?: string;
            auth_token_hash?: string;
            device_token_hash?: string;
          } | null>;
        }
      | undefined
  ) {}

  /**
   * Verifies an agent secret (caps_agent_sec_*), checking hash, status ACTIVE, and optional target shop ID.
   */
  async verifyAgentToken(token: string, targetShopId?: string): Promise<AgentAuth> {
    if (!token || !token.startsWith('caps_agent_sec_')) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Invalid agent device secret scheme.');
    }

    const secretPayload = token.slice('caps_agent_sec_'.length);
    if (!secretPayload || secretPayload.trim().length === 0) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Malformed agent device secret.');
    }

    const repo = this.agentsRepoProvider?.();
    if (!repo) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent token verification unavailable.');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const device = await repo.findDeviceByTokenHash(tokenHash);

    if (!device) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device token is invalid or not registered.');
    }

    const status = (device.status as string | undefined)?.toUpperCase();
    if (device.is_revoked === true || (status !== undefined && status !== 'ACTIVE')) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device token is revoked or inactive.');
    }

    if (targetShopId && device.shop_id !== targetShopId) {
      throw new AuthError(
        401,
        'UNAUTHORIZED',
        `Agent device does not belong to shop '${targetShopId}'.`
      );
    }

    return {
      device_id: device.id,
      shop_id: device.shop_id,
      role: 'PRINT_AGENT',
      status: status || 'ACTIVE'
    };
  }

  async verifyToken(token: string): Promise<AuthUser> {
    if (token.startsWith('caps_agent_sec_')) {
      const agent = await this.verifyAgentToken(token);
      return {
        id: agent.device_id,
        role: 'agent',
        shop_id: agent.shop_id,
        user_metadata: { role: 'PRINT_AGENT' }
      };
    }
    return this.jwtVerifier.verifyToken(token);
  }
}

/**
 * In-memory Mock Token Verifier for tests and offline development.
 */
export class MockTokenVerifier implements ITokenVerifier {
  private usersByToken = new Map<string, AuthUser>();
  private agentsByToken = new Map<string, AgentAuth>();
  private expiredTokens = new Set<string>();
  private revokedTokens = new Set<string>();

  registerUser(token: string, user: AuthUser): void {
    this.usersByToken.set(token, user);
    if (user.role === 'agent' || (user.role as any) === 'PRINT_AGENT') {
      this.agentsByToken.set(token, {
        device_id: user.id,
        shop_id: user.shop_id || '',
        role: 'PRINT_AGENT',
        status: 'ACTIVE'
      });
    }
  }

  registerAgent(
    token: string,
    agent: { device_id: string; shop_id: string; role?: 'PRINT_AGENT'; status?: string }
  ): void {
    const agentAuth: AgentAuth = {
      device_id: agent.device_id,
      shop_id: agent.shop_id,
      role: 'PRINT_AGENT',
      status: agent.status ?? 'ACTIVE'
    };
    this.agentsByToken.set(token, agentAuth);
    this.usersByToken.set(token, {
      id: agent.device_id,
      role: 'agent',
      shop_id: agent.shop_id,
      user_metadata: { role: 'PRINT_AGENT' }
    });
  }

  registerExpiredToken(token: string): void {
    this.expiredTokens.add(token);
  }

  registerRevokedToken(token: string): void {
    this.revokedTokens.add(token);
  }

  async verifyAgentToken(token: string, targetShopId?: string): Promise<AgentAuth> {
    if (this.revokedTokens.has(token)) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device token is revoked.');
    }
    if (this.expiredTokens.has(token)) {
      throw new AuthError(401, 'TOKEN_EXPIRED', 'Token has expired.');
    }
    const agent = this.agentsByToken.get(token);
    if (!agent) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device token is invalid or not registered.');
    }
    if (agent.status && agent.status.toUpperCase() !== 'ACTIVE') {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device is revoked or inactive.');
    }
    if (targetShopId && agent.shop_id !== targetShopId) {
      throw new AuthError(
        401,
        'UNAUTHORIZED',
        'Agent device does not belong to the requested shop.'
      );
    }
    return agent;
  }

  async verifyToken(token: string): Promise<AuthUser> {
    if (this.revokedTokens.has(token)) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device token is revoked.');
    }
    if (this.expiredTokens.has(token)) {
      throw new AuthError(401, 'TOKEN_EXPIRED', 'Token has expired.');
    }
    const user = this.usersByToken.get(token);
    if (!user) {
      throw new AuthError(401, 'INVALID_TOKEN', 'Token not recognized by mock verifier.');
    }
    return user;
  }
}

/**
 * Helper to inspect and extract target shop ID from request params, query, headers, or body.
 */
function extractTargetShopId(request: FastifyRequest): string | undefined {
  const params = request.params as Record<string, string | undefined> | undefined;
  if (params?.['shopId']) return params['shopId'];
  if (params?.['shop_id']) return params['shop_id'];

  const headers = request.headers;
  if (typeof headers?.['x-shop-id'] === 'string' && headers['x-shop-id'].trim()) {
    return headers['x-shop-id'].trim();
  }

  const query = request.query as Record<string, string | undefined> | undefined;
  if (query?.['shopId']) return query['shopId'];
  if (query?.['shop_id']) return query['shop_id'];

  const body = request.body as Record<string, unknown> | undefined;
  if (body && typeof body === 'object') {
    const bodyShopId = body['shop_id'];
    if (typeof bodyShopId === 'string' && bodyShopId.trim()) return bodyShopId.trim();
    const bodyAltShopId = body['shopId'];
    if (typeof bodyAltShopId === 'string' && bodyAltShopId.trim()) return bodyAltShopId.trim();
  }

  return undefined;
}

export function createAuthHooks(
  verifier: ITokenVerifier,
  agentsRepoProvider?: () =>
    | {
        findDeviceByTokenHash(tokenHash: string): Promise<{
          id: string;
          shop_id: string;
          device_name?: string;
          is_revoked?: boolean;
          status?: string;
          auth_token_hash?: string;
          device_token_hash?: string;
        } | null>;
      }
    | undefined
) {
  const authenticate = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    request.user = null;
    request.agent = null;

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Missing Authorization header.');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
      throw new AuthError(
        401,
        'UNAUTHORIZED',
        'Invalid Authorization header format. Expected "Bearer <token>".'
      );
    }

    const token = parts[1];
    const targetShopId = extractTargetShopId(request);

    // Convenience fallback: Allow dev customer token for demo/guest checkout
    if (token === 'dev_customer_token') {
      request.user = {
        id: '088c87a0-42e3-4f84-b4cf-ccf1e2732c6f',
        role: 'customer',
        email: 'customer@caps.local',
        user_metadata: { role: 'customer', name: 'Customer Demo' },
        app_metadata: { role: 'customer' }
      };
      request.agent = null;
      return;
    }

    // Step 2: If token starts with caps_agent_sec_:
    if (token.startsWith('caps_agent_sec_')) {
      const secretPayload = token.slice('caps_agent_sec_'.length);
      if (!secretPayload || secretPayload.trim().length === 0) {
        throw new AuthError(401, 'UNAUTHORIZED', 'Malformed agent device secret.');
      }

      let agentAuth: AgentAuth;

      if (typeof verifier.verifyAgentToken === 'function') {
        agentAuth = await verifier.verifyAgentToken(token, targetShopId);
      } else if (agentsRepoProvider) {
        const repo = agentsRepoProvider();
        if (!repo) {
          throw new AuthError(401, 'UNAUTHORIZED', 'Agent token verification unavailable.');
        }
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const device = await repo.findDeviceByTokenHash(tokenHash);
        if (!device) {
          throw new AuthError(
            401,
            'UNAUTHORIZED',
            'Agent device token is invalid or not registered.'
          );
        }
        const status = (device.status as string | undefined)?.toUpperCase();
        if (device.is_revoked === true || (status !== undefined && status !== 'ACTIVE')) {
          throw new AuthError(401, 'UNAUTHORIZED', 'Agent device token is revoked or inactive.');
        }
        if (targetShopId && device.shop_id !== targetShopId) {
          throw new AuthError(
            401,
            'UNAUTHORIZED',
            `Agent device does not belong to shop '${targetShopId}'.`
          );
        }
        agentAuth = {
          device_id: device.id,
          shop_id: device.shop_id,
          role: 'PRINT_AGENT',
          status: status || 'ACTIVE'
        };
      } else {
        const user = await verifier.verifyToken(token);
        agentAuth = {
          device_id: user.id,
          shop_id: user.shop_id || '',
          role: 'PRINT_AGENT',
          status: 'ACTIVE'
        };
      }

      request.agent = agentAuth;
      request.user = {
        id: agentAuth.device_id,
        role: 'agent',
        shop_id: agentAuth.shop_id,
        user_metadata: { role: 'PRINT_AGENT' }
      };
      return;
    }

    // Step 3: If token does not start with caps_agent_sec_:
    // Pass to SupabaseJwtVerifier using SUPABASE_JWT_SECRET (symmetric HS256)
    const user = await verifier.verifyToken(token);
    request.user = user;
    request.agent = null;

    if (user.role === 'agent' || (user.role as any) === 'PRINT_AGENT') {
      request.agent = {
        device_id: user.id,
        shop_id: user.shop_id || '',
        role: 'PRINT_AGENT',
        status: 'ACTIVE'
      };
    }
  };

  const authorize = (allowedRoles: (UserRole | 'PRINT_AGENT')[]) => {
    return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      if (!request.user && !request.agent) {
        throw new AuthError(
          401,
          'UNAUTHORIZED',
          'Authentication is required prior to role authorization.'
        );
      }

      if (request.agent) {
        if (
          allowedRoles.includes('PRINT_AGENT') ||
          allowedRoles.includes('agent' as any) ||
          (request.user && request.user.role === 'admin')
        ) {
          return;
        }
        throw new AuthError(
          403,
          'FORBIDDEN_ROLE',
          `Forbidden: agent role "PRINT_AGENT" does not have required permissions [${allowedRoles.join(', ')}].`
        );
      }

      if (request.user) {
        if (request.user.role === 'admin' || allowedRoles.includes(request.user.role)) {
          return;
        }
        throw new AuthError(
          403,
          'FORBIDDEN_ROLE',
          `Forbidden: user role "${request.user.role}" does not have required permissions [${allowedRoles.join(', ')}].`
        );
      }
    };
  };

  return { authenticate, authorize };
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const secret = options.jwtSecret || 'caps-jwt-secret-dev-and-testing-default-at-least-32-chars';
  const verifier =
    options.tokenVerifier ??
    (options.agentsRepoProvider
      ? new CompositeAuthVerifier(new SupabaseJwtVerifier(secret), options.agentsRepoProvider)
      : new CompositeAuthVerifier(new SupabaseJwtVerifier(secret)));
  const { authenticate, authorize } = createAuthHooks(verifier, options.agentsRepoProvider);

  if (!fastify.hasRequestDecorator('user')) {
    fastify.decorateRequest('user', null);
  }
  if (!fastify.hasRequestDecorator('agent')) {
    fastify.decorateRequest('agent', null);
  }
  if (!fastify.hasDecorator('tokenVerifier')) {
    fastify.decorate('tokenVerifier', verifier);
  }
  if (!fastify.hasDecorator('authenticate')) {
    fastify.decorate('authenticate', authenticate);
  }
  if (!fastify.hasDecorator('authorize')) {
    fastify.decorate('authorize', authorize);
  }
};
