import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentPairingService,
  AgentPairingError
} from '../src/features/agent-monitoring/agent-pairing-service';

const mockGetSession = vi.fn();

vi.mock('../src/lib/supabase', () => ({
  getSupabaseEnv: () => ({
    supabaseUrl: 'https://mock.supabase.co',
    supabaseAnonKey: 'mock-anon-key'
  }),
  getSupabaseBrowserClient: () => ({
    getSession: () => mockGetSession()
  })
}));

describe('Agent Connectivity and Pairing UI (P05-M03-F02)', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';
  const ownerId = 'user-owner-uuid-1';
  const deviceId = 'device-win11-uuid-1';

  let service: AgentPairingService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSession.mockResolvedValue({
      access_token: 'mock-owner-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: ownerId,
        email: 'owner@campusprint.in',
        created_at: new Date().toISOString()
      }
    });

    mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/shops')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: shopId, owner_id: ownerId }]
        } as Response;
      }

      if (url.includes('/rest/v1/rpc/generate_agent_pairing_code')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              pairing_code_id: 'code-uuid-1',
              code: 'CP-87KA2L',
              expires_at: new Date(Date.now() + 600 * 1000).toISOString()
            }
          ]
        } as Response;
      }

      if (url.includes('/rest/v1/agent_devices?shop_id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: deviceId,
              shop_id: shopId,
              device_name: 'Counter-PC-Win11',
              agent_version: '0.1.0',
              is_revoked: false,
              revoked_at: null,
              revoked_reason: null,
              device_fingerprint: 'fp-win-11-counter',
              last_heartbeat_at: new Date(Date.now() - 30 * 1000).toISOString() // 30s ago -> online
            },
            {
              id: 'device-offline-2',
              shop_id: shopId,
              device_name: 'Stall-PC-Win10',
              agent_version: '0.1.0',
              is_revoked: false,
              device_fingerprint: 'fp-win-10-stall',
              last_heartbeat_at: new Date(Date.now() - 300 * 1000).toISOString() // 5m ago -> offline
            }
          ]
        } as Response;
      }

      if (url.includes('/rest/v1/agent_devices?id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: deviceId,
              shop_id: shopId,
              device_name: 'Counter-PC-Win11',
              is_revoked: false
            }
          ]
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({})
      } as Response;
    });

    service = new AgentPairingService({
      customFetch: mockFetch as unknown as typeof fetch
    });
  });

  describe('Ephemeral Pairing Code Generation', () => {
    it('generates a short-lived 8-character pairing code with 10-minute TTL', async () => {
      const res = await service.generatePairingCode({ shopId, ttlSeconds: 600 });
      expect(res.code).toBe('CP-87KA2L');
      expect(res.pairingCodeId).toBe('code-uuid-1');
      expect(res.ttlSeconds).toBe(600);
      expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/v1/rpc/generate_agent_pairing_code'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_shop_id: shopId,
            p_created_by: ownerId,
            p_ttl_seconds: 600
          })
        })
      );
    });

    it('fails pairing generation when shop ID is missing', async () => {
      await expect(service.generatePairingCode({ shopId: '' })).rejects.toThrow(
        'Shop ID is required to generate pairing code'
      );
    });

    it('rejects pairing code generation if user does not own the shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: 'other-owner' }]
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new AgentPairingService({ customFetch: mockFetch as unknown as typeof fetch });
      await expect(svc.generatePairingCode({ shopId })).rejects.toThrow(
        'Unauthorized: Current user does not own this shop'
      );
    });
  });

  describe('Agent Device Telemetry & Connectivity Mapping', () => {
    it('correctly calculates online vs offline status based on 90s heartbeat window', async () => {
      const devices = await service.fetchShopAgentDevices(shopId);
      expect(devices).toHaveLength(2);

      // Device 1: 30s heartbeat -> online
      expect(devices[0]?.deviceName).toBe('Counter-PC-Win11');
      expect(devices[0]?.isOnline).toBe(true);
      expect(devices[0]?.isRevoked).toBe(false);

      // Device 2: 300s heartbeat -> offline
      expect(devices[1]?.deviceName).toBe('Stall-PC-Win10');
      expect(devices[1]?.isOnline).toBe(false);
    });
  });

  describe('Agent Device Revocation Flow', () => {
    it('successfully revokes a paired agent device with an audit reason', async () => {
      const result = await service.revokeAgentDevice({
        deviceId,
        shopId,
        reason: 'Counter PC decommissioned; replaced with POS hardware'
      });

      expect(result.deviceId).toBe(deviceId);
      expect(result.isRevoked).toBe(true);
      expect(result.reason).toContain('Counter PC decommissioned');

      // Verified PATCH was sent to agent_devices
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/rest/v1/agent_devices?id=eq.${deviceId}`),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"is_revoked":true')
        })
      );
    });

    it('rejects revocation if device belongs to another shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: ownerId }]
          } as Response;
        }

        if (url.includes('/rest/v1/agent_devices?id=eq.')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'other-device',
                shop_id: '00000000-0000-0000-0000-999999999999',
                device_name: 'Foreign-PC',
                is_revoked: false
              }
            ]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new AgentPairingService({ customFetch: mockFetch as unknown as typeof fetch });
      await expect(
        svc.revokeAgentDevice({
          deviceId: 'other-device',
          shopId,
          reason: 'Attempting to revoke foreign device'
        })
      ).rejects.toThrow('belongs to another shop');
    });

    it('rejects revocation if device is already revoked', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: ownerId }]
          } as Response;
        }

        if (url.includes('/rest/v1/agent_devices?id=eq.')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: deviceId,
                shop_id: shopId,
                device_name: 'Old-PC',
                is_revoked: true
              }
            ]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new AgentPairingService({ customFetch: mockFetch as unknown as typeof fetch });
      await expect(
        svc.revokeAgentDevice({
          deviceId,
          shopId,
          reason: 'Duplicate revocation'
        })
      ).rejects.toThrow(AgentPairingError);
    });
  });
});
