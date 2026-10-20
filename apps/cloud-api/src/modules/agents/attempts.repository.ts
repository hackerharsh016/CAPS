import crypto from 'node:crypto';
import type { JobAttempt, CreateJobAttemptDto, UpdateJobAttemptDto } from './attempts.types.js';

export interface IJobAttemptsRepository {
  findById(id: string): Promise<JobAttempt | null>;
  findByJobId(jobId: string): Promise<JobAttempt[]>;
  findActiveByJobId(jobId: string): Promise<JobAttempt | null>;
  findByIdempotencyKey(jobId: string, idempotencyKey: string): Promise<JobAttempt | null>;
  findByIdempotency(idempotencyKey: string): Promise<JobAttempt | null>;
  create(dto: CreateJobAttemptDto): Promise<JobAttempt>;
  update(id: string, dto: UpdateJobAttemptDto): Promise<JobAttempt | null>;
  findExpiredLeases(nowMs?: number): Promise<JobAttempt[]>;
  delete(id: string): Promise<boolean>;
  clear(): void;
}

export class MockJobAttemptsRepository implements IJobAttemptsRepository {
  private readonly attempts = new Map<string, JobAttempt>();

  async findById(id: string): Promise<JobAttempt | null> {
    const attempt = this.attempts.get(id);
    return attempt ? { ...attempt } : null;
  }

  async findByJobId(jobId: string): Promise<JobAttempt[]> {
    return Array.from(this.attempts.values())
      .filter(a => a.job_id === jobId)
      .map(a => ({ ...a }));
  }

  async findActiveByJobId(jobId: string): Promise<JobAttempt | null> {
    const activeStatuses = ['leased', 'downloading', 'rendering', 'submitted', 'printing'];
    const active = Array.from(this.attempts.values()).find(
      a => a.job_id === jobId && activeStatuses.includes(a.status)
    );
    return active ? { ...active } : null;
  }

  async findByIdempotencyKey(jobId: string, idempotencyKey: string): Promise<JobAttempt | null> {
    const found = Array.from(this.attempts.values()).find(
      a => a.job_id === jobId && a.idempotency_key === idempotencyKey
    );
    return found ? { ...found } : null;
  }

  async findByIdempotency(idempotencyKey: string): Promise<JobAttempt | null> {
    const found = Array.from(this.attempts.values()).find(
      a => a.idempotency_key === idempotencyKey
    );
    return found ? { ...found } : null;
  }

  async findExpiredLeases(nowMs: number = Date.now()): Promise<JobAttempt[]> {
    const activeStatuses = ['leased', 'downloading'];
    return Array.from(this.attempts.values())
      .filter(a => activeStatuses.includes(a.status) && new Date(a.lease_expires_at).getTime() < nowMs)
      .map(a => ({ ...a }));
  }

  async create(dto: CreateJobAttemptDto): Promise<JobAttempt> {
    // Check idempotency uniqueness constraint: (job_id, idempotency_key)
    const existing = await this.findByIdempotencyKey(dto.job_id, dto.idempotency_key);
    if (existing) {
      throw new Error(`Duplicate attempt detected for job ${dto.job_id} and idempotency_key ${dto.idempotency_key}`);
    }

    // Single active lease constraint: only 1 attempt in active status per job
    const status = dto.status ?? 'leased';
    const activeStatuses = ['leased', 'downloading', 'rendering', 'submitted', 'printing'];
    if (activeStatuses.includes(status)) {
      const active = await this.findActiveByJobId(dto.job_id);
      if (active) {
        throw new Error(`Active attempt already exists for job ${dto.job_id} (attempt ID: ${active.id})`);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const lease_token = dto.lease_token ?? crypto.randomUUID();

    const attempt: JobAttempt = {
      id,
      job_id: dto.job_id,
      lease_token,
      lease_expires_at: dto.lease_expires_at,
      idempotency_key: dto.idempotency_key,
      status,
      created_at: now,
      updated_at: now,
      ...(dto.printer_id !== undefined ? { printer_id: dto.printer_id } : {}),
      ...(dto.agent_device_id !== undefined ? { agent_device_id: dto.agent_device_id } : {}),
      ...(dto.spooler_job_id !== undefined ? { spooler_job_id: dto.spooler_job_id } : {}),
      ...(dto.error_code !== undefined ? { error_code: dto.error_code } : {}),
      ...(dto.error_message !== undefined ? { error_message: dto.error_message } : {})
    };

    this.attempts.set(id, attempt);
    return { ...attempt };
  }

  async update(id: string, dto: UpdateJobAttemptDto): Promise<JobAttempt | null> {
    const existing = this.attempts.get(id);
    if (!existing) return null;

    const updated: JobAttempt = {
      ...existing,
      updated_at: new Date().toISOString(),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.spooler_job_id !== undefined ? { spooler_job_id: dto.spooler_job_id } : {}),
      ...(dto.error_code !== undefined ? { error_code: dto.error_code } : {}),
      ...(dto.error_message !== undefined ? { error_message: dto.error_message } : {})
    };

    this.attempts.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<boolean> {
    return this.attempts.delete(id);
  }

  clear(): void {
    this.attempts.clear();
  }
}
