/**
 * Owner Dashboard Queue API Service (INT-D2-01).
 * Coordinates with backend endpoints:
 * - GET /api/v1/shops/:shopId/queue
 * - POST /api/v1/shops/:shopId/jobs/:jobId/approve
 * Ensures all queue items conform to the 7 canonical PostgreSQL statuses.
 */

import type { QueueItem, QueueFilter, CanonicalJobStatus } from '../../types/queue';
import { normalizeJobStatus } from '../../types/queue';

export interface QueueServiceOptions {
  baseUrl?: string | undefined;
  authToken?: string | undefined;
}

export interface ApproveJobResponse {
  success: boolean;
  job: QueueItem;
  message?: string | undefined;
}

export class QueueService {
  private readonly baseUrl: string;
  private readonly authToken?: string | undefined;

  constructor(options: QueueServiceOptions = {}) {
    this.baseUrl =
      options.baseUrl ||
      (typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000');
    this.authToken = options.authToken;
  }

  /**
   * Fetches the queue for a given shop, optionally filtered by status.
   * Synchronizes and normalizes all job statuses to canonical uppercase enums.
   */
  public async getQueue(
    shopId: string,
    options?: { status?: QueueFilter | undefined; signal?: AbortSignal | undefined }
  ): Promise<QueueItem[]> {
    if (!shopId) return [];

    const apiUrl = this.baseUrl.replace(/\/+$/, '');
    const queryParams = new URLSearchParams();
    if (options?.status && options.status !== 'ALL') {
      queryParams.set('status', options.status);
    }

    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const endpoint = `${apiUrl}/api/v1/shops/${shopId}/queue${queryString}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const init: RequestInit = {
      method: 'GET',
      headers
    };
    if (options?.signal) {
      init.signal = options.signal;
    }

    const response = await fetch(endpoint, init);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch shop queue (HTTP ${response.status}): ${errText}`);
    }

    const json = await response.json();
    const rawItems: any[] = Array.isArray(json) ? json : json.data || json.items || [];

    return rawItems.map((item: any, index: number): QueueItem => {
      const normalizedStatus: CanonicalJobStatus = normalizeJobStatus(item.status);

      return {
        id: item.id || `job-${index}`,
        shop_id: item.shop_id || shopId,
        customer_id: item.customer_id || '',
        customer_name: item.customer_name || 'Walk-in Customer',
        customer_phone: item.customer_phone,
        printer_id: item.printer_id,
        printer_name: item.printer_name,
        document_name: item.document_name || item.document_storage_key?.split('/').pop(),
        document_storage_key: item.document_storage_key || '',
        settings: {
          paper_size: item.settings?.paper_size || 'A4',
          color_mode: item.settings?.color_mode || 'bw',
          sides: item.settings?.sides || 'single',
          orientation: item.settings?.orientation || 'portrait',
          copies: item.settings?.copies || 1,
          page_range: item.settings?.page_range || 'all',
          binding: item.settings?.binding || 'none'
        },
        priority_tier: item.priority_tier === 'urgent' ? 'urgent' : 'flexible',
        price_total_paise: item.price_total_paise || 0,
        status: normalizedStatus,
        queue_position: typeof item.queue_position === 'number' ? item.queue_position : index + 1,
        estimated_wait_minutes: item.estimated_wait_minutes,
        created_at: item.created_at || new Date().toISOString(),
        updated_at: item.updated_at || new Date().toISOString()
      };
    });
  }

  /**
   * Approves a job in the queue (e.g. from SUBMITTED to OWNER_CONFIRMED / QUEUED).
   */
  public async approveJob(
    shopId: string,
    jobId: string,
    signal?: AbortSignal | undefined
  ): Promise<ApproveJobResponse> {
    if (!shopId || !jobId) {
      throw new Error('shopId and jobId are required to approve job');
    }

    const apiUrl = this.baseUrl.replace(/\/+$/, '');
    const endpoint = `${apiUrl}/api/v1/shops/${shopId}/jobs/${jobId}/approve`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify({ approved_at: new Date().toISOString() })
    };
    if (signal) {
      init.signal = signal;
    }

    const response = await fetch(endpoint, init);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to approve job (HTTP ${response.status}): ${errText}`);
    }

    const json = await response.json();
    const rawJob = json.data || json.job || json;

    const normalizedStatus: CanonicalJobStatus = normalizeJobStatus(
      rawJob.status || 'OWNER_CONFIRMED'
    );

    const job: QueueItem = {
      id: rawJob.id || jobId,
      shop_id: rawJob.shop_id || shopId,
      customer_id: rawJob.customer_id || '',
      customer_name: rawJob.customer_name || 'Customer',
      customer_phone: rawJob.customer_phone,
      printer_id: rawJob.printer_id,
      printer_name: rawJob.printer_name,
      document_name: rawJob.document_name,
      document_storage_key: rawJob.document_storage_key || '',
      settings: {
        paper_size: rawJob.settings?.paper_size || 'A4',
        color_mode: rawJob.settings?.color_mode || 'bw',
        sides: rawJob.settings?.sides || 'single',
        orientation: rawJob.settings?.orientation || 'portrait',
        copies: rawJob.settings?.copies || 1,
        page_range: rawJob.settings?.page_range || 'all',
        binding: rawJob.settings?.binding || 'none'
      },
      priority_tier: rawJob.priority_tier === 'urgent' ? 'urgent' : 'flexible',
      price_total_paise: rawJob.price_total_paise || 0,
      status: normalizedStatus,
      queue_position: rawJob.queue_position || 1,
      estimated_wait_minutes: rawJob.estimated_wait_minutes,
      created_at: rawJob.created_at || new Date().toISOString(),
      updated_at: rawJob.updated_at || new Date().toISOString()
    };

    return {
      success: true,
      job,
      message: json.message || 'Job approved successfully'
    };
  }
}
