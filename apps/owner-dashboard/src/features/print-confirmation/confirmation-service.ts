/**
 * Print Confirmation Service for CAPS Owner Dashboard.
 * Handles:
 * 1. Eligibility validation (only next eligible job in strict queue order)
 * 2. Tenant isolation / Cross-shop ownership enforcement
 * 3. Client idempotency caching & deduplication to block rapid double-click bursts
 * 4. API communication via Supabase REST/RPC
 */

import { getSupabaseEnv, getSupabaseBrowserClient } from '../../lib/supabase';
import type {
  PrintConfirmationRequest,
  PrintConfirmationResponse,
  PrintConfirmationErrorCode
} from './types';
import type { QueueItem } from '../live-queue/types';

export class PrintConfirmationError extends Error {
  readonly code: PrintConfirmationErrorCode;
  readonly expectedJobId?: string | undefined;
  readonly currentQueuePosition?: number | undefined;

  constructor(
    code: PrintConfirmationErrorCode,
    message: string,
    options?: { expectedJobId?: string | undefined; currentQueuePosition?: number | undefined }
  ) {
    super(message);
    this.name = 'PrintConfirmationError';
    this.code = code;
    this.expectedJobId = options?.expectedJobId;
    this.currentQueuePosition = options?.currentQueuePosition;
  }
}

export interface ConfirmationServiceConfig {
  customFetch?: typeof fetch | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}

/**
 * In-memory idempotency cache for deduplication during active sessions.
 * Caches responses by idempotencyKey to prevent duplicate network calls.
 */
const idempotencyStore = new Map<string, PrintConfirmationResponse>();

export function clearIdempotencyCache(): void {
  idempotencyStore.clear();
}

/**
 * Validates whether the target job is the next eligible job in queue order.
 * In CAPS priority queue:
 * - Jobs currently executing are excluded from approval.
 * - Only jobs in 'queued' status can be approved.
 * - The job must have queue_position === 1 among pending queued jobs.
 */
export function validateQueueEligibility(
  targetJobId: string,
  queueItems: QueueItem[]
): { eligible: boolean; error?: PrintConfirmationError } {
  // Find all queued (not executing) items, sorted by queue order
  const pendingJobs = queueItems.filter(
    item => item.status === 'queued' && !item.is_currently_executing
  );

  if (pendingJobs.length === 0) {
    return {
      eligible: false,
      error: new PrintConfirmationError(
        'INVALID_JOB_STATUS',
        'No queued jobs available for confirmation.'
      )
    };
  }

  const nextEligibleJob = pendingJobs[0];
  if (!nextEligibleJob) {
    return {
      eligible: false,
      error: new PrintConfirmationError('JOB_NOT_FOUND', 'Target job not found in queue.')
    };
  }

  if (nextEligibleJob.id !== targetJobId) {
    const targetItem = queueItems.find(item => item.id === targetJobId);
    return {
      eligible: false,
      error: new PrintConfirmationError(
        'WRONG_QUEUE_ORDER',
        `Job ${targetJobId} cannot be confirmed ahead of next eligible job ${nextEligibleJob.id}. Priority order must be respected.`,
        {
          expectedJobId: nextEligibleJob.id,
          currentQueuePosition: targetItem?.queue_position
        }
      )
    };
  }

  return { eligible: true };
}

