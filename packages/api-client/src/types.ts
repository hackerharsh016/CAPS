export type TokenProvider = string | (() => string | null | Promise<string | null>);

export interface ApiClientConfig {
  /**
   * Base URL of the CAPS Cloud API (e.g. 'https://api.caps.internal/api/v1' or 'http://127.0.0.1:4000/api/v1').
   */
  baseUrl: string;

  /**
   * Optional bearer token or dynamic asynchronous token supplier (e.g. Supabase session token).
   */
  tokenProvider?: TokenProvider | undefined;

  /**
   * Optional custom fetch implementation (defaults to global fetch).
   */
  fetch?: typeof fetch | undefined;

  /**
   * Maximum number of retry attempts for idempotent operations (default: 3).
   */
  maxRetries?: number | undefined;

  /**
   * Initial exponential backoff delay in milliseconds (default: 200ms).
   */
  baseDelayMs?: number | undefined;

  /**
   * Maximum backoff delay cap in milliseconds (default: 2000ms).
   */
  maxDelayMs?: number | undefined;

  /**
   * Request timeout in milliseconds (default: 15000ms).
   */
  timeoutMs?: number | undefined;

  /**
   * Default headers included on all requests.
   */
  defaultHeaders?: Record<string, string> | undefined;
}

export interface RequestOptions {
  /**
   * HTTP Method (GET, POST, PUT, DELETE, etc.)
   */
  method?: string | undefined;

  /**
   * URL query parameters.
   */
  query?: Record<string, string | number | boolean | undefined | null> | undefined;

  /**
   * Additional or overriding request headers.
   */
  headers?: Record<string, string> | undefined;

  /**
   * Request body (will be serialized to JSON unless FormData).
   */
  body?: unknown;

  /**
   * Unique idempotency key sent via the 'Idempotency-Key' header.
   */
  idempotencyKey?: string | undefined;

  /**
   * Explicitly declare the request idempotent for retry evaluation.
   */
  idempotent?: boolean | undefined;

  /**
   * Skip bearer authentication header propagation even if token is configured.
   */
  skipAuth?: boolean | undefined;

  /**
   * Optional AbortSignal for cancellation.
   */
  signal?: AbortSignal | undefined;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}
