import { describe, expect, it, vi } from 'vitest';
import { ApiClient, createApiClient } from '../src/index.js';

describe('ApiClient Core Operations', () => {
  it('instantiates successfully with valid configuration', () => {
    const client = createApiClient({ baseUrl: 'https://api.caps.internal/api/v1' });
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('throws an error if baseUrl is missing', () => {
    expect(() => createApiClient({ baseUrl: '' })).toThrow('baseUrl is required');
  });

  it('executes GET request with correct URL and headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', uptime: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    const data = await client.get<{ status: string; uptime: number }>('health');
    expect(data.status).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://api.caps.internal/api/v1/health');
    expect(calledInit.method).toBe('GET');
  });

  it('appends query parameters cleanly', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    await client.get('shops', { query: { active: true, page: 2, filter: null } });

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://api.caps.internal/api/v1/shops?active=true&page=2');
  });

  it('serializes JSON body and sets Content-Type on POST requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ quote_id: 'q123', final_price_paise: 500 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    const payload = { page_count: 5, copies: 1 };
    await client.post('quotes', payload);

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledInit.method).toBe('POST');
    expect(calledInit.body).toBe(JSON.stringify(payload));
    expect((calledInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
