/**
 * Supabase Print Jobs Repository (INT-D3-03).
 * Production repository backed by Supabase PostgREST database operations for `print_jobs`,
 * `job_attempts`, `job_events`, and atomic stored procedure RPCs.
 */

import crypto from 'node:crypto';
import type { IPrintJobsRepository } from '../../modules/print-jobs/print-jobs.repository.js';
import type {
  PrintJobRecord,
  JobEventRecord,
  ListPrintJobsFilter,
  JobStatus
} from '../../modules/print-jobs/print-jobs.types.js';
import {
  type SupabaseClientLike,
  type SupabaseRepoOptions,
  createDefaultSupabaseClient
} from './supabase-shops.repository.js';

export interface ClaimNextJobParams {
  shopId: string;
  agentDeviceId: string;
  leaseDurationSeconds?: number | undefined;
  printerId?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ClaimJobResult {
  job_id: string;
  attempt_id: string;
  lease_token: string;
  lease_expires_at: string;
  status: 'CLAIMED' | 'claimed';
  settings?: Record<string, unknown> | undefined;
  document_url?: string | undefined;
  is_idempotent_replay?: boolean | undefined;
}

export interface UpdateStatusParams {
  jobId: string;
  status: JobStatus | string;
  leaseToken?: string | undefined;
  actorId?: string | undefined;
  actorType?: 'customer' | 'owner' | 'agent' | 'system' | undefined;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export class SupabasePrintJobsRepository implements IPrintJobsRepository {
  private readonly client: SupabaseClientLike;

  constructor(options: SupabaseRepoOptions = {}) {
    if (options.client) {
      this.client = options.client;
    } else {
      const env = typeof process !== 'undefined' ? process.env : {};
      const url = options.supabaseUrl || env['SUPABASE_URL'] || 'http://localhost:54321';
      const key =
        options.supabaseKey ||
        env['SUPABASE_SERVICE_ROLE_KEY'] ||
        env['SUPABASE_ANON_KEY'] ||
        '';
      const customFetch = options.customFetch || fetch;

      this.client = createDefaultSupabaseClient(url, key, customFetch);
    }
  }

  async create(data: any): Promise<PrintJobRecord> {
    const id = data.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiresIso = data.document_expires_at ?? expiresDate.toISOString();

    const record: PrintJobRecord = {
      id,
      shop_id: data.shop_id,
      customer_id: data.customer_id,
      printer_id: data.printer_id,
      document_id: data.document_id,
      document_storage_key: data.document_storage_key,
      settings: data.settings || {},
      priority_tier: data.priority_tier ?? 'flexible',
      price_total_paise: data.price_total_paise || 0,
      price_breakdown: data.price_breakdown || { subtotal_paise: 0, total_paise: 0 },
      status: data.status || 'pending_payment',
      ...(data.idempotency_key ? { idempotency_key: data.idempotency_key } : {}),
      ...(data.queue_position !== undefined ? { queue_position: data.queue_position } : {}),
      ...(data.enqueued_at !== undefined ? { enqueued_at: data.enqueued_at } : {}),
      document_expires_at: expiresIso,
      created_at: now,
      updated_at: now
    };

    const { data: inserted, error } = await this.client
      .from('print_jobs')
      .insert(record)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create print job in Supabase: ${error.message || JSON.stringify(error)}`);
    }

    return mapDbRecordToPrintJob(inserted || record);
  }

  async findById(id: string): Promise<PrintJobRecord | null> {
    const { data, error } = await this.client
      .from('print_jobs')
      .select('*, customer:profiles(id, full_name, email, phone), document:documents(id, original_filename, file_size_bytes)')
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      // Fallback query without joins in case profiles/documents relation differs
      const fallback = await this.client
        .from('print_jobs')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fallback.error || !fallback.data) return null;
      return mapDbRecordToPrintJob(fallback.data);
    }

    return mapDbRecordToPrintJob(data);
  }

  async findByCustomer(customerId: string): Promise<PrintJobRecord[]> {
    const { data, error } = await this.client
      .from('print_jobs')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToPrintJob);
  }

  async findByIdempotencyKey(key: string, customerId: string): Promise<PrintJobRecord | null> {
    const { data, error } = await this.client
      .from('print_jobs')
      .select('*')
      .eq('idempotency_key', key)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error || !data) return null;
    return mapDbRecordToPrintJob(data);
  }

  async findAllByShop(shopId: string): Promise<PrintJobRecord[]> {
    const { data, error } = await this.client
      .from('print_jobs')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false });

    if (error || !data) return [];
    return (data as any[]).map(mapDbRecordToPrintJob);
  }

  async findQueueByShop(shopId: string): Promise<PrintJobRecord[]> {
    const { data, error } = await this.client
      .from('print_jobs')
      .select('*')
      .eq('shop_id', shopId)
      .eq('status', 'queued')
      .order('priority_tier', { ascending: true }) // 'urgent' before 'flexible'
      .order('enqueued_at', { ascending: true })
      .order('id', { ascending: true });

    if (error || !data) return [];

    const jobs = (data as any[]).map(mapDbRecordToPrintJob);
    // Ensure urgent is ranked before flexible
    jobs.sort((a, b) => {
      const tierRankA = a.priority_tier === 'urgent' ? 0 : 1;
      const tierRankB = b.priority_tier === 'urgent' ? 0 : 1;
      if (tierRankA !== tierRankB) return tierRankA - tierRankB;

      const timeA = new Date(a.enqueued_at ?? a.created_at).getTime();
      const timeB = new Date(b.enqueued_at ?? b.created_at).getTime();
      if (timeA !== timeB) return timeA - timeB;

      return a.id.localeCompare(b.id);
    });

    return jobs.map((j, index) => ({
      ...j,
      queue_position: index + 1
    }));
  }

  async findAll(
    filter: ListPrintJobsFilter = {}
  ): Promise<{ jobs: PrintJobRecord[]; total: number }> {
    let query = this.client.from('print_jobs').select('*', { count: 'exact' });

    if (filter.shop_id) {
      query = query.eq('shop_id', filter.shop_id);
    }
    if (filter.customer_id) {
      query = query.eq('customer_id', filter.customer_id);
    }
    if (filter.status) {
      query = query.eq('status', filter.status);
    }
    if (filter.priority_tier) {
      query = query.eq('priority_tier', filter.priority_tier);
    }

    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    query = query.range(offset, offset + limit - 1).order('created_at', { ascending: false });

    const { data, count, error } = await query;
    if (error || !data) return { jobs: [], total: 0 };

    return {
      jobs: (data as any[]).map(mapDbRecordToPrintJob),
      total: count ?? data.length
    };
  }

  async update(id: string, partial: any): Promise<PrintJobRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    let newEnqueuedAt =
      partial.enqueued_at !== undefined ? partial.enqueued_at : existing.enqueued_at;

    if (partial.status === 'queued' && existing.status !== 'queued' && !newEnqueuedAt) {
      newEnqueuedAt = now;
    }

    const updates: Record<string, unknown> = {
      ...partial,
      enqueued_at: newEnqueuedAt,
      updated_at: now
    };

    const { data, error } = await this.client
      .from('print_jobs')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update print job: ${error.message || JSON.stringify(error)}`);
    }

