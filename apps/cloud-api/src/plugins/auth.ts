import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { AuthError } from './error-handler.js';

export type UserRole = 'customer' | 'shop_owner' | 'admin' | 'agent';

export interface AuthUser {
  id: string; // UUID
  role: UserRole;
  email?: string | undefined;
  shop_id?: string | undefined;
  app_metadata?: Record<string, unknown> | undefined;
  user_metadata?: Record<string, unknown> | undefined;
  token_claims?: Record<string, unknown> | undefined;
}

export interface ITokenVerifier {
  verifyToken(token: string): Promise<AuthUser>;
}

export interface AuthPluginOptions {
  jwtSecret?: string | undefined;
  tokenVerifier?: ITokenVerifier | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      allowedRoles: UserRole[]
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
    let header: { alg?: string; typ?: string };
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    } catch {
      throw new AuthError(401, 'INVALID_TOKEN', 'Malformed JWT header encoding.');
    }

    if (header.alg !== 'HS256') {
      throw new AuthError(
        401,
        'INVALID_TOKEN',
        `Unsupported JWT signing algorithm: ${header.alg}. HS256 expected.`
      );
    }

    // 2. Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(signingInput)
      .digest('base64url');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    const actualBuffer = Buffer.from(signatureB64, 'utf-8');

    if (
      expectedBuffer.length !== actualBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new AuthError(401, 'INVALID_TOKEN', 'Invalid JWT token signature.');
    }

    // 3. Parse and validate payload
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
      candidateRole === 'agent'
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
 * In-memory Mock Token Verifier for tests and offline development.
 */
export class MockTokenVerifier implements ITokenVerifier {
  private usersByToken = new Map<string, AuthUser>();
  private expiredTokens = new Set<string>();

  registerUser(token: string, user: AuthUser): void {
    this.usersByToken.set(token, user);
  }

  registerExpiredToken(token: string): void {
    this.expiredTokens.add(token);
  }

  async verifyToken(token: string): Promise<AuthUser> {
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

export function createAuthHooks(verifier: ITokenVerifier) {
  const authenticate = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
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
    const user = await verifier.verifyToken(token);
    request.user = user;
  };

  const authorize = (allowedRoles: UserRole[]) => {
    return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      if (!request.user) {
        throw new AuthError(
          401,
          'UNAUTHORIZED',
          'Authentication is required prior to role authorization.'
        );
      }

      if (!allowedRoles.includes(request.user.role)) {
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
  const verifier = options.tokenVerifier ?? new SupabaseJwtVerifier(secret);
  const { authenticate, authorize } = createAuthHooks(verifier);

  if (!fastify.hasRequestDecorator('user')) {
    fastify.decorateRequest('user', null);
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
