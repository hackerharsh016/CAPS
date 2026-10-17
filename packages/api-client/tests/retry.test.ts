import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiServerError } from '../src/index.js';

describe('ApiClient Idempotent Retry Policy', () => {
  it('retries idempotent GET request on transient 503 and succeeds on retry', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response(
          JSON.stringify({ error: { code: 'PRINTER_OFFLINE', message: 'Temporary overload' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ success: true, count: 42 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      fetch: mockFetch
    });

    const result = await client.get<{ success: boolean; count: number }>('shops');
    expect(result.success).toBe(true);
    expect(result.count).toBe(42);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when maxRetries is reached', async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Persistent outage' }
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      maxRetries: 2,
      baseDelayMs: 5,
      maxDelayMs: 15,
      fetch: mockFetch
    });

    await expect(client.get('shops')).rejects.toThrow(ApiServerError);
    // Initial attempt (1) + 2 retries = 3 calls total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('NEVER retries non-idempotent POST without idempotencyKey (safety protection)', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Transient database hitch' }
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      maxRetries: 3,
      baseDelayMs: 5,
      fetch: mockFetch
    });

    // Plain POST without idempotency key
    await expect(client.post('payments/charge', { amount: 500 })).rejects.toThrow(ApiServerError);

    // MUST NOT RETRY: Exactly 1 call attempted to prevent duplicate billing
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('DOES retry POST when explicit idempotencyKey is supplied', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'PRINTER_OFFLINE', message: 'Spooler restarted' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ order_id: 'ord-123', status: 'created' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      maxRetries: 3,
      baseDelayMs: 5,
      fetch: mockFetch
    });

    const result = await client.post<{ order_id: string; status: string }>(
      'jobs',
      { doc_key: 'doc-abc' },
      { idempotencyKey: 'idem-key-uuid-1122' }
    );

    expect(result.order_id).toBe('ord-123');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-key-uuid-1122');
  });

  it('does NOT retry non-retryable 4xx client errors on idempotent GET', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      maxRetries: 3,
      baseDelayMs: 5,
      fetch: mockFetch
    });

    await expect(client.get('shops/missing-shop')).rejects.toThrow('Not found');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
