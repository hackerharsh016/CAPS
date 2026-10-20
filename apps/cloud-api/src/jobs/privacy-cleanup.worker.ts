/**
 * Privacy Cleanup Worker (CAPS Background Privacy Retention Sweeper).
 *
 * Enforces strict customer data privacy lifecycle per:
 * - SRS §3.4 & §5.3: Timely destruction of customer documents.
 * - Master Plan §5.5 & §8.3: Customer files must be deleted from object storage
 *   regardless of job outcome (completed, failed, cancelled, or retention expired).
 * - Migration 004 & 012: Permanent append-only document_deletion_logs audit entries.
 */

import type { IPrintJobsRepository } from '../modules/print-jobs/print-jobs.repository.js';
import type { IDocumentsRepository } from '../modules/documents/documents.repository.js';
import type { IStorageService } from '../modules/documents/storage.service.js';
import type {
  PrivacyCleanupResult,
  DocumentDeletionLog,
  DeletionReason
} from '../modules/documents/documents.types.js';

export interface PrivacyCleanupWorkerOptions {
  printJobsRepo: IPrintJobsRepository;
  documentsRepo: IDocumentsRepository;
  storageService: IStorageService;
  logger?: {
    info: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
  } | undefined;
}

export class PrivacyCleanupWorker {
  private readonly printJobsRepo: IPrintJobsRepository;
  private readonly documentsRepo: IDocumentsRepository;
  private readonly storageService: IStorageService;
  private readonly logger?: PrivacyCleanupWorkerOptions['logger'];

  constructor(options: PrivacyCleanupWorkerOptions) {
    this.printJobsRepo = options.printJobsRepo;
    this.documentsRepo = options.documentsRepo;
    this.storageService = options.storageService;
    this.logger = options.logger;
  }

  /**
   * Sweeps print jobs and document storage to permanently purge expired or completed source files.
   * Guarantees:
   * 1. Expired source documents are purged REGARDLESS of job outcome (completed, failed, cancelled, etc.).
   * 2. Completed jobs have their storage files deleted according to post-print privacy retention rules.
   * 3. Deletions are permanently recorded in document_deletion_logs.
   * 4. Idempotent: previously purged files are safely skipped.
   */
  async runCleanup(nowMs: number = Date.now()): Promise<PrivacyCleanupResult> {
    const sweptAt = new Date(nowMs).toISOString();
    const result: PrivacyCleanupResult = {
      swept_at: sweptAt,
      processed_jobs_count: 0,
      deleted_objects_count: 0,
      deleted_keys: [],
      deletion_logs: [],
      errors: []
    };

    // 1. Fetch all print jobs across shops
    const allJobsRes = await this.printJobsRepo.findAll({ limit: 1000 });
    const jobs = allJobsRes.jobs;

    for (const job of jobs) {
      if (!job.document_storage_key) continue;

      const isExpired = new Date(job.document_expires_at).getTime() <= nowMs;
      const isTerminalState = job.status === 'completed' || job.status === 'cancelled';

      // Eligible if retention duration expired OR job physically completed/cancelled
      if (!isExpired && !isTerminalState) {
        continue;
      }

      result.processed_jobs_count += 1;

      // 2. Check if this document was already logged as deleted (idempotent safeguard)
      const existingLogs = await this.documentsRepo.getDeletionLogs(job.id);
      const alreadyDeleted = existingLogs.some(
        l => l.document_storage_key === job.document_storage_key
      );

      if (alreadyDeleted) {
        continue;
      }

      try {
        // 3. Determine explicit deletion reason
        let reason: DeletionReason = 'retention_expired';
        if (job.status === 'completed') {
          reason = 'print_completed';
        } else if (job.status === 'cancelled') {
          reason = 'job_cancelled';
        }

        // 4. Delete physical file from object storage
        await this.storageService.deleteObject(job.document_storage_key);
        result.deleted_objects_count += 1;
        result.deleted_keys.push(job.document_storage_key);

        // 5. Update document metadata status if record exists
        if (job.document_id) {
          await this.documentsRepo.update(job.document_id, {
            status: 'purged',
            purged_at: sweptAt
          });
        }

        // 6. Record permanent immutable privacy deletion audit log
        const deletionLog: DocumentDeletionLog = await this.documentsRepo.recordDeletionLog({
          job_id: job.id,
          document_storage_key: job.document_storage_key,
          deleted_by: 'cloud_ttl_sweeper',
          reason
        });

        result.deletion_logs.push(deletionLog);

        // 7. Record immutable job event audit
        await this.printJobsRepo.recordEvent({
          job_id: job.id,
          actor_type: 'system',
          to_status: job.status,
          reason: `Privacy retention purge: ${reason}`,
          metadata: {
            document_storage_key: job.document_storage_key,
            deleted_by: 'cloud_ttl_sweeper',
            reason,
            purged_at: sweptAt
          }
        });

        this.logger?.info(
          `[PrivacyCleanupWorker] Purged document ${job.document_storage_key} for job ${job.id} (reason: ${reason})`
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push({
          job_id: job.id,
          storage_key: job.document_storage_key,
          error: errorMsg
        });
        this.logger?.error(
          `[PrivacyCleanupWorker] Failed to purge document ${job.document_storage_key} for job ${job.id}: ${errorMsg}`
        );
      }
    }

    return result;
  }
}