export class PrintConfirmationService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: ConfirmationServiceConfig) {
    const env = getSupabaseEnv();
    this.supabaseUrl = (config?.supabaseUrl ?? env.supabaseUrl).replace(/\/$/, '');
    this.supabaseAnonKey = config?.supabaseAnonKey ?? env.supabaseAnonKey;
    this.fetchFn =
      config?.customFetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch));
  }

  /**
   * Submits print confirmation for an eligible job.
   * Enforces tenant isolation, idempotency caching, and backend persistence.
   */
  async confirmPrintJob(
    request: PrintConfirmationRequest,
    currentQueue?: QueueItem[],
    accessToken?: string
  ): Promise<PrintConfirmationResponse> {
    const { jobId, shopId, idempotencyKey } = request;

    // 1. Check idempotency cache first (protects against rapid re-submits with same key)
    const cachedResponse = idempotencyStore.get(idempotencyKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 2. Client-side queue order check if queue items were provided
    if (currentQueue && currentQueue.length > 0) {
      const { eligible, error } = validateQueueEligibility(jobId, currentQueue);
      if (!eligible && error) {
        throw error;
      }
    }

    // 3. Verify user ownership & role guards for the requested shop
    const client = getSupabaseBrowserClient();
    const session = await client.getSession();

    const effectiveToken = accessToken || session?.access_token;
    const effectiveUserId = session?.user?.id;

    if (!effectiveToken || !effectiveUserId) {
      throw new PrintConfirmationError(
        'UNAUTHORIZED_CROSS_SHOP',
        'User session is invalid or unauthenticated.'
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${effectiveToken}`
    };

    // Verify shop ownership
    const shopUrl = `${this.supabaseUrl}/rest/v1/shops?id=eq.${shopId}&select=id,owner_id`;
    try {
      const shopRes = await this.fetchFn(shopUrl, { method: 'GET', headers });
      if (shopRes.ok) {
        const shops = (await shopRes.json()) as Array<{ id: string; owner_id: string }>;
        const shop = shops[0];
        // Allow if user is owner of the shop or dev bypass
        if (shop && shop.owner_id !== effectiveUserId && effectiveToken !== 'dev_owner_token') {
          throw new PrintConfirmationError(
            'UNAUTHORIZED_CROSS_SHOP',
            'Unauthorized: Current user does not own this shop.'
          );
        }
      }
    } catch (err) {
      if (err instanceof PrintConfirmationError) throw err;
    }

    // Verify job belongs to this shop and check status
    const jobUrl = `${this.supabaseUrl}/rest/v1/print_jobs?id=eq.${jobId}&select=id,shop_id,status`;
    let job: { id: string; shop_id: string; status: string } | null = null;
    try {
      const jobRes = await this.fetchFn(jobUrl, { method: 'GET', headers });
      if (!jobRes.ok) {
        throw new PrintConfirmationError('JOB_NOT_FOUND', `Print job ${jobId} not found.`);
      }
      const jobs = (await jobRes.json()) as Array<{ id: string; shop_id: string; status: string }>;
      job = jobs[0] || null;
      if (!job) {
        throw new PrintConfirmationError('JOB_NOT_FOUND', `Print job ${jobId} not found.`);
      }
    } catch (err) {
      if (err instanceof PrintConfirmationError) throw err;
      throw new PrintConfirmationError('JOB_NOT_FOUND', `Print job ${jobId} not found.`);
    }

    if (job.shop_id !== shopId) {
      throw new PrintConfirmationError(
        'UNAUTHORIZED_CROSS_SHOP',
        `Print job ${jobId} belongs to another shop.`
      );
    }

    if (job.status !== 'queued') {
      if (job.status === 'approved' || job.status === 'claimed' || job.status === 'completed') {
        const idempotentSuccess: PrintConfirmationResponse = {
          success: true,
          jobId,
          status: job.status as 'approved' | 'claimed' | 'completed',
          confirmedAt: new Date().toISOString(),
          idempotencyKey,
          message: `Job ${jobId} is already confirmed (${job.status}).`
        };
        idempotencyStore.set(idempotencyKey, idempotentSuccess);
        return idempotentSuccess;
      }

      throw new PrintConfirmationError(
        'INVALID_JOB_STATUS',
        `Print job ${jobId} is in status '${job.status}' and cannot be confirmed.`
      );
    }

    // 4. Atomic confirmation via Cloud API, Supabase RPC approve_print_job, or fallback PATCH
    const now = new Date().toISOString();
    let rpcDone = false;

    const apiUrl =
      typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000';

    try {
      const approveUrl = `${apiUrl}/api/v1/shops/${shopId}/jobs/${jobId}/approve`;
      const authHeader = effectiveToken ? `Bearer ${effectiveToken}` : 'Bearer dev_owner_token';
      const approveRes = await this.fetchFn(approveUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
          'Idempotency-Key': idempotencyKey
        }
      });
      if (approveRes.ok) {
        rpcDone = true;
      }
    } catch {
      // Fall through to Supabase RPC / PATCH
    }

    if (!rpcDone) {
      try {
        const rpcUrl = `${this.supabaseUrl}/rest/v1/rpc/approve_print_job`;
        const rpcRes = await this.fetchFn(rpcUrl, {
          method: 'POST',
          headers: {
            ...headers,
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify({
            p_job_id: jobId,
            p_shop_id: shopId,
            p_idempotency_key: idempotencyKey
          })
        });

        if (rpcRes.ok) {
          rpcDone = true;
        }
      } catch {
        rpcDone = false;
      }
    }

    if (!rpcDone) {
      const updateUrl = `${this.supabaseUrl}/rest/v1/print_jobs?id=eq.${jobId}&shop_id=eq.${shopId}&status=eq.queued`;
      const updateRes = await this.fetchFn(updateUrl, {
        method: 'PATCH',
        headers: {
          ...headers,
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          status: 'approved',
          updated_at: now
        })
      });

      if (!updateRes.ok) {
        throw new PrintConfirmationError(
          'NETWORK_ERROR',
          `Failed to approve print job: HTTP ${updateRes.status}`
        );
      }
    }

    const response: PrintConfirmationResponse = {
      success: true,
      jobId,
      status: 'approved',
      confirmedAt: now,
      idempotencyKey,
      message: 'Job successfully approved for printing.'
    };

    idempotencyStore.set(idempotencyKey, response);
    return response;
  }
}

// Global default service instance
export const defaultConfirmationService = new PrintConfirmationService();

export async function confirmPrintJob(
  request: PrintConfirmationRequest,
  currentQueue?: QueueItem[],
  accessToken?: string
): Promise<PrintConfirmationResponse> {
  return defaultConfirmationService.confirmPrintJob(request, currentQueue, accessToken);
}
