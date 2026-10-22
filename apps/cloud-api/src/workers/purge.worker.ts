/**
 * Cloud Storage Document Hard Purge Worker (Task INT-D3-07).
 *
 * Enforces zero-retention privacy policy by immediately deleting customer PDF documents
 * from Supabase Storage ('customer-documents') upon job completion/cancellation,
 * or via a scheduled background worker sweeping jobs past retention TTL (e.g., 24h).
 * Sets purged_at = NOW() in the database while preserving job metadata.
 */

import { StorageService } from '../services/storage.service.js';
import type { IPrintJobsRepository } from '../modules/print-jobs/print-jobs.repository.js';

export const DEFAULT_RETENTION_HOURS = 24;
export const DEFAULT_PURGE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface PurgeResult {
  jobId: string;
  storageKey?: string | undefined;
  purgedAt?: string | undefined;
  success: boolean;
  error?: string | undefined;
}

export interface PurgeSweepResult {
  swept: number;
  purged: number;
  failed: number;
  errors: Array<{ jobId: string; error: string }>;
}

export interface PurgeWorkerOptions {
  storageService?: StorageService | undefined;
  supabaseClient?: any;
  printJobsRepository?: IPrintJobsRepository | undefined;
  retentionHours?: number | undefined;
  pollIntervalMs?: number | undefined;
  batchSize?: number | undefined;
  logger?: {
    info(msg: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    error(msg: string, ...args: any[]): void;
    debug(msg: string, ...args: any[]): void;
  } | undefined;
}

export class PurgeWorker {
  public readonly storageService: StorageService;
  public readonly supabaseClient?: any;
  public readonly printJobsRepository?: IPrintJobsRepository | undefined;
  public readonly retentionHours: number;
  public readonly pollIntervalMs: number;
  public readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly logger: NonNullable<PurgeWorkerOptions['logger']>;

  constructor(options: PurgeWorkerOptions = {}) {
    this.storageService = options.storageService || new StorageService();
    this.supabaseClient = options.supabaseClient;
    this.printJobsRepository = options.printJobsRepository;
    this.retentionHours = options.retentionHours ?? DEFAULT_RETENTION_HOURS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PURGE_INTERVAL_MS;
    this.batchSize = options.batchSize ?? 100;
    this.logger = options.logger || console;
  }

