/**
 * Privacy Retention & Document Cleanup Service for CAPS.
 *
 * Implements ADR 0007, SRS §2.2 / FR-1.4, and Master Plan §5.5 & §12:
 * 1. Private cloud object deletion 30 minutes after terminal status or 24h TTL.
 * 2. Immutable audit trail linking without storing document content.
 * 3. Safe retry and idempotent deletion tracing.
 * 4. Transparent disclosure of OS print spooler and hardware memory limits.
 */

import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IDocumentsRepository } from './documents.repository.js';
import type { IStorageService } from './storage.service.js';
import type {
  IJobEventsRepository,
  IDocumentDeletionLogsRepository
} from '../events/events.repository.js';
import type { DocumentDeletionLog, DocumentDeletionReason } from '../events/events.types.js';

export interface PrivacyRetentionConfig {
  terminalRetentionMs?: number | undefined; // Default 30 min (1,800,000 ms)
  hardTtlMs?: number | undefined; // Default 24 hours (86,400,000 ms)
}

export interface SweepResults {
  timestamp: string;
  jobs_scanned: number;
  jobs_purged: number;
  documents_scanned: number;
  documents_purged: number;
  errors: Array<{ id: string; target: 'job' | 'document'; message: string }>;
}

export interface PrivacyPolicyDisclosure {
  terminal_retention_minutes: number;
  hard_ttl_hours: number;
  local_temp_cleanup: string;
  audit_metadata_retention: string;
  spooler_privacy_caveat: string;
}

