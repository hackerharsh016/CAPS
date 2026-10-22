/**
 * Domain Authentication Service
 * Unifies Supabase User JWT verification and Desktop Agent device secret verification.
 */

import crypto from 'node:crypto';
import { AuthError } from '../plugins/error-handler.js';
import {
  ITokenVerifier,
  SupabaseJwtVerifier,
  CompositeAuthVerifier,
  AuthUser,
  AgentAuth
} from '../plugins/auth.js';
import type { IAgentsRepository } from '../modules/agents/agents.repository.js';
import type { PairingService } from '../modules/agents/pairing.service.js';

export interface AuthServiceOptions {
  jwtSecret?: string | undefined;
  jwtVerifier?: ITokenVerifier | undefined;
  agentsRepo?: IAgentsRepository | undefined;
  pairingService?: PairingService | undefined;
}

export class AuthService {
  private readonly jwtVerifier: ITokenVerifier;
  private readonly agentsRepo?: IAgentsRepository | undefined;

  constructor(options: AuthServiceOptions = {}) {
    const secret =
      options.jwtSecret ||
      process.env['SUPABASE_JWT_SECRET'] ||
      'caps-jwt-secret-dev-and-testing-default-at-least-32-chars';
    this.jwtVerifier = options.jwtVerifier ?? new SupabaseJwtVerifier(secret);
    this.agentsRepo = options.agentsRepo;
  }

  /**
   * Returns a composite token verifier instance configured with this service's dependencies.
   */
  getVerifier(): ITokenVerifier {
    return new CompositeAuthVerifier(
      this.jwtVerifier,
      this.agentsRepo ? () => this.agentsRepo : undefined
    );
  }

  /**
   * Verifies a Desktop Agent device secret (caps_agent_sec_*).
   * - Computes SHA-256 hash
   * - Queries agent repository for matching device_token_hash / auth_token_hash
   * - Verifies device status is ACTIVE and shop ID matches
   * - Returns AgentAuth payload { device_id, shop_id, role: 'PRINT_AGENT' }
   */
  async verifyAgentSecret(secret: string, expectedShopId?: string): Promise<AgentAuth> {
    if (!secret || !secret.startsWith('caps_agent_sec_')) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Invalid agent device secret scheme.');
    }

    const secretPayload = secret.slice('caps_agent_sec_'.length);
    if (!secretPayload || secretPayload.trim().length === 0) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Malformed agent device secret payload.');
    }

    if (!this.agentsRepo) {
      throw new AuthError(
        401,
        'UNAUTHORIZED',
        'Agent repository is not configured for authentication.'
      );
    }

    const tokenHash = crypto.createHash('sha256').update(secret).digest('hex');
    const device = await this.agentsRepo.findDeviceByTokenHash(tokenHash);

    if (!device) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device secret is invalid or unregistered.');
    }

    const status = ((device as any).status as string | undefined)?.toUpperCase();
    if (device.is_revoked || (status && status !== 'ACTIVE')) {
      throw new AuthError(401, 'UNAUTHORIZED', 'Agent device is revoked or inactive.');
    }

    if (expectedShopId && device.shop_id !== expectedShopId) {
      throw new AuthError(
        401,
        'UNAUTHORIZED',
        `Agent device does not belong to shop '${expectedShopId}'.`
      );
    }

    return {
      device_id: device.id,
      shop_id: device.shop_id,
      role: 'PRINT_AGENT',
      status: status || 'ACTIVE'
    };
  }

  /**
   * Verifies a standard Supabase User JWT.
   */
  async verifyJwt(token: string): Promise<AuthUser> {
    return this.jwtVerifier.verifyToken(token);
  }

  /**
   * Dispatches token verification based on prefix (caps_agent_sec_* vs JWT).
   */
  async verifyToken(
    token: string,
    expectedShopId?: string
  ): Promise<{ user?: AuthUser; agent?: AgentAuth }> {
    if (token.startsWith('caps_agent_sec_')) {
      const agent = await this.verifyAgentSecret(token, expectedShopId);
      return {
        agent,
        user: {
          id: agent.device_id,
          role: 'agent',
          shop_id: agent.shop_id,
          user_metadata: { role: 'PRINT_AGENT' }
        }
      };
    }

    const user = await this.verifyJwt(token);
    return { user };
  }
}

export * from '../plugins/auth.js';
