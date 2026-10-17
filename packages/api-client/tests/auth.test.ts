import { describe, expect, it, vi } from 'vitest';
import { ApiAuthError, ApiClient } from '../src/index.js';

describe('ApiClient Authentication Propagation', () => {
  it('propagates static Bearer token on outbound requests', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user_id: 'usr-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      tokenProvider: 'static-jwt-token-xyz',
      fetch: mockFetch
    });

    await client.get('users/me');

    const [, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer static-jwt-token-xyz'
    );
  });

  it('invokes dynamic async token provider on each request', async () => {
    let tokenCounter = 1;
    const tokenProvider = vi.fn().mockImplementation(async () => `dynamic-jwt-${tokenCounter++}`);

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      tokenProvider,
      fetch: mockFetch
    });

    await client.get('resource-1');
    await client.get('resource-2');

    expect(tokenProvider).toHaveBeenCalledTimes(2);

    const [, init1] = mockFetch.mock.calls[0] as [string, RequestInit];
    const [, init2] = mockFetch.mock.calls[1] as [string, RequestInit];

    expect((init1.headers as Record<string, string>)['Authorization']).toBe('Bearer dynamic-jwt-1');
    expect((init2.headers as Record<string, string>)['Authorization']).toBe('Bearer dynamic-jwt-2');
  });

  it('omits Authorization header when skipAuth is true', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ public: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      tokenProvider: 'should-not-be-sent',
      fetch: mockFetch
    });

    await client.get('health', { skipAuth: true });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('translates 401 response into typed ApiAuthError', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid session token',
            request_id: 'req-auth-fail-1'
          }
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    await expect(client.get('orders')).rejects.toThrow(ApiAuthError);
  });

  it('translates 403 response into typed ApiAuthError', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not own this shop',
            request_id: 'req-auth-fail-2'
          }
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    await expect(client.get('shop/other-shop/queue')).rejects.toThrow(ApiAuthError);
  });
});
