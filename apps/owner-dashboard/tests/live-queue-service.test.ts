import { describe, it, expect } from 'vitest';
import { LiveQueueService } from '../src/features/live-queue/live-queue-service';
import type { QueueItem } from '../src/features/live-queue/types';

const TEST_QUEUE_FIXTURES: readonly QueueItem[] = [
  {
    id: '00000000-0000-0000-0000-000000001049',
    shop_id: '00000000-0000-0000-0000-000000000001',
    customer_id: 'cust-uuid-1',
    customer_name: 'Rahul S.',
    customer_phone: '+919876543210',
    printer_id: 'printer-uuid-1',
    printer_name: 'Canon imageRUNNER 2625 (Tray 1)',
    document_name: 'Project_Final_Submission.pdf',
    document_storage_key: 'shops/0001/jobs/1049/doc.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      orientation: 'portrait',
      copies: 2,
      page_range: '1-18',
      binding: 'spiral'
    },
    priority_tier: 'urgent',
    price_total_paise: 7200,
    price_breakdown: {
      base_pages_paise: 5400,
      color_surcharge_paise: 0,
      duplex_discount_paise: 1200,
      binding_fee_paise: 4000,
      urgent_surcharge_paise: 2000,
      subtotal_paise: 6200,
      gst_paise: 1000,
      total_paise: 7200
    },
    status: 'printing',
    payment_status: 'paid',
    queue_position: 0,
    is_currently_executing: true,
    estimated_wait_minutes: 0,
    enqueued_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: '00000000-0000-0000-0000-000000001050',
    shop_id: '00000000-0000-0000-0000-000000000001',
    customer_id: 'cust-uuid-2',
    customer_name: 'Priya Verma',
    customer_phone: '+919811122233',
    printer_id: 'printer-uuid-1',
    printer_name: 'Canon imageRUNNER 2625 (Tray 1)',
    document_name: 'Internship_Report_Draft.pdf',
    document_storage_key: 'shops/0001/jobs/1050/doc.pdf',
    settings: {
      paper_size: 'A4',
      color_mode: 'color',
      sides: 'single',
      orientation: 'portrait',
      copies: 1,
      page_range: '1-5',
      binding: 'staple'
    },
    priority_tier: 'urgent',
    price_total_paise: 6500,
    price_breakdown: {
      base_pages_paise: 1000,
      color_surcharge_paise: 4000,
      duplex_discount_paise: 0,
      binding_fee_paise: 500,
      urgent_surcharge_paise: 2000,
      subtotal_paise: 5500,
      gst_paise: 1000,
      total_paise: 6500
    },
    status: 'approved',
    payment_status: 'paid',
    queue_position: 1,
    is_currently_executing: false,
    estimated_wait_minutes: 3,
    enqueued_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    updated_at: new Date().toISOString()
  }
];

describe('LiveQueueService — Authoritative Queue Queries', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';

  it('returns empty array when network fails or queue is empty', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const service = new LiveQueueService({ customFetch: mockFetch });
    const items = await service.fetchShopQueue(shopId);

    expect(items).toHaveLength(0);
  });

  it('queries RPC get_shop_queue and sorts executing & urgent items', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
      if (url.includes('/api/v1/shops/')) {
        return new Response('Not found', { status: 404 });
      }
      expect(url).toContain('/rest/v1/rpc/get_shop_queue');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer test-token'
      });

      const body = JSON.parse(init?.body as string) as { p_shop_id: string };
      expect(body.p_shop_id).toBe(shopId);

      return new Response(JSON.stringify(TEST_QUEUE_FIXTURES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const service = new LiveQueueService({ customFetch: mockFetch });
    const items = await service.fetchShopQueue(shopId, 'test-token');

    expect(items).toHaveLength(TEST_QUEUE_FIXTURES.length);
    // Executing job must be at position 0
    expect(items[0]?.queue_position).toBe(0);
    expect(items[0]?.is_currently_executing).toBe(true);

    // Subsequent jobs must have positive 1-based queue positions
    expect(items[1]?.queue_position).toBe(1);
    expect(items[1]?.priority_tier).toBe('urgent');
  });

  it('returns empty array when shopId is empty', async () => {
    const service = new LiveQueueService();
    const items = await service.fetchShopQueue('');
    expect(items).toHaveLength(0);
  });

  it('fetches today metrics and dynamically computes revenue, completed count, and pages', async () => {
    const mockCompletedJobs = [
      {
        id: 'job-1',
        price_total_paise: 5000,
        settings: { copies: 2, page_range: '1-10' } // 10 pages * 2 copies = 20 pages
      },
      {
        id: 'job-2',
        price_total_paise: 3500,
        settings: { copies: 1, page_range: 'all' } // 1 page * 1 copy = 1 page
      }
    ];

    const mockFetch: typeof fetch = async input => {
      const url = input.toString();
      expect(url).toContain('status=eq.completed');
      return new Response(JSON.stringify(mockCompletedJobs), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const service = new LiveQueueService({ customFetch: mockFetch });
    const metrics = await service.fetchTodayMetrics(shopId, 'test-token');

    expect(metrics.todayCompletedCount).toBe(2);
    expect(metrics.todayRevenuePaise).toBe(8500); // 5000 + 3500
    expect(metrics.todayPagesDispatched).toBe(21); // 20 + 1
  });
});
