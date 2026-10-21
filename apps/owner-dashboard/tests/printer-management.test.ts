import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PrinterService,
  detectCapabilityDifferences
} from '../src/features/printer-management/printer-service';
import type { DriverCapabilities } from '../src/features/printer-management/types';

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

describe('Printer Assignment and Driver Capabilities (P05-M03-F01)', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';
  const ownerId = 'user-owner-uuid-1';
  const printerId = 'printer-canon-ir2625';
  const deviceId = 'device-win11-pc';

  let service: PrinterService;
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

      if (url.includes('/rest/v1/agent_devices?id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: deviceId,
              shop_id: shopId,
              device_name: 'Counter-PC-01',
              is_revoked: false
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
              device_name: 'Counter-PC-01',
              is_revoked: false
            }
          ]
        } as Response;
      }

      if (url.includes('/rest/v1/printers?id=eq.') && url.includes('shop_id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: printerId,
              shop_id: shopId,
              device_id: deviceId,
              name: 'Canon imageRUNNER 2625',
              role: 'bw',
              is_default: true,
              status: 'online',
              capabilities: {
                paper_sizes: ['a4'],
                color_modes: ['bw'],
                duplex_supported: true,
                max_copies: 99
              }
            }
          ]
        } as Response;
      }

      if (url.includes('/rest/v1/printers?id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: printerId,
              shop_id: shopId,
              device_id: deviceId,
              name: 'Canon imageRUNNER 2625',
              role: 'bw',
              capabilities: {
                paper_sizes: ['a4', 'a3'],
                color_modes: ['bw'],
                duplex_supported: true,
                max_copies: 99
              },
              status: 'online'
            }
          ]
        } as Response;
      }

      if (url.includes('/rest/v1/printers?shop_id=eq.') && url.includes('id=neq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => []
        } as Response;
      }

      if (url.includes('/rest/v1/printers?shop_id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: printerId,
              shop_id: shopId,
              name: 'Canon imageRUNNER 2625',
              role: 'bw',
              is_default: true,
              capabilities: {
                paper_sizes: ['a4'],
                color_modes: ['bw'],
                duplex_supported: true,
                max_copies: 99
              },
              status: 'online'
            }
          ]
        } as Response;
      }

      // Default PATCH response returning updated representation
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: printerId,
            shop_id: shopId,
            device_id: deviceId,
            name: 'Canon imageRUNNER 2625',
            role: 'bw',
            is_default: true,
            status: 'online',
            capabilities: {
              paper_sizes: ['a4'],
              color_modes: ['bw'],
              duplex_supported: true,
              max_copies: 99
            }
          }
        ]
      } as Response;
    });

    service = new PrinterService({
      customFetch: mockFetch as unknown as typeof fetch
    });
  });

  describe('Happy Path: Printer Assignment & Role Updates', () => {
    it('successfully updates printer assignment to an authorized shop agent device', async () => {
      const updated = await service.updatePrinterAssignment({
        printer_id: printerId,
        shop_id: shopId,
        device_id: deviceId,
        role: 'bw',
        is_default: true
      });

      expect(updated.id).toBe(printerId);
      expect(updated.device_id).toBe(deviceId);
      expect(updated.is_default).toBe(true);

      // Verify PATCH was executed
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/rest/v1/printers?id=eq.${printerId}`),
        expect.objectContaining({
          method: 'PATCH'
        })
      );
    });

    it('clears default on other shop printers when setting a new default printer', async () => {
      await service.updatePrinterAssignment({
        printer_id: printerId,
        shop_id: shopId,
        device_id: deviceId,
        is_default: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/rest/v1/printers?shop_id=eq.${shopId}&id=neq.${printerId}`),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ is_default: false })
        })
      );
    });
  });

  describe('Tenant Isolation & Forbidden Cross-Shop Assignments', () => {
    it('strictly rejects assigning a device that belongs to another shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: ownerId }]
          } as Response;
        }

        if (url.includes('/rest/v1/agent_devices?id=eq.')) {
          // Device belongs to OTHER shop!
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'device-other-shop',
                shop_id: '00000000-0000-0000-0000-999999999999',
                device_name: 'Foreign-PC',
                is_revoked: false
              }
            ]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new PrinterService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.updatePrinterAssignment({
          printer_id: printerId,
          shop_id: shopId,
          device_id: 'device-other-shop'
        })
      ).rejects.toThrow('Cannot assign device Foreign-PC belonging to another shop');
    });

    it('rejects assignment if the device is revoked', async () => {
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
                device_name: 'Compromised-PC',
                is_revoked: true
              }
            ]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new PrinterService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.updatePrinterAssignment({
          printer_id: printerId,
          shop_id: shopId,
          device_id: deviceId
        })
      ).rejects.toThrow('Cannot assign printer to revoked agent device Compromised-PC');
    });

    it('rejects assignment if the user does not own the shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: 'another-user-uuid' }]
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new PrinterService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.updatePrinterAssignment({
          printer_id: printerId,
          shop_id: shopId,
          device_id: deviceId
        })
      ).rejects.toThrow('Unauthorized: Current user does not own this shop');
    });
  });

  describe('Capability Change Alert Detection', () => {
    it('detects when hardware duplex support is dropped by the driver', () => {
      const prev: DriverCapabilities = {
        paper_sizes: ['a4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 99
      };
      const curr: DriverCapabilities = {
        paper_sizes: ['a4'],
        color_modes: ['bw'],
        duplex_supported: false,
        max_copies: 99
      };

      const diff = detectCapabilityDifferences(prev, curr);
      expect(diff.hasDifferences).toBe(true);
      expect(diff.changes).toContain('Hardware duplex unit offline or disabled in Windows driver');
    });

    it('detects when color support is dropped', () => {
      const prev: DriverCapabilities = {
        paper_sizes: ['a4'],
        color_modes: ['bw', 'color'],
        duplex_supported: true,
        max_copies: 99
      };
      const curr: DriverCapabilities = {
        paper_sizes: ['a4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 99
      };

      const diff = detectCapabilityDifferences(prev, curr);
      expect(diff.hasDifferences).toBe(true);
      expect(diff.changes).toContain('Color printing capability dropped by printer driver');
    });

    it('returns no differences when capabilities are identical', () => {
      const prev: DriverCapabilities = {
        paper_sizes: ['a4', 'a3'],
        color_modes: ['bw', 'color'],
        duplex_supported: true,
        max_copies: 99
      };
      const curr: DriverCapabilities = {
        paper_sizes: ['a4', 'a3'],
        color_modes: ['bw', 'color'],
        duplex_supported: true,
        max_copies: 99
      };

      const diff = detectCapabilityDifferences(prev, curr);
      expect(diff.hasDifferences).toBe(false);
      expect(diff.changes).toHaveLength(0);
    });
  });
});
