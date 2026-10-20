/**
 * Automated Document Cleanup Job for CAPS.
 *
 * Runs on cron or on-demand to enforce ADR 0007 privacy lifecycle:
 * - Purges private cloud storage objects after 30-min terminal status or 24h TTL.
 * - Records immutable deletion traces in document_deletion_logs.
 * - Sanitizes audit events in job_events without document payload data.
 */

import type {
  PrivacyRetentionService,
  SweepResults
} from '../modules/documents/privacy-retention.service.js';

export interface IDocumentCleanupJob {
  run(now?: Date): Promise<SweepResults>;
  start(cronIntervalMs?: number): void;
  stop(): void;
}

export class DocumentCleanupJob implements IDocumentCleanupJob {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(
    private readonly privacyService: PrivacyRetentionService,
    private readonly defaultIntervalMs: number = 5 * 60 * 1000 // Every 5 minutes
  ) {}

  /**
   * Executes a single sweep cycle.
   */
  async run(now: Date = new Date()): Promise<SweepResults> {
    if (this.isRunning) {
      // Avoid overlapping runs
      return {
        timestamp: now.toISOString(),
        jobs_scanned: 0,
        jobs_purged: 0,
        documents_scanned: 0,
        documents_purged: 0,
        errors: [{ id: 'sweeper', target: 'job', message: 'Cleanup job is already in progress' }]
      };
    }

    this.isRunning = true;
    try {
      return await this.privacyService.runFullSweep(now);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Starts periodic background sweeping timer.
   */
  start(cronIntervalMs?: number): void {
    if (this.timer) return;
    const interval = cronIntervalMs ?? this.defaultIntervalMs;

    this.timer = setInterval(() => {
      this.run().catch((err: unknown) => {
        // Log error without blowing up node process
        console.error('Unhandled error in DocumentCleanupJob execution:', err);
      });
    }, interval);
  }

  /**
   * Stops periodic timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
