/**
 * Agent Pairing and Device Connectivity Service for CAPS Owner Dashboard.
 * Handles:
 * 1. Generating ephemeral 8-character pairing codes (CP-XXXXXX) with 10-minute TTL
 * 2. Querying paired agent devices and real-time connectivity status (online/offline heartbeat tracking)
 * 3. Revoking compromised or retired Windows agent devices with audit reasons
 * 4. Tenant isolation: owners cannot view, pair, or revoke agent devices belonging to other shops
 */

import { getSupabaseEnv, getSupabaseBrowserClient } from '../../lib/supabase';
import type {
  AgentDeviceStatus,
  GeneratePairingCodeRequest,
  GeneratePairingCodeResponse,
  RevokeAgentDeviceRequest,
  RevokeAgentDeviceResponse
} from './types';

export class AgentPairingError extends Error {
  readonly code:
    | 'UNAUTHORIZED_CROSS_SHOP'
    | 'DEVICE_NOT_FOUND'
    | 'DEVICE_ALREADY_REVOKED'
    | 'PAIRING_GENERATION_FAILED'
    | 'NETWORK_ERROR'
    | 'VALIDATION_ERROR';

  constructor(
    code:
      | 'UNAUTHORIZED_CROSS_SHOP'
      | 'DEVICE_NOT_FOUND'
      | 'DEVICE_ALREADY_REVOKED'
      | 'PAIRING_GENERATION_FAILED'
      | 'NETWORK_ERROR'
      | 'VALIDATION_ERROR',
    message: string
  ) {
    super(message);
    this.name = 'AgentPairingError';
    this.code = code;
  }
}

export interface AgentPairingServiceConfig {
  customFetch?: typeof fetch | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}

