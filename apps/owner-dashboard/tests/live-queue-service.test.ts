import { describe, it, expect } from 'vitest';
import { LiveQueueService, DEMO_QUEUE_FIXTURES } from '../src/features/live-queue/live-queue-service';

describe('LiveQueueService — Authoritative Queue Queries', () => {
  const shopId = '00000000-0000-0000-0000-000000000001';

  it('returns sorted and prioritized demo queue items in mock environment', async () => {
    const service = new LiveQueueService();
    const items = await service.fetchShopQueue(shopId);

    expect(items.length).toBeGreaterThan(0);
    // Executing job must be at position 0
    expect(items[0]?.queue_position).toBe(0);
    expect(items[0]?.is_currently_executing).toBe(true);

    // Subsequent jobs must have positive 1-based queue positions
    expect(items[1]?.queue_position).toBe(1);
    expect(items[1]?.priority_tier).toBe('urgent');
  });

  it('queries RPC get_shop_queue with proper payload and auth headers', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
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
  });

  it('returns empty array when shopId is empty', async () => {
    const service = new LiveQueueService();
    const items = await service.fetchShopQueue('');
    expect(items).toHaveLength(0);
  });
});
