import crypto from 'node:crypto';
import type {
  PrintJobRecord,
  JobEventRecord,
  ListPrintJobsFilter,
  JobStatus
} from './print-jobs.types.js';

export interface IPrintJobsRepository {
  create(job: any): Promise<PrintJobRecord>;
  findById(id: string): Promise<PrintJobRecord | null>;
  findByCustomer(customerId: string): Promise<PrintJobRecord[]>;
  findByIdempotencyKey(key: string, customerId: string): Promise<PrintJobRecord | null>;
  findQueueByShop(shopId: string): Promise<PrintJobRecord[]>;
  findAllByShop?(shopId: string): Promise<PrintJobRecord[]>;
  findAll(filter?: ListPrintJobsFilter): Promise<{ jobs: PrintJobRecord[]; total: number }>;
  findExpiredForCleanup?(
    terminalRetentionMs?: number,
    now?: Date,
    limit?: number
  ): Promise<PrintJobRecord[]>;
  purgeDocumentStorage?(id: string): Promise<PrintJobRecord | null>;
  update(id: string, partial: any): Promise<PrintJobRecord | null>;
  delete(id: string): Promise<boolean>;
  recordEvent(event: {
    job_id: string;
    actor_id?: string | undefined;
    actor_type: 'customer' | 'owner' | 'agent' | 'system';
    from_status?: JobStatus | undefined;
    to_status: JobStatus;
    reason?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobEventRecord>;
  getEvents(jobId: string): Promise<JobEventRecord[]>;
  clear(): void;
}

export class MockPrintJobsRepository implements IPrintJobsRepository {
  private readonly jobs = new Map<string, PrintJobRecord>();
  private readonly events: JobEventRecord[] = [];

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

    this.jobs.set(id, record);
    return { ...record };
  }

  async findById(id: string): Promise<PrintJobRecord | null> {
    const record = this.jobs.get(id);
    return record ? { ...record } : null;
  }

  async findByCustomer(customerId: string): Promise<PrintJobRecord[]> {
    return Array.from(this.jobs.values())
      .filter(j => j.customer_id === customerId)
      .map(j => ({ ...j }));
  }

  async findByIdempotencyKey(key: string, customerId: string): Promise<PrintJobRecord | null> {
    for (const job of this.jobs.values()) {
      if (job.idempotency_key === key && job.customer_id === customerId) {
        return { ...job };
      }
    }
    return null;
  }

  async findAllByShop(shopId: string): Promise<PrintJobRecord[]> {
    return Array.from(this.jobs.values())
      .filter(j => j.shop_id === shopId)
      .map(j => ({ ...j }));
  }

  async findQueueByShop(shopId: string): Promise<PrintJobRecord[]> {
    const queuedJobs = Array.from(this.jobs.values()).filter(
      j => j.shop_id === shopId && j.status === 'queued'
    );

    queuedJobs.sort((a, b) => {
      const tierRankA = a.priority_tier === 'urgent' ? 0 : 1;
      const tierRankB = b.priority_tier === 'urgent' ? 0 : 1;
      if (tierRankA !== tierRankB) return tierRankA - tierRankB;

      const timeA = new Date(a.enqueued_at ?? a.created_at).getTime();
      const timeB = new Date(b.enqueued_at ?? b.created_at).getTime();
      if (timeA !== timeB) return timeA - timeB;

      return a.id.localeCompare(b.id);
    });

    return queuedJobs.map((j, index) => ({
      ...j,
      queue_position: index + 1
    }));
  }

  async findAll(filter: ListPrintJobsFilter = {}): Promise<{ jobs: PrintJobRecord[]; total: number }> {
    let all = Array.from(this.jobs.values());

    if (filter.shop_id) {
      all = all.filter(j => j.shop_id === filter.shop_id);
    }
    if (filter.customer_id) {
      all = all.filter(j => j.customer_id === filter.customer_id);
    }
    if (filter.status) {
      all = all.filter(j => j.status === filter.status);
    }
    if (filter.priority_tier) {
      all = all.filter(j => j.priority_tier === filter.priority_tier);
    }

    all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const paged = all.slice(offset, offset + limit).map(j => ({ ...j }));

    return { jobs: paged, total };
  }

  async update(id: string, partial: any): Promise<PrintJobRecord | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    let newEnqueuedAt = partial.enqueued_at !== undefined ? partial.enqueued_at : existing.enqueued_at;

    if (partial.status === 'queued' && existing.status !== 'queued' && !newEnqueuedAt) {
      newEnqueuedAt = now;
    }

    const updated: PrintJobRecord = {
      ...existing,
      ...partial,
      enqueued_at: newEnqueuedAt,
      updated_at: now
    };

    this.jobs.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.jobs.delete(id);
  }

  async findExpiredForCleanup(
    terminalRetentionMs: number = 30 * 60 * 1000,
    now: Date = new Date(),
    limit: number = 100
  ): Promise<PrintJobRecord[]> {
    const currentTime = now.getTime();
    const terminalStatuses = ['completed', 'failed', 'cancelled', 'requires_review'];

    const expired = Array.from(this.jobs.values()).filter(j => {
      if (!j.document_storage_key || j.document_storage_key === '[PURGED]') {
        return false;
      }

      const ttlTime = new Date(j.document_expires_at).getTime();
      if (ttlTime <= currentTime) {
        return true;
      }

      if (terminalStatuses.includes(j.status)) {
        const terminalTimestamp = new Date(j.updated_at ?? j.created_at).getTime();
        if (currentTime - terminalTimestamp >= terminalRetentionMs) {
          return true;
        }
      }

      return false;
    });

    expired.sort((a, b) => {
      const timeA = new Date(a.document_expires_at).getTime();
      const timeB = new Date(b.document_expires_at).getTime();
      return timeA - timeB;
    });

    return expired.slice(0, limit).map(j => ({ ...j }));
  }

  async purgeDocumentStorage(id: string): Promise<PrintJobRecord | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const updated: PrintJobRecord = {
      ...existing,
      document_storage_key: '[PURGED]',
      updated_at: new Date().toISOString()
    };

    this.jobs.set(id, updated);
    return { ...updated };
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
    const record: JobEventRecord = {
      id: crypto.randomUUID(),
      job_id: event.job_id,
      ...(event.actor_id !== undefined ? { actor_id: event.actor_id } : {}),
      actor_type: event.actor_type,
      ...(event.from_status !== undefined ? { from_status: event.from_status } : {}),
      to_status: event.to_status,
      ...(event.reason !== undefined ? { reason: event.reason } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      created_at: new Date().toISOString()
    };

    this.events.push(record);
    return { ...record };
  }

  async getEvents(jobId: string): Promise<JobEventRecord[]> {
    return this.events
      .filter(e => e.job_id === jobId)
      .map(e => ({ ...e }));
  }

  clear(): void {
    this.jobs.clear();
    this.events.length = 0;
  }
}