export class AgentPairingService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: AgentPairingServiceConfig) {
    const env = getSupabaseEnv();
    this.supabaseUrl = (config?.supabaseUrl ?? env.supabaseUrl).replace(/\/$/, '');
    this.supabaseAnonKey = config?.supabaseAnonKey ?? env.supabaseAnonKey;
    this.fetchFn =
      config?.customFetch ??
      (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch));
  }

  /**
   * Generates a short-lived single-use pairing code (e.g. CP-9X42A1) for enrolling a new Windows PC.
   * Invokes Migration 010 stored procedure `generate_agent_pairing_code`.
   */
  async generatePairingCode(
    request: GeneratePairingCodeRequest,
    accessToken?: string
  ): Promise<GeneratePairingCodeResponse> {
    const { shopId, ttlSeconds = 600 } = request;

    if (!shopId) {
      throw new AgentPairingError('VALIDATION_ERROR', 'Shop ID is required to generate pairing code.');
    }

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;
    const effectiveUserId = session?.user?.id;

    if (!effectiveToken || !effectiveUserId) {
      throw new AgentPairingError('UNAUTHORIZED_CROSS_SHOP', 'User session is invalid or unauthenticated.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${effectiveToken}`
    };

    // 1. Verify shop ownership
    const shopUrl = `${this.supabaseUrl}/rest/v1/shops?id=eq.${shopId}&select=id,owner_id`;
    try {
      const shopRes = await this.fetchFn(shopUrl, { method: 'GET', headers });
      if (!shopRes.ok) {
        throw new AgentPairingError('UNAUTHORIZED_CROSS_SHOP', 'Failed to verify shop ownership.');
      }
      const shops = (await shopRes.json()) as Array<{ id: string; owner_id: string }>;
      const shop = shops[0];
      if (!shop || shop.owner_id !== effectiveUserId) {
        throw new AgentPairingError(
          'UNAUTHORIZED_CROSS_SHOP',
          'Unauthorized: Current user does not own this shop.'
        );
      }
    } catch (err) {
      if (err instanceof AgentPairingError) throw err;
      throw new AgentPairingError(
        'UNAUTHORIZED_CROSS_SHOP',
        'Unauthorized: Current user does not own this shop.'
      );
    }

    // 2. Invoke RPC generate_agent_pairing_code
    try {
      const rpcUrl = `${this.supabaseUrl}/rest/v1/rpc/generate_agent_pairing_code`;
      const res = await this.fetchFn(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          p_shop_id: shopId,
          p_created_by: effectiveUserId,
          p_ttl_seconds: ttlSeconds
        })
      });

      if (!res.ok) {
        throw new AgentPairingError(
          'PAIRING_GENERATION_FAILED',
          `Failed to generate pairing code: HTTP ${res.status}`
        );
      }

      interface RpcPairingResult {
        pairing_code_id: string;
        code: string;
        expires_at: string;
      }

      const results = (await res.json()) as RpcPairingResult[];
      const first = results[0];

      if (!first) {
        throw new AgentPairingError(
          'PAIRING_GENERATION_FAILED',
          'No pairing code returned from database procedure.'
        );
      }

      return {
        pairingCodeId: first.pairing_code_id,
        code: first.code,
        expiresAt: first.expires_at,
        ttlSeconds
      };
    } catch (err) {
      if (err instanceof AgentPairingError) throw err;
      throw new AgentPairingError(
        'NETWORK_ERROR',
        `Network error during pairing code generation: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Fetches all registered agent devices for this shop, computing live online/offline status
   * based on the 90-second heartbeat window.
   */
  async fetchShopAgentDevices(shopId: string, accessToken?: string): Promise<AgentDeviceStatus[]> {
    if (!shopId) return [];

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }

    try {
      const endpoint = `${this.supabaseUrl}/rest/v1/agent_devices?shop_id=eq.${shopId}&select=id,shop_id,device_name,agent_version,is_revoked,revoked_at,revoked_reason,device_fingerprint,last_heartbeat_at&order=created_at.desc`;
      const res = await this.fetchFn(endpoint, { method: 'GET', headers });
      if (!res.ok) return [];

      interface RemoteAgentDevice {
        id: string;
        shop_id: string;
        device_name: string;
        agent_version: string;
        is_revoked: boolean;
        revoked_at?: string | null;
        revoked_reason?: string | null;
        device_fingerprint: string;
        last_heartbeat_at: string;
      }

      const devices = (await res.json()) as RemoteAgentDevice[];
      return devices.map(d => {
        const lastHb = new Date(d.last_heartbeat_at).getTime();
        const isOnline = !d.is_revoked && Date.now() - lastHb < 1000 * 90; // 90-second heartbeat window

        return {
          id: d.id,
          shopId: d.shop_id,
          deviceName: d.device_name,
          agentVersion: d.agent_version,
          isOnline,
          lastHeartbeatAt: d.last_heartbeat_at,
          isRevoked: d.is_revoked,
          revokedAt: d.revoked_at || undefined,
          revokedReason: d.revoked_reason || undefined,
          deviceFingerprint: d.device_fingerprint
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Immediately revokes an agent device. Revoked devices are permanently denied heartbeat
   * and print job claim access.
   */
  async revokeAgentDevice(
    request: RevokeAgentDeviceRequest,
    accessToken?: string
  ): Promise<RevokeAgentDeviceResponse> {
    const { deviceId, shopId, reason } = request;

    if (!deviceId || !shopId) {
      throw new AgentPairingError('VALIDATION_ERROR', 'Device ID and Shop ID are required to revoke device.');
    }

    const client = getSupabaseBrowserClient();
    const session = await client.getSession();
    const effectiveToken = accessToken || session?.access_token;
    const effectiveUserId = session?.user?.id;

    if (!effectiveToken || !effectiveUserId) {
      throw new AgentPairingError('UNAUTHORIZED_CROSS_SHOP', 'User session is invalid or unauthenticated.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${effectiveToken}`
    };

    // 1. Verify shop ownership
    const shopUrl = `${this.supabaseUrl}/rest/v1/shops?id=eq.${shopId}&select=id,owner_id`;
    try {
      const shopRes = await this.fetchFn(shopUrl, { method: 'GET', headers });
      if (!shopRes.ok) {
        throw new AgentPairingError('UNAUTHORIZED_CROSS_SHOP', 'Failed to verify shop ownership.');
      }
      const shops = (await shopRes.json()) as Array<{ id: string; owner_id: string }>;
      const shop = shops[0];
      if (!shop || shop.owner_id !== effectiveUserId) {
        throw new AgentPairingError(
          'UNAUTHORIZED_CROSS_SHOP',
          'Unauthorized: Current user does not own this shop.'
        );
      }
    } catch (err) {
      if (err instanceof AgentPairingError) throw err;
      throw new AgentPairingError(
        'UNAUTHORIZED_CROSS_SHOP',
        'Unauthorized: Current user does not own this shop.'
      );
    }

    // 2. Fetch device and verify it belongs to this shop
    const deviceUrl = `${this.supabaseUrl}/rest/v1/agent_devices?id=eq.${deviceId}&select=id,shop_id,device_name,is_revoked`;
    const devRes = await this.fetchFn(deviceUrl, { method: 'GET', headers });
    if (!devRes.ok) {
      throw new AgentPairingError('DEVICE_NOT_FOUND', `Device ${deviceId} not found.`);
    }

    const devices = (await devRes.json()) as Array<{ id: string; shop_id: string; is_revoked: boolean }>;
    const device = devices[0];

    if (!device) {
      throw new AgentPairingError('DEVICE_NOT_FOUND', `Device ${deviceId} not found.`);
    }

    if (device.shop_id !== shopId) {
      throw new AgentPairingError(
        'UNAUTHORIZED_CROSS_SHOP',
        `Device ${deviceId} belongs to another shop.`
      );
    }

    if (device.is_revoked) {
      throw new AgentPairingError('DEVICE_ALREADY_REVOKED', `Device ${deviceId} has already been revoked.`);
    }

    // 3. Update device as revoked
    const now = new Date().toISOString();
    const patchUrl = `${this.supabaseUrl}/rest/v1/agent_devices?id=eq.${deviceId}&shop_id=eq.${shopId}`;
    const patchRes = await this.fetchFn(patchUrl, {
      method: 'PATCH',
      headers: {
        ...headers,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        is_revoked: true,
        revoked_at: now,
        revoked_reason: reason || 'Revoked by shop owner via dashboard',
        updated_at: now
      })
    });

    if (!patchRes.ok) {
      throw new AgentPairingError('NETWORK_ERROR', `Failed to revoke agent device: HTTP ${patchRes.status}`);
    }

    return {
      deviceId,
      isRevoked: true,
      revokedAt: now,
      reason: reason || 'Revoked by shop owner via dashboard'
    };
  }
}

export const defaultAgentPairingService = new AgentPairingService();
