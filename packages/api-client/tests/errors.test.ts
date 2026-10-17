import { describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  ApiClientError,
  ApiConflictError,
  ApiNotFoundError,
  ApiServerError,
  ApiValidationError,
  isApiClientError
} from '../src/index.js';

describe('ApiClient Error Taxonomy Mapping', () => {
  it('parses structured error fields: code, message, requestId, details', async () => {
    const errorPayload = {
      error: {
        code: 'CAPABILITIES_MISMATCH',
        message: 'Printer cannot handle color',
        request_id: 'req-tax-01',
        details: { printer_id: 'p1', requested: 'color' }
      }
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorPayload), {
        status: 422,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    try {
      await client.post('jobs', { settings: { color_mode: 'color' } });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(isApiClientError(err)).toBe(true);
      expect(err).toBeInstanceOf(ApiValidationError);
      const valErr = err as ApiValidationError;
      expect(valErr.status).toBe(422);
      expect(valErr.code).toBe('CAPABILITIES_MISMATCH');
      expect(valErr.message).toBe('Printer cannot handle color');
      expect(valErr.requestId).toBe('req-tax-01');
      expect(valErr.details).toEqual({ printer_id: 'p1', requested: 'color' });
    }
  });

  it('maps 404 to ApiNotFoundError', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Job not found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    await expect(client.get('jobs/unknown-id')).rejects.toThrow(ApiNotFoundError);
  });

  it('maps 409 to ApiConflictError for lease expiry and already-claimed errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'JOB_ALREADY_CLAIMED',
            message: 'Another agent holds the lease'
          }
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    await expect(client.post('agent/jobs/claim', {})).rejects.toThrow(ApiConflictError);
  });

  it('maps 500 to ApiServerError', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Database connection failed'
          }
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      fetch: mockFetch
    });

    await expect(client.get('health')).rejects.toThrow(ApiServerError);
  });

  it('handles non-JSON error responses gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    const client = new ApiClient({
      baseUrl: 'https://api.caps.internal/api/v1',
      maxRetries: 0,
      fetch: mockFetch
    });

    try {
      await client.get('health');
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      expect(isApiClientError(err)).toBe(true);
      const apiErr = err as ApiClientError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.message).toContain('502');
    }
  });
});
