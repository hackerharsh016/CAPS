import type {
  CreatePrintJobInput,
  JobStatus,
  PrintJob,
  QuoteRequest,
  QuoteResponse,
  Shop,
  Printer,
  JobClaimRequest,
  JobClaimResponse,
  JobStatusUpdateRequest,
  JobStatusUpdateResponse,
  AgentHeartbeatResponse
} from '@caps/types';
import { ApiClientError, ApiNetworkError, parseApiError } from './errors.js';
import { calculateBackoffDelay, isIdempotentRequest, isRetryableError, sleep } from './retry.js';
import type { ApiClientConfig, RequestOptions } from './types.js';

export interface AgentCapabilitiesReport {
  contract_version: string;
  agent_device_id: string;
  agent_version: string;
  shop_id: string;
  printers: Array<{
    printer_id: string;
    name: string;
    is_default: boolean;
    status: 'online' | 'offline' | 'busy' | 'error';
    supported_paper_sizes: string[];
    supported_color_modes: string[];
    supported_duplex: string[];
    last_seen_at?: string;
  }>;
  reported_at: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly config: ApiClientConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ApiClientConfig) {
    if (!config.baseUrl) {
      throw new Error('ApiClientConfig: baseUrl is required.');
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.config = config;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  /**
   * Resolves the authentication bearer token if configured.
   */
  private async getAuthToken(): Promise<string | null> {
    if (!this.config.tokenProvider) return null;
    if (typeof this.config.tokenProvider === 'function') {
      return await this.config.tokenProvider();
    }
    return this.config.tokenProvider;
  }

  /**
   * Core request dispatcher with auth injection, error taxonomy mapping, and idempotent retry.
   */
  public async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, '')}`);

    // Append query parameters
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelayMs = this.config.baseDelayMs ?? 200;
    const maxDelayMs = this.config.maxDelayMs ?? 2000;
    const timeoutMs = this.config.timeoutMs ?? 15000;
    const isIdempotent = isIdempotentRequest(options);

    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      // Link external abort signal if provided
      const externalSignal = options.signal;
      const onExternalAbort = () => controller.abort(externalSignal?.reason);
      if (externalSignal) {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          ...this.config.defaultHeaders,
          ...options.headers
        };

        // Attach Authorization header if token exists and skipAuth is not true
        if (!options.skipAuth) {
          const token = await this.getAuthToken();
          if (token && !headers['Authorization']) {
            headers['Authorization'] = `Bearer ${token}`;
          }
        }

        // Attach Idempotency-Key if provided
        if (options.idempotencyKey) {
          headers['Idempotency-Key'] = options.idempotencyKey;
        }

        let body: BodyInit | undefined;
        if (options.body !== undefined && options.body !== null) {
          if (
            typeof options.body === 'string' ||
            options.body instanceof FormData ||
            options.body instanceof Blob ||
            options.body instanceof ArrayBuffer
          ) {
            body = options.body as BodyInit;
          } else {
            body = JSON.stringify(options.body);
            headers['Content-Type'] = 'application/json';
          }
        }

        const requestInit: RequestInit = {
          method: options.method ?? 'GET',
          headers,
          signal: controller.signal
        };
        if (body !== undefined) {
          requestInit.body = body;
        }

        const response = await this.fetchImpl(url.toString(), requestInit);

        // Parse response content
        const contentType = response.headers.get('content-type') ?? '';
        let responseBody: unknown;
        if (contentType.includes('application/json')) {
          responseBody = await response.json();
        } else {
          const text = await response.text();
          responseBody = text.length > 0 ? text : null;
        }

        if (!response.ok) {
          throw parseApiError(response.status, responseBody);
        }

        return responseBody as T;
      } catch (err: unknown) {
        let errorToHandle: ApiClientError;
        if (err instanceof ApiClientError) {
          errorToHandle = err;
        } else if (err instanceof Error && err.name === 'AbortError') {
          errorToHandle = new ApiNetworkError(`Request aborted: ${err.message}`, err);
        } else if (err instanceof Error) {
          errorToHandle = new ApiNetworkError(`Network request failed: ${err.message}`, err);
        } else {
          errorToHandle = new ApiNetworkError('Unknown network failure occurred');
        }

        const shouldRetry = isIdempotent && isRetryableError(errorToHandle) && attempt < maxRetries;

        if (shouldRetry) {
          const delay = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs);
          attempt++;
          await sleep(delay, options.signal);
          continue;
        }

        throw errorToHandle;
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      }
    }
  }

  // Convenient HTTP helpers
  public get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  public post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  public put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  public delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  // Typed Domain Endpoints
  public readonly health = {
    check: (): Promise<{ status: string; service: string; timestamp: string; uptime: number }> => {
      return this.get('health', { skipAuth: true, idempotent: true });
    }
  };

  public readonly quotes = {
    getQuote: (request: QuoteRequest): Promise<QuoteResponse> => {
      return this.post('quotes', request, { idempotent: true });
    }
  };

  public readonly jobs = {
    create: (
      input: CreatePrintJobInput,
      options?: { idempotencyKey?: string }
    ): Promise<PrintJob> => {
      return this.post('jobs', input, {
        idempotencyKey: options?.idempotencyKey
      });
    },
    get: (jobId: string): Promise<PrintJob> => {
      return this.get(`jobs/${encodeURIComponent(jobId)}`, { idempotent: true });
    },
    getStatus: (
      jobId: string
    ): Promise<{ job_id: string; status: JobStatus; progress_pages?: number }> => {
      return this.get(`jobs/${encodeURIComponent(jobId)}/status`, { idempotent: true });
    }
  };

  public readonly shops = {
    list: (): Promise<Shop[]> => {
      return this.get('shops', { idempotent: true });
    },
    get: (shopId: string): Promise<Shop> => {
      return this.get(`shops/${encodeURIComponent(shopId)}`, { idempotent: true });
    }
  };

  public readonly printers = {
    list: (shopId: string): Promise<Printer[]> => {
      return this.get(`shops/${encodeURIComponent(shopId)}/printers`, { idempotent: true });
    },
    get: (printerId: string): Promise<Printer> => {
      return this.get(`printers/${encodeURIComponent(printerId)}`, { idempotent: true });
    }
  };

  public readonly agent = {
    heartbeat: (payload: AgentCapabilitiesReport): Promise<AgentHeartbeatResponse> => {
      return this.post('agent/heartbeat', payload, { idempotent: true });
    },
    claim: (payload: JobClaimRequest): Promise<JobClaimResponse> => {
      // Job claim alters state and acquires lease; not retryable without explicit attempt handling
      return this.post('agent/jobs/claim', payload, { idempotent: false });
    },
    updateStatus: (
      jobId: string,
      payload: JobStatusUpdateRequest,
      options?: { idempotencyKey?: string }
    ): Promise<JobStatusUpdateResponse> => {
      return this.post(`agent/jobs/${encodeURIComponent(jobId)}/status`, payload, {
        idempotencyKey: options?.idempotencyKey
      });
    }
  };
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}