export class PrivacyRetentionService {
  readonly terminalRetentionMs: number;
  readonly hardTtlMs: number;

  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly documentsRepo: IDocumentsRepository,
    private readonly storageService: IStorageService,
    private readonly deletionLogsRepo: IDocumentDeletionLogsRepository,
    private readonly jobEventsRepo: IJobEventsRepository,
    config: PrivacyRetentionConfig = {}
  ) {
    this.terminalRetentionMs = config.terminalRetentionMs ?? 30 * 60 * 1000; // 30 minutes
    this.hardTtlMs = config.hardTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Sweeps and destroys storage objects for expired print jobs.
   */
  async sweepExpiredPrintJobs(
    now: Date = new Date(),
    limit: number = 100
  ): Promise<{
    scanned: number;
    purged: number;
    errors: Array<{ id: string; message: string }>;
  }> {
    const expiredJobs = this.printJobsRepo.findExpiredForCleanup
      ? await this.printJobsRepo.findExpiredForCleanup(this.terminalRetentionMs, now, limit)
      : [];

    let purgedCount = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const job of expiredJobs) {
      // Idempotency: skip if already purged
      if (!job.document_storage_key || job.document_storage_key === '[PURGED]') {
        continue;
      }

      try {
        // 1. Delete private cloud object from object storage
        await this.storageService.deleteObject(job.document_storage_key);

        // 2. Redact storage key in print jobs table
        if (this.printJobsRepo.purgeDocumentStorage) {
          await this.printJobsRepo.purgeDocumentStorage(job.id);
        } else {
          await this.printJobsRepo.update(job.id, {
            status: job.status
          });
        }

        // 3. Determine reason
        let reason: DocumentDeletionReason = 'retention_expired';
        if (job.status === 'completed') {
          reason = 'print_completed';
        } else if (job.status === 'cancelled') {
          reason = 'job_cancelled';
        }

        // 4. Record immutable deletion log
        const deletionLog = await this.deletionLogsRepo.create({
          job_id: job.id,
          document_storage_key: job.document_storage_key,
          deleted_by: 'cloud_ttl_sweeper',
          reason
        });

        // 5. Append audit event to job_events ledger (sanitized, zero document bytes)
        await this.jobEventsRepo.create({
          job_id: job.id,
          actor_type: 'system',
          to_status: job.status,
          event_name: 'document_purged',
          metadata: {
            deletion_log_id: deletionLog.id,
            deleted_by: 'cloud_ttl_sweeper',
            reason,
            price_total_paise: job.price_total_paise,
            priority_tier: job.priority_tier
          }
        });

        purgedCount += 1;
      } catch (err: unknown) {
        // Safe retry: do not advance or corrupt state if deletion failed
        const msg = err instanceof Error ? err.message : 'Unknown storage deletion error';
        errors.push({ id: job.id, message: msg });
      }
    }

    return {
      scanned: expiredJobs.length,
      purged: purgedCount,
      errors
    };
  }

  /**
   * Sweeps and destroys storage objects for expired standalone documents.
   */
  async sweepExpiredDocuments(
    now: Date = new Date(),
    limit: number = 100
  ): Promise<{
    scanned: number;
    purged: number;
    errors: Array<{ id: string; message: string }>;
  }> {
    const expiredDocs = this.documentsRepo.findExpiredForPurge
      ? await this.documentsRepo.findExpiredForPurge(now, limit)
      : [];

    let purgedCount = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const doc of expiredDocs) {
      if (doc.status === 'purged') {
        continue;
      }

      try {
        // 1. Delete source storage object
        await this.storageService.deleteObject(doc.storage_key);

        // 2. Delete converted normalized PDF if present
        if (doc.converted_storage_key) {
          await this.storageService.deleteObject(doc.converted_storage_key);
        }

        // 3. Update document status to purged
        if (this.documentsRepo.purge) {
          await this.documentsRepo.purge(doc.id);
        } else {
          await this.documentsRepo.update(doc.id, { status: 'purged' });
        }

        // 4. Record immutable deletion log
        await this.deletionLogsRepo.create({
          document_id: doc.id,
          document_storage_key: doc.storage_key,
          deleted_by: 'cloud_ttl_sweeper',
          reason: 'retention_expired'
        });

        purgedCount += 1;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown storage deletion error';
        errors.push({ id: doc.id, message: msg });
      }
    }

    return {
      scanned: expiredDocs.length,
      purged: purgedCount,
      errors
    };
  }

  /**
   * Runs complete privacy retention sweep.
   */
  async runFullSweep(now: Date = new Date(), limit: number = 100): Promise<SweepResults> {
    const jobSweep = await this.sweepExpiredPrintJobs(now, limit);
    const docSweep = await this.sweepExpiredDocuments(now, limit);

    return {
      timestamp: now.toISOString(),
      jobs_scanned: jobSweep.scanned,
      jobs_purged: jobSweep.purged,
      documents_scanned: docSweep.scanned,
      documents_purged: docSweep.purged,
      errors: [
        ...jobSweep.errors.map(e => ({ id: e.id, target: 'job' as const, message: e.message })),
        ...docSweep.errors.map(e => ({ id: e.id, target: 'document' as const, message: e.message }))
      ]
    };
  }

  /**
   * Returns immutable privacy policy parameters and hardware boundary disclosure.
   */
  getPrivacyPolicy(): PrivacyPolicyDisclosure {
    return {
      terminal_retention_minutes: this.terminalRetentionMs / (60 * 1000),
      hard_ttl_hours: this.hardTtlMs / (60 * 60 * 1000),
      local_temp_cleanup: 'try_finally_immediate_and_crash_recovery',
      audit_metadata_retention:
        'Page counts, pricing breakdowns, durations, and timestamps are retained permanently for bookkeeping and audit verification without document payloads.',
      spooler_privacy_caveat:
        'Application cleanup guarantees destruction of private object storage artifacts and local application temp files. It cannot guarantee erasure of operating system print spooler files (.SPL) or printer hardware onboard memory.'
    };
  }

  /**
   * Fetches recent audit trail of document destructions.
   */
  async getAuditLogs(limit: number = 100): Promise<DocumentDeletionLog[]> {
    return this.deletionLogsRepo.findAll(limit);
  }
}