    return data ? mapDbRecordToPrintJob(data) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from('print_jobs').delete().eq('id', id);
    return !error;
  }

  /**
   * Executes atomic stored procedure to claim next approved job.
   * Targets RPC `claim_next_approved_job` and updates job state to `CLAIMED`.
   */
  async claimNextJob(params: ClaimNextJobParams): Promise<ClaimJobResult | null> {
    const duration = params.leaseDurationSeconds ?? 120;

    // 1. Execute Supabase RPC `claim_next_approved_job`
    const rpcRes = await this.client.rpc('claim_next_approved_job', {
      p_shop_id: params.shopId,
      p_agent_device_id: params.agentDeviceId,
      p_lease_duration_seconds: duration
    });

    if (rpcRes.error) {
      // Fallback: try `claim_job_lease` if `claim_next_approved_job` is not installed
      const fallbackRes = await this.client.rpc('claim_job_lease', {
        p_shop_id: params.shopId,
        p_agent_device_id: params.agentDeviceId,
        p_printer_id: params.printerId ?? null,
        p_lease_duration_seconds: duration,
        p_idempotency_key: params.idempotencyKey ?? null
      });

      if (fallbackRes.error || !fallbackRes.data) {
        return null;
      }

      const claimData = Array.isArray(fallbackRes.data) ? fallbackRes.data[0] : fallbackRes.data;
      if (!claimData || !claimData.job_id) return null;

      return {
        job_id: claimData.job_id,
        attempt_id: claimData.attempt_id,
        lease_token: claimData.lease_token,
        lease_expires_at: claimData.lease_expires_at,
        status: 'CLAIMED',
        is_idempotent_replay: Boolean(claimData.is_idempotent_replay)
      };
    }

    if (!rpcRes.data) return null;

    const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
    if (!row || !row.job_id) return null;

    return {
      job_id: row.job_id,
      attempt_id: row.attempt_id || crypto.randomUUID(),
      lease_token: row.lease_token || crypto.randomUUID(),
      lease_expires_at: row.lease_expires_at || new Date(Date.now() + duration * 1000).toISOString(),
      status: 'CLAIMED',
      settings: row.settings,
      document_url: row.document_url,
      is_idempotent_replay: Boolean(row.is_idempotent_replay)
    };
  }

