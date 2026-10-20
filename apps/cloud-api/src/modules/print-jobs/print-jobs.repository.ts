import type { PrintJob, CreatePrintJobDto, UpdatePrintJobDto } from './print-jobs.types.js';

export interface IPrintJobsRepository {
  findById(id: string): Promise<PrintJob | null>;
  findByCustomer(customerId: string): Promise<PrintJob[]>;
  findQueueByShop(shopId: string): Promise<PrintJob[]>;
  findAllByShop?(shopId: string): Promise<PrintJob[]>;
  create(dto: CreatePrintJobDto): Promise<PrintJob>;
  update(id: string, dto: UpdatePrintJobDto): Promise<PrintJob | null>;
  delete(id: string): Promise<boolean>;
}

export class MockPrintJobsRepository implements IPrintJobsRepository {
  private jobs: Map<string, PrintJob> = new Map();

  async findById(id: string): Promise<PrintJob | null> {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  async findByCustomer(customerId: string): Promise<PrintJob[]> {
    return Array.from(this.jobs.values())
      .filter(j => j.customer_id === customerId)
      .map(j => ({ ...j }));
  }

  async findAllByShop(shopId: string): Promise<PrintJob[]> {
    return Array.from(this.jobs.values())
      .filter(j => j.shop_id === shopId)
      .map(j => ({ ...j }));
  }

  /**
   * Returns queued jobs ordered by two-tier priority:
   * 1. Urgent tier first (0) ahead of Flexible tier (1)
   * 2. FIFO order by enqueued_at timestamp within each tier
   * 3. Deterministic tiebreaker on job id
   */
  async findQueueByShop(shopId: string): Promise<PrintJob[]> {
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

    // Assign dynamic 1-based queue_position for consumer view
    return queuedJobs.map((j, index) => ({
      ...j,
      queue_position: index + 1
    }));
  }

  async create(dto: CreatePrintJobDto): Promise<PrintJob> {
    const id = crypto.randomUUID();
    const now = new Date();
    const createdIso = now.toISOString();

    const expiresDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const expiresIso = dto.document_expires_at ?? expiresDate.toISOString();

    const job: PrintJob = {
      id,
      shop_id: dto.shop_id,
      customer_id: dto.customer_id,
      document_storage_key: dto.document_storage_key,
      settings: { ...dto.settings },
      priority_tier: dto.priority_tier ?? 'flexible',
      price_total_paise: dto.price_total_paise,
      price_breakdown: { ...dto.price_breakdown },
      status: 'pending_payment',
      document_expires_at: expiresIso,
      created_at: createdIso,
      updated_at: createdIso,
      ...(dto.printer_id !== undefined ? { printer_id: dto.printer_id } : {})
    };

    this.jobs.set(id, job);
    return { ...job };
  }

  async update(id: string, dto: UpdatePrintJobDto): Promise<PrintJob | null> {
    const existing = this.jobs.get(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    let newEnqueuedAt = existing.enqueued_at;

    // Transitioning into queued sets enqueued_at automatically if not already set
    if (dto.status === 'queued' && existing.status !== 'queued' && !existing.enqueued_at) {
      newEnqueuedAt = dto.enqueued_at ?? now;
    }

    const updated: PrintJob = {
      ...existing,
      status: dto.status ?? existing.status,
      printer_id: dto.printer_id !== undefined ? dto.printer_id : existing.printer_id,
      enqueued_at: newEnqueuedAt,
      queue_position: dto.queue_position !== undefined ? dto.queue_position : existing.queue_position,
      updated_at: now
    };

    this.jobs.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.jobs.delete(id);
  }
}
