import crypto from 'node:crypto';
import type {
  PrintJobRecord,
  JobEventRecord,
  ListPrintJobsFilter,
  JobStatus
} from './print-jobs.types.js';

export interface IPrintJobsRepository {
  create(job: {
    shop_id: string;
    customer_id: string;
    printer_id?: string | undefined;
    document_id?: string | undefined;
    document_storage_key: string;
    settings: PrintJobRecord['settings'];
    priority_tier: PrintJobRecord['priority_tier'];
    price_total_paise: number;
    price_breakdown: PrintJobRecord['price_breakdown'];
    status: JobStatus;
    idempotency_key?: string | undefined;
    enqueued_at?: string | undefined;
    document_expires_at: string;
  }): Promise<PrintJobRecord>;

  findById(id: string): Promise<PrintJobRecord | null>;
  findByIdempotencyKey(key: string, customerId: string): Promise<PrintJobRecord | null>;
  findAll(filter?: ListPrintJobsFilter): Promise<{ jobs: PrintJobRecord[]; total: number }>;
  update(id: string, partial: Partial<PrintJobRecord>): Promise<PrintJobRecord | null>;
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

  async create(data: {
    shop_id: string;
    customer_id: string;
    printer_id?: string | undefined;
    document_id?: string | undefined;
    document_storage_key: string;
    settings: PrintJobRecord['settings'];
    priority_tier: PrintJobRecord['priority_tier'];
    price_total_paise: number;
    price_breakdown: PrintJobRecord['price_breakdown'];
    status: JobStatus;
    idempotency_key?: string | undefined;
    enqueued_at?: string | undefined;
    document_expires_at: string;
  }): Promise<PrintJobRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: PrintJobRecord = {
      id,
      shop_id: data.shop_id,
      customer_id: data.customer_id,
      ...(data.printer_id !== undefined ? { printer_id: data.printer_id } : {}),
      ...(data.document_id !== undefined ? { document_id: data.document_id } : {}),
      document_storage_key: data.document_storage_key,
      settings: { ...data.settings },
      priority_tier: data.priority_tier,
      price_total_paise: data.price_total_paise,
      price_breakdown: { ...data.price_breakdown },
      status: data.status,
      ...(data.idempotency_key !== undefined ? { idempotency_key: data.idempotency_key } : {}),
      ...(data.enqueued_at !== undefined ? { enqueued_at: data.enqueued_at } : {}),
      document_expires_at: data.document_expires_at,
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

  async findByIdempotencyKey(key: string, customerId: string): Promise<PrintJobRecord | null> {
    for (const job of this.jobs.values()) {
      if (job.idempotency_key === key && job.customer_id === customerId) {
        return { ...job };
      }
    }
    return null;
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

    // Sort newest first
    all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;
    const paged = all.slice(offset, offset + limit).map(j => ({ ...j }));

    return { jobs: paged, total };
  }

  async update(id: string, partial: Partial<PrintJobRecord>): Promise<PrintJobRecord | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const updated: PrintJobRecord = {
      ...existing,
      ...partial,
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