  /**
   * Updates job status verifying lease token and writing audit log event.
   */
  async updateStatus(params: UpdateStatusParams): Promise<PrintJobRecord | null> {
    const job = await this.findById(params.jobId);
    if (!job) {
      throw new Error(`Print job not found: ${params.jobId}`);
    }

    // Verify lease token if provided
    if (params.leaseToken) {
      const { data: attempt, error: attemptError } = await this.client
        .from('job_attempts')
        .select('*')
        .eq('job_id', params.jobId)
        .eq('lease_token', params.leaseToken)
        .maybeSingle();

      if (attemptError || !attempt) {
        throw new Error(`Invalid lease token: ${params.leaseToken} for job ${params.jobId}`);
      }
    }

    const normalizedStatus = (params.status.toLowerCase() as JobStatus);
    const updated = await this.update(params.jobId, {
      status: normalizedStatus,
      updated_at: new Date().toISOString()
    });

    // Record audit log event in job_events / audit_logs
    await this.recordEvent({
      job_id: params.jobId,
      actor_id: params.actorId,
      actor_type: params.actorType || 'agent',
      from_status: job.status,
      to_status: normalizedStatus,
      reason: params.reason,
      metadata: params.metadata
    });

    return updated;
  }

  async recordEvent(event: {
    job_id: string;
    actor_id?: string | undefined;
    actor_type: 'customer' | 'owner' | 'agent' | 'system';
    from_status?: JobStatus | undefined;
    to_status: JobStatus;
    reason?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobEventRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: JobEventRecord = {
      id,
      job_id: event.job_id,
      actor_id: event.actor_id,
      actor_type: event.actor_type,
      from_status: event.from_status,
      to_status: event.to_status,
      reason: event.reason,
      metadata: event.metadata,
      created_at: now
    };

    const { data, error } = await this.client
      .from('job_events')
      .insert(record)
      .select()
      .maybeSingle();

    if (error) {
      // Also write to audit_logs table for dual audit support
      await this.client
        .from('audit_logs')
        .insert({
          id,
          entity_type: 'print_job',
          entity_id: event.job_id,
          action: `STATUS_CHANGE_${event.to_status.toUpperCase()}`,
          actor_id: event.actor_id,
          actor_type: event.actor_type,
          metadata: { ...event.metadata, from_status: event.from_status, to_status: event.to_status },
          created_at: now
        })
        .catch(() => null);

      return record;
    }

    return data || record;
  }

  async getEvents(jobId: string): Promise<JobEventRecord[]> {
    const { data, error } = await this.client
      .from('job_events')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data as JobEventRecord[];
  }

  clear(): void {
    // No-op for persistent db repository
  }
}

function mapDbRecordToPrintJob(row: any): PrintJobRecord {
  return {
    id: row.id,
    shop_id: row.shop_id,
    customer_id: row.customer_id,
    printer_id: row.printer_id,
    document_id: row.document_id,
    document_storage_key: row.document_storage_key || '',
    settings: typeof row.settings === 'object' && row.settings !== null ? row.settings : {},
    priority_tier: row.priority_tier === 'urgent' ? 'urgent' : 'flexible',
    price_total_paise: Number(row.price_total_paise) || 0,
    price_breakdown:
      typeof row.price_breakdown === 'object' && row.price_breakdown !== null
        ? row.price_breakdown
        : { subtotal_paise: 0, total_paise: 0 },
    status: (row.status || 'pending_payment').toLowerCase() as JobStatus,
    idempotency_key: row.idempotency_key,
    queue_position: row.queue_position !== undefined ? Number(row.queue_position) : undefined,
    enqueued_at: row.enqueued_at,
    claimed_at: row.claimed_at,
    claimed_by_agent_id: row.claimed_by_agent_id,
    completed_at: row.completed_at,
    failed_reason: row.failed_reason,
    document_expires_at: row.document_expires_at || new Date().toISOString(),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