  /**
   * Immediately purges document file from storage and marks purged_at in database.
   * Can be called with explicit storageKey or looks up the key from database.
   */
  public async purgeJobDocument(jobId: string, storageKey?: string): Promise<PurgeResult> {
    try {
      let key = storageKey;
      let alreadyPurged = false;

      // Look up job if storageKey is not provided
      if (!key) {
        if (this.supabaseClient) {
          const { data, error } = await this.supabaseClient
            .from('print_jobs')
            .select('id, document_storage_key, purged_at')
            .eq('id', jobId)
            .maybeSingle();

          if (error) {
            this.logger.warn(`Failed to fetch job ${jobId} for purge: ${error.message}`);
          }
          if (data) {
            key = data.document_storage_key;
            alreadyPurged = Boolean(data.purged_at);
          }
        } else if (this.printJobsRepository) {
          const job = await this.printJobsRepository.findById(jobId);
          if (job) {
            key = job.document_storage_key;
            alreadyPurged = Boolean((job as any).purged_at);
          }
        }
      }

      const nowIso = new Date().toISOString();

      // 1. Delete object from Supabase Storage if present and not already purged
      if (key && key !== '[PURGED]' && !alreadyPurged) {
        await this.storageService.purgeDocument(key);
        this.logger.info(`Purged document from storage for job ${jobId} (key: ${key})`);
      }

      // 2. Set purged_at = NOW() in database while preserving job metadata
      if (this.supabaseClient) {
        const { error: updateErr } = await this.supabaseClient
          .from('print_jobs')
          .update({
            purged_at: nowIso,
            updated_at: nowIso
          })
          .eq('id', jobId);

        if (updateErr) {
          this.logger.warn(`Failed to record purged_at for job ${jobId}: ${updateErr.message}`);
        }
      } else if (this.printJobsRepository) {
        await this.printJobsRepository.update(jobId, {
          purged_at: nowIso,
          updated_at: nowIso
        });
      }

      return {
        jobId,
        storageKey: key,
        purgedAt: nowIso,
        success: true
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      this.logger.error(`Error purging document for job ${jobId}: ${errMsg}`);
      return {
        jobId,
        storageKey,
        success: false,
        error: errMsg
      };
    }
  }

  /**
   * Immediate trigger invoked when job completes or customer cancels.
   */
  public async triggerImmediatePurge(jobId: string, storageKey?: string): Promise<PurgeResult> {
    return this.purgeJobDocument(jobId, storageKey);
  }

  /**
   * Periodic retention sweep: finds unpurged jobs past retention window or in terminal state,
   * purges their storage objects, and marks purged_at.
   */
  public async runPurgeSweep(retentionHours: number = this.retentionHours): Promise<PurgeSweepResult> {
    const result: PurgeSweepResult = {
      swept: 0,
      purged: 0,
      failed: 0,
      errors: []
    };

    const eligibleJobs: Array<{ id: string; storageKey: string }> = [];
    const cutoffTime = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
    const terminalStatuses = ['completed', 'cancelled', 'failed', 'requires_review'];

    try {
      if (this.supabaseClient) {
        // Try RPC `get_unpurged_jobs_for_cleanup`
        const { data: rpcData, error: rpcError } = await this.supabaseClient.rpc(
          'get_unpurged_jobs_for_cleanup',
          {
            p_retention_hours: retentionHours,
            p_limit: this.batchSize
          }
        );

        if (!rpcError && Array.isArray(rpcData)) {
          for (const row of rpcData) {
            eligibleJobs.push({
              id: row.job_id || row.id,
              storageKey: row.document_storage_key
            });
          }
        } else {
          // Direct table query fallback
          const { data, error } = await this.supabaseClient
            .from('print_jobs')
            .select('id, document_storage_key, status, created_at, purged_at')
            .is('purged_at', null)
            .neq('document_storage_key', '[PURGED]')
            .not('document_storage_key', 'is', null)
            .limit(this.batchSize);

          if (!error && Array.isArray(data)) {
            for (const row of data) {
              const isTerminal = terminalStatuses.includes(row.status?.toLowerCase());
              const isPastRetention = row.created_at <= cutoffTime;
              if (isTerminal || isPastRetention) {
                eligibleJobs.push({
                  id: row.id,
                  storageKey: row.document_storage_key
                });
              }
            }
          }
        }
      } else if (this.printJobsRepository) {
        const { jobs } = await this.printJobsRepository.findAll({ limit: this.batchSize });
        for (const job of jobs) {
          const rec = job as any;
          if (rec.purged_at) continue;
          if (!rec.document_storage_key || rec.document_storage_key === '[PURGED]') continue;

          const isTerminal = terminalStatuses.includes(rec.status?.toLowerCase());
          const isPastRetention = rec.created_at <= cutoffTime;

          if (isTerminal || isPastRetention) {
            eligibleJobs.push({
              id: rec.id,
              storageKey: rec.document_storage_key
            });
          }
        }
      }

      result.swept = eligibleJobs.length;

      // Purge all identified jobs
      for (const item of eligibleJobs) {
        const purgeRes = await this.purgeJobDocument(item.id, item.storageKey);
        if (purgeRes.success) {
          result.purged++;
        } else {
          result.failed++;
          result.errors.push({
            jobId: item.id,
            error: purgeRes.error || 'Unknown purge error'
          });
        }
      }
    } catch (sweepErr: any) {
      this.logger.error(`Purge sweep failed: ${sweepErr?.message || sweepErr}`);
    }

    return result;
  }

  /**
   * Starts recurring purge background sweep (every 10 minutes by default).
   */
  public start(intervalMs: number = this.pollIntervalMs): NodeJS.Timeout {
    if (this.timer) {
      return this.timer;
    }

    this.timer = setInterval(async () => {
      try {
        await this.runPurgeSweep();
      } catch (err: any) {
        this.logger.error(`Interval purge worker error: ${err?.message || err}`);
      }
    }, intervalMs);

    // Allow process to exit cleanly if timer is only active handle
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    this.logger.info(`Started Document Purge Worker with interval ${intervalMs}ms`);
    return this.timer;
  }

  /**
   * Stops the recurring purge background timer.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('Stopped Document Purge Worker');
    }
  }

  /**
   * Returns true if the purge worker is currently running on interval.
   */
  public isRunning(): boolean {
    return this.timer !== null;
  }
}

export function createPurgeWorker(options?: PurgeWorkerOptions): PurgeWorker {
  return new PurgeWorker(options);
}
