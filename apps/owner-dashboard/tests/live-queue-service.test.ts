import { describe, it, expect } from 'vitest';
import {
  LiveQueueService,
  DEMO_QUEUE_FIXTURES
} from '../src/features/live-queue/live-queue-service';

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

      return new Response(JSON.stringify(DEMO_QUEUE_FIXTURES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const service = new LiveQueueService({ customFetch: mockFetch });
    const items = await service.fetchShopQueue(shopId, 'test-token');

    expect(items).toHaveLength(DEMO_QUEUE_FIXTURES.length);
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
