import { ApiClientError, ApiNetworkError } from './errors.js';
import type { RequestOptions } from './types.js';

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export function isIdempotentRequest(options: RequestOptions): boolean {
  if (options.idempotent === true) return true;
  if (options.idempotent === false) return false;
  if (options.idempotencyKey && options.idempotencyKey.trim().length > 0) return true;
  const method = (options.method ?? 'GET').toUpperCase();
  return IDEMPOTENT_METHODS.has(method);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiNetworkError) {
    return true;
  }
  if (error instanceof ApiClientError) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return true;
  }
  return false;
}

export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs = 200,
  maxDelayMs = 2000
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(maxDelayMs, Math.round(exponential + jitter));
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
