import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateQueueEligibility,
  clearIdempotencyCache,
  PrintConfirmationError,
  PrintConfirmationService
} from '../src/features/print-confirmation/confirmation-service';
import type { QueueItem } from '../src/features/live-queue/types';

// Mock getSupabaseBrowserClient
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

describe('Print Confirmation Service', () => {
  const shopId = 'shop-test-123';
  const ownerId = 'user-owner-123';

  const mockQueue: QueueItem[] = [
    {
      id: 'job-urgent-1',
      shop_id: shopId,
      customer_id: 'cust-uuid-1',
      customer_name: 'Aarav Patel',
      customer_phone: '+919876543210',
      document_name: 'UrgentDoc.pdf',
      document_storage_key: 'shops/123/jobs/urgent/doc.pdf',
      priority_tier: 'urgent',
      payment_status: 'paid',
      price_total_paise: 7500,
      price_breakdown: {
        base_pages_paise: 5000,
        color_surcharge_paise: 0,
        duplex_discount_paise: 0,
        binding_fee_paise: 500,
        urgent_surcharge_paise: 2000,
        subtotal_paise: 6500,
        gst_paise: 1000,
        total_paise: 7500
      },
      status: 'queued',
      enqueued_at: '2026-10-21T10:00:00Z',
      created_at: '2026-10-21T10:00:00Z',
      updated_at: '2026-10-21T10:00:00Z',
      queue_position: 1,
      estimated_wait_minutes: 2,
      is_currently_executing: false,
      settings: {
        paper_size: 'A4',
        color_mode: 'color',
        sides: 'double',
        orientation: 'portrait',
        copies: 1,
        page_range: '1-10',
        binding: 'staple'
      }
    },
    {
      id: 'job-fifo-2',
      shop_id: shopId,
      customer_id: 'cust-uuid-2',
      customer_name: 'Diya Sharma',
      customer_phone: '+919876543211',
      document_name: 'FifoDoc1.pdf',
      document_storage_key: 'shops/123/jobs/fifo1/doc.pdf',
      priority_tier: 'flexible',
      payment_status: 'paid',
      price_total_paise: 2500,
      price_breakdown: {
        base_pages_paise: 2500,
        color_surcharge_paise: 0,
        duplex_discount_paise: 0,
        binding_fee_paise: 0,
        urgent_surcharge_paise: 0,
        subtotal_paise: 2100,
        gst_paise: 400,
        total_paise: 2500
      },
      status: 'queued',
      enqueued_at: '2026-10-21T09:50:00Z',
      created_at: '2026-10-21T09:50:00Z',
      updated_at: '2026-10-21T09:50:00Z',
      queue_position: 2,
      estimated_wait_minutes: 5,
      is_currently_executing: false,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'single',
        orientation: 'portrait',
        copies: 1,
        page_range: 'all',
        binding: 'none'
      }
    },
    {
      id: 'job-fifo-3',
      shop_id: shopId,
      customer_id: 'cust-uuid-3',
      customer_name: 'Rahul Varma',
      document_name: 'FifoDoc2.pdf',
      document_storage_key: 'shops/123/jobs/fifo2/doc.pdf',
      priority_tier: 'flexible',
      payment_status: 'pay_at_counter_pending',
      price_total_paise: 1000,
      price_breakdown: {
        base_pages_paise: 1000,
        color_surcharge_paise: 0,
        duplex_discount_paise: 0,
        binding_fee_paise: 0,
        urgent_surcharge_paise: 0,
        subtotal_paise: 850,
        gst_paise: 150,
        total_paise: 1000
      },
      status: 'queued',
      enqueued_at: '2026-10-21T09:55:00Z',
      created_at: '2026-10-21T09:55:00Z',
      updated_at: '2026-10-21T09:55:00Z',
      queue_position: 3,
      estimated_wait_minutes: 8,
      is_currently_executing: false,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'single',
        orientation: 'portrait',
        copies: 1,
        page_range: 'all',
        binding: 'none'
      }
    }
  ];

  let mockFetch: ReturnType<typeof vi.fn>;
  let service: PrintConfirmationService;

  beforeEach(() => {
    vi.clearAllMocks();
    clearIdempotencyCache();

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
          json: async () => [{ id: 'job-urgent-1', shop_id: shopId, status: 'queued' }]
        } as Response;
      }

      if (url.includes('/rest/v1/rpc/approve_print_job')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({})
      } as Response;
    });

    service = new PrintConfirmationService({
      customFetch: mockFetch as unknown as typeof fetch
    });
  });

  describe('Queue Order Validation', () => {
    it('approves eligible next job (urgent tier at head of queue)', () => {
      const result = validateQueueEligibility('job-urgent-1', mockQueue);
      expect(result.eligible).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects wrong-order attempt (attempting to confirm job #2 while job #1 is waiting)', () => {
      const result = validateQueueEligibility('job-fifo-2', mockQueue);
      expect(result.eligible).toBe(false);
      expect(result.error).toBeInstanceOf(PrintConfirmationError);
      expect(result.error?.code).toBe('WRONG_QUEUE_ORDER');
      expect(result.error?.expectedJobId).toBe('job-urgent-1');
    });

    it('rejects wrong-order attempt for job #3', () => {
      const result = validateQueueEligibility('job-fifo-3', mockQueue);
      expect(result.eligible).toBe(false);
      expect(result.error?.code).toBe('WRONG_QUEUE_ORDER');
      expect(result.error?.expectedJobId).toBe('job-urgent-1');
    });

    it('rejects confirmation if no queued jobs are present', () => {
      const executingOnlyQueue: QueueItem[] = [
        {
          ...mockQueue[0]!,
          status: 'printing',
          is_currently_executing: true
        }
      ];
      const result = validateQueueEligibility('job-urgent-1', executingOnlyQueue);
      expect(result.eligible).toBe(false);
      expect(result.error?.code).toBe('INVALID_JOB_STATUS');
    });
  });

  describe('Happy Path One-Tap Confirmation', () => {
    it('successfully confirms the head job and returns response with timestamp and idempotencyKey', async () => {
      const response = await service.confirmPrintJob(
        {
          jobId: 'job-urgent-1',
          shopId,
          idempotencyKey: 'idem-test-123'
        },
        mockQueue
      );

      expect(response.success).toBe(true);
      expect(response.jobId).toBe('job-urgent-1');
      expect(response.status).toBe('approved');
      expect(response.idempotencyKey).toBe('idem-test-123');
      expect(response.confirmedAt).toBeDefined();
    });
  });

  describe('Idempotency & Double-Click Protection', () => {
    it('returns cached response and prevents duplicate network operations when replaying idempotency key', async () => {
      const response1 = await service.confirmPrintJob(
        {
          jobId: 'job-urgent-1',
          shopId,
          idempotencyKey: 'idem-duplicate-key'
        },
        mockQueue
      );

      expect(response1.success).toBe(true);
      const initialCallCount = mockFetch.mock.calls.length;

      // Repeat identical call with identical idempotency key
      const response2 = await service.confirmPrintJob(
        {
          jobId: 'job-urgent-1',
          shopId,
          idempotencyKey: 'idem-duplicate-key'
        },
        mockQueue
      );

      expect(response2.success).toBe(true);
      expect(response2).toEqual(response1);
      // Backend fetch was not called again
      expect(mockFetch.mock.calls.length).toBe(initialCallCount);
    });

    it('handles already approved jobs idempotently', async () => {
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
            json: async () => [{ id: 'job-urgent-1', shop_id: shopId, status: 'approved' }]
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({})
        } as Response;
      });

      const svc = new PrintConfirmationService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      const response = await svc.confirmPrintJob({
        jobId: 'job-urgent-1',
        shopId,
        idempotencyKey: 'idem-already-approved'
      });

      expect(response.success).toBe(true);
      expect(response.status).toBe('approved');
      expect(response.message).toContain('already confirmed');
    });
  });

  describe('Tenant Isolation & Unauthorized Cross-Shop Attempts', () => {
    it('rejects confirmation if current user is not the owner of the shop', async () => {
      mockFetch = vi.fn(async (url: string) => {
        if (url.includes('/rest/v1/shops')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: shopId, owner_id: 'some-other-owner' }]
          } as Response;
        }
        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new PrintConfirmationService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.confirmPrintJob({
          jobId: 'job-urgent-1',
          shopId,
          idempotencyKey: 'idem-unauthorized'
        })
      ).rejects.toThrow('Unauthorized: Current user does not own this shop.');
    });

    it('rejects confirmation if the job belongs to another shop', async () => {
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
            json: async () => [{ id: 'job-foreign', shop_id: 'other-shop-999', status: 'queued' }]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new PrintConfirmationService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.confirmPrintJob({
          jobId: 'job-foreign',
          shopId,
          idempotencyKey: 'idem-foreign'
        })
      ).rejects.toThrow('Print job job-foreign belongs to another shop.');
    });

    it('rejects confirmation if auth session is unauthenticated', async () => {
      mockGetSession.mockResolvedValue(null);

      await expect(
        service.confirmPrintJob({
          jobId: 'job-urgent-1',
          shopId,
          idempotencyKey: 'idem-noauth'
        })
      ).rejects.toThrow('User session is invalid or unauthenticated.');
    });
  });

  describe('Invalid Job Status Rejection', () => {
    it('rejects confirmation if job is in cancelled or failed status', async () => {
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
            json: async () => [{ id: 'job-cancelled', shop_id: shopId, status: 'cancelled' }]
          } as Response;
        }

        return { ok: true, status: 200, json: async () => [] } as Response;
      });

      const svc = new PrintConfirmationService({
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        svc.confirmPrintJob({
          jobId: 'job-cancelled',
          shopId,
          idempotencyKey: 'idem-cancelled'
        })
      ).rejects.toThrow(
        "Print job job-cancelled is in status 'cancelled' and cannot be confirmed."
      );
    });
  });
});
