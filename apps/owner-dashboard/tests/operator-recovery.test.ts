import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  OperatorRecoveryService,
  OperatorRecoveryError
} from '../src/features/agent-monitoring/operator-recovery-service';

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

describe('Operator Recovery Service & Error Handling', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';
  const ownerId = 'user-owner-uuid-1';
  const ambiguousJobId = '00000000-0000-0000-0000-000000001055';

  let mockFetch: ReturnType<typeof vi.fn>;
  let service: OperatorRecoveryService;

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

      if (url.includes('/rest/v1/print_jobs?id=eq.')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: ambiguousJobId, shop_id: shopId, status: 'requires_review' }]
        } as Response;
      }

      if (url.includes('/rest/v1/rpc/resolve_unresolved_job')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            job_id: ambiguousJobId,
            previous_status: 'requires_review',
            new_status: 'approved',
            resolved_at: new Date().toISOString()
          })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({})
      } as Response;
    });

    service = new OperatorRecoveryService({
      customFetch: mockFetch as unknown as typeof fetch
    });
  });

  describe('Non-Negotiable Rule: No Automatic Reprint for Ambiguous Print Execution', () => {
    it('strictly rejects retry request when physical evidence check is not confirmed', async () => {
      await expect(
        service.resolveUnresolvedJob({
          jobId: ambiguousJobId,
          shopId,
          resolution: 'retry',
          physicalEvidenceConfirmed: false,
          notes: 'Attempting retry without inspecting output tray'
        })
      ).rejects.toThrow(
        'Physical paper tray and output check is mandatory before confirming job retry or completion. Never auto-reprint without inspection.'
      );
    });

    it('strictly rejects mark_completed request when physical evidence check is not confirmed', async () => {
      await expect(
        service.resolveUnresolvedJob({
          jobId: ambiguousJobId,
          shopId,
          resolution: 'mark_completed',
          physicalEvidenceConfirmed: false
        })
      ).rejects.toThrow(OperatorRecoveryError);
    });

    it('permits cancel request even without physical evidence check (e.g. abort and refund)', async () => {
      const response = await service.resolveUnresolvedJob({
        jobId: ambiguousJobId,
        shopId,
        resolution: 'cancel',
        physicalEvidenceConfirmed: false,
        notes: 'Customer cancelled after hardware stall'
      });

      expect(response.newStatus).toBe('cancelled');
      expect(response.jobId).toBe(ambiguousJobId);
    });
  });

  describe('Authorized Operator Recovery Resolutions', () => {
    it('authorizes controlled re-print when physical inspection confirms sheets were missing/jammed', async () => {
      const response = await service.resolveUnresolvedJob({
        jobId: ambiguousJobId,
        shopId,
        resolution: 'retry',
        physicalEvidenceConfirmed: true,
        notes: 'Inspected tray; 0 sheets printed due to jam. Ready to re-spool.'
      });

      expect(response.newStatus).toBe('approved');
      expect(response.jobId).toBe(ambiguousJobId);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/rest/v1/rpc/resolve_unresolved_job'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('marks completed when physical inspection confirms print job finished successfully', async () => {
      const response = await service.resolveUnresolvedJob({
        jobId: ambiguousJobId,
        shopId,
        resolution: 'mark_completed',
        physicalEvidenceConfirmed: true,
        notes: 'Physically verified all 10 pages in output bin.'
      });

      expect(response.newStatus).toBe('completed');
      expect(response.jobId).toBe(ambiguousJobId);
    });
  });

  describe('Tenant Isolation & Role Guards', () => {
    it('rejects recovery resolution if current user does not own the shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: 'another-owner-uuid' }]
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new OperatorRecoveryService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.resolveUnresolvedJob({
          jobId: ambiguousJobId,
          shopId,
          resolution: 'retry',
          physicalEvidenceConfirmed: true
        })
      ).rejects.toThrow('Unauthorized: Current user does not own this shop.');
    });

    it('rejects recovery if job belongs to a different shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: ownerId }]
          } as Response;
        }

        if (url.includes('/rest/v1/print_jobs?id=eq.')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { id: ambiguousJobId, shop_id: 'other-shop-999', status: 'requires_review' }
            ]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new OperatorRecoveryService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.resolveUnresolvedJob({
          jobId: ambiguousJobId,
          shopId,
          resolution: 'retry',
          physicalEvidenceConfirmed: true
        })
      ).rejects.toThrow('belongs to another shop');
    });

    it('rejects recovery if job is in normal queued/printing status (not requires_review or failed)', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: ownerId }]
          } as Response;
        }

        if (url.includes('/rest/v1/print_jobs?id=eq.')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: ambiguousJobId, shop_id: shopId, status: 'printing' }]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new OperatorRecoveryService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.resolveUnresolvedJob({
          jobId: ambiguousJobId,
          shopId,
          resolution: 'retry',
          physicalEvidenceConfirmed: true
        })
      ).rejects.toThrow("Job 00000000-0000-0000-0000-000000001055 is in status 'printing'");
    });
  });

  describe('Hardware Incident Telemetry & Detection', () => {
    it('correctly maps paper jam, offline, and out-of-paper conditions from printer hardware telemetry', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/printers')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'p-1',
                name: 'Canon IR2625 (Tray 1)',
                status: 'error',
                capabilities: { error_code: 'PAPER_JAM_TRAY1' }
              },
              {
                id: 'p-2',
                name: 'HP LaserJet Pro',
                status: 'offline',
                capabilities: {}
              },
              {
                id: 'p-3',
                name: 'Epson L805 Color',
                status: 'error',
                capabilities: { error_code: 'OUT_OF_PAPER' }
              }
            ]
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new OperatorRecoveryService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      const incidents = await svc.fetchActiveIncidents(shopId);

      expect(incidents).toHaveLength(3);
      expect(incidents[0]?.incidentType).toBe('jam');
      expect(incidents[0]?.severity).toBe('critical');
      expect(incidents[0]?.message).toContain('Paper jam');

      expect(incidents[1]?.incidentType).toBe('offline');
      expect(incidents[1]?.severity).toBe('warning');

      expect(incidents[2]?.incidentType).toBe('out_of_paper');
      expect(incidents[2]?.message).toContain('out of paper');
    });

    it('correctly maps agent device connectivity status based on heartbeat timestamp', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/agent_devices')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                id: 'agent-1',
                device_name: 'Counter-PC-Win11',
                agent_version: '0.1.0',
                is_revoked: false,
                last_heartbeat_at: new Date(Date.now() - 1000 * 30).toISOString() // 30s ago
              }
            ]
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new OperatorRecoveryService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      const status = await svc.fetchAgentDeviceStatus(shopId);
      expect(status).not.toBeNull();
      expect(status?.isOnline).toBe(true);
      expect(status?.deviceName).toBe('Counter-PC-Win11');
    });
  });
});
