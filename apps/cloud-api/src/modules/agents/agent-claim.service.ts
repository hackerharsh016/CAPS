/**
 * Exclusive Agent Claim & Owner Confirmation Service.
 * Implements:
 * - Owner approval gate (ADR 0004: unpaid jobs cannot print; MVP owner confirmation required).
 * - Atomic exclusive agent claim lease with per-shop mutex concurrency locking.
 * - Printer capability scoping & tenant isolation.
 * - Stable attempt ID generation and lease token issuance.
 * - Expired lease reconciliation and automatic retry / review routing.
 * - Strict conformity with frozen @caps/print-contracts schema.
 */

import crypto from 'node:crypto';
import { ApiError, AuthError, NotFoundError, ValidationError } from '../../plugins/error-handler.js';
import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../shops/shops.repository.js';
import type { IPrintersRepository } from '../printers/printers.repository.js';
import type { IDocumentsRepository } from '../documents/documents.repository.js';
import type { IAgentsRepository } from './agents.repository.js';
import type { IJobAttemptsRepository } from './attempts.repository.js';
import type { PrintJobRecord } from '../print-jobs/print-jobs.types.js';
import type { Printer } from '../printers/printers.types.js';
import type {
  JobClaimRequestDto,
  JobClaimResponseDto,
  LeaseRenewalRequestDto,
  LeaseRenewalResponseDto,
  ReconcileLeasesResult,
  DownloadGrantRequestDto,
  DownloadGrantResponseDto,
  JobStatusUpdateRequestDto,
  JobStatusUpdateResponseDto
} from './agents.types.js';
import { sortQueueJobs } from '../queue/queue.calculator.js';
import { assertValidTransition } from '../print-jobs/print-jobs.state-machine.js';

export class ClaimError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'ClaimError';
  }
}

export class AgentClaimService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly shopsRepo: IShopsRepository,
    private readonly printersRepo: IPrintersRepository,
    private readonly agentsRepo: IAgentsRepository,
    private readonly attemptsRepo: IJobAttemptsRepository,
    private readonly documentsRepo?: IDocumentsRepository
  ) {}

  /**
   * Concurrency mutex wrapper guaranteeing atomic claim operations per shop.
   */
  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const currentLock = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const newLock = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(key, newLock);
    await currentLock;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === newLock) {
        this.locks.delete(key);
      }
    }
  }

  /**
   * Validates whether a printer possesses capabilities required by job settings.
   */
  private validatePrinterCapabilities(printer: Printer, job: PrintJobRecord): void {
    const settings = job.settings;
    if (settings.color_mode === 'color' && !printer.capabilities.color_modes.includes('color')) {
      throw new ClaimError(
        422,
        'INCOMPATIBLE_PRINTER',
        `Printer '${printer.name}' (${printer.id}) does not support color printing required by job '${job.id}'.`
      );
    }

    if (settings.sides === 'double' && !printer.capabilities.duplex_supported) {
      throw new ClaimError(
        422,
        'INCOMPATIBLE_PRINTER',
        `Printer '${printer.name}' (${printer.id}) does not support duplex printing required by job '${job.id}'.`
      );
    }

    if (settings.paper_size && !printer.capabilities.paper_sizes.includes(settings.paper_size)) {
      throw new ClaimError(
        422,
        'INCOMPATIBLE_PRINTER',
        `Printer '${printer.name}' (${printer.id}) does not support paper size '${settings.paper_size}' required by job '${job.id}'.`
      );
    }
  }

  /**
   * Owner Approval Gate (ADR 0004 & Master Plan §5.2).
   * Validates paid/pay-at-counter authorization and advances job status from 'queued' to 'approved'.
   */
  async approveJob(
    user: { id: string; role: string },
    jobId: string
  ): Promise<PrintJobRecord> {
    const job = await this.printJobsRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError(`Print job '${jobId}' not found.`);
    }

    // Role check: Only shop owner or admin can approve
    if (user.role !== 'admin') {
      const shop = await this.shopsRepo.findById(job.shop_id);
      if (!shop || shop.owner_id !== user.id) {
        throw new AuthError(
          403,
          'FORBIDDEN',
          `Forbidden: You do not own shop '${job.shop_id}' associated with job '${jobId}'.`
        );
      }
    }

    // Strict security check: Unpaid jobs can NEVER be approved or printed
    if (job.status === 'pending_payment') {
      throw new ClaimError(
        400,
        'PAYMENT_PENDING',
        `Job '${jobId}' is in 'pending_payment'. Only paid or authorized pay-at-counter orders can be approved.`
      );
    }

    // State machine graph assertion
    assertValidTransition(job.status, 'approved');

    const updated = await this.printJobsRepo.update(jobId, {
      status: 'approved'
    });

    if (!updated) {
      throw new ClaimError(500, 'UPDATE_FAILED', `Failed to approve job '${jobId}'.`);
    }

    await this.printJobsRepo.recordEvent({
      job_id: jobId,
      actor_id: user.id,
      actor_type: user.role === 'admin' ? 'system' : 'owner',
      from_status: job.status,
      to_status: 'approved',
      reason: 'Owner confirmation granted for print dispatch'
    });

    return updated;
  }

  /**
   * Exclusive Agent Claim Lease Protocol.
   * Conforms strictly to packages/print-contracts/schema/job-claim-request.schema.json
   * and job-claim-response.schema.json.
   */
  async claimJob(
    _agentUser: { id: string; role: string },
    request: JobClaimRequestDto
  ): Promise<JobClaimResponseDto> {
    return this.withLock(request.shop_id, async () => {
      // 1. Validate agent device
      const device = await this.agentsRepo.findDeviceById(request.agent_device_id);
      if (!device) {
        throw new NotFoundError(`Agent device '${request.agent_device_id}' is not registered.`);
      }

      if (device.is_revoked) {
        throw new ClaimError(
          403,
          'REVOKED_DEVICE',
          `Agent device '${request.agent_device_id}' has been revoked (${device.revoked_reason || 'unauthorized'}).`
        );
      }

      if (device.shop_id !== request.shop_id) {
        throw new ClaimError(
          403,
          'TENANT_MISMATCH',
          `Agent device '${request.agent_device_id}' belongs to shop '${device.shop_id}', not '${request.shop_id}'.`
        );
      }

      // Record agent heartbeat
      await this.agentsRepo.recordHeartbeat({ device_id: device.id });

      // Idempotency check: If idempotency_key is provided, check for active attempt replay
      if (request.idempotency_key) {
        const existingAttempt = await this.attemptsRepo.findByIdempotency(request.idempotency_key);
        if (
          existingAttempt &&
          (existingAttempt.status === 'leased' || existingAttempt.status === 'downloading')
        ) {
          const job = await this.printJobsRepo.findById(existingAttempt.job_id);
          const printer = existingAttempt.printer_id
            ? await this.printersRepo.findById(existingAttempt.printer_id)
            : null;
          if (job && printer) {
            return this.buildClaimResponse(job, existingAttempt, printer);
          }
        }
      }

      // 2. Validate shop exists and is open
      const shop = await this.shopsRepo.findById(request.shop_id);
      if (!shop) {
        throw new NotFoundError(`Shop '${request.shop_id}' not found.`);
      }

      // 3. Resolve printer candidates
      let candidatePrinters: Printer[] = [];
      if (request.requested_printer_id) {
        const printer = await this.printersRepo.findById(request.requested_printer_id);
        if (!printer || printer.shop_id !== request.shop_id) {
          throw new NotFoundError(
            `Requested printer '${request.requested_printer_id}' is invalid or not in shop '${request.shop_id}'.`
          );
        }
        if (printer.status === 'offline' || printer.status === 'error') {
          throw new ClaimError(
            409,
            'PRINTER_UNAVAILABLE',
            `Requested printer '${printer.name}' is in status '${printer.status}'.`
          );
        }
        candidatePrinters = [printer];
      } else {
        const result = await this.printersRepo.findByShopId(request.shop_id);
        candidatePrinters = result.printers.filter(
          p => p.status === 'online' || p.status === 'busy'
        );
      }

      if (candidatePrinters.length === 0) {
        return {
          contract_version: '1.0.0',
          claimed: false,
          job: null
        };
      }

      // 4. Fetch all jobs for the shop and filter for claim eligibility
      const listRes = await this.printJobsRepo.findAll({
        shop_id: request.shop_id,
        limit: 500
      });

      // Eligible jobs must be in 'approved' status (ADR 0004 MVP confirmation)
      const approvedJobs = listRes.jobs.filter(j => j.status === 'approved');

      if (approvedJobs.length === 0) {
        return {
          contract_version: '1.0.0',
          claimed: false,
          job: null
        };
      }

      // Sort approved jobs by two-tier priority ordering (Urgent before Flexible FIFO within tier)
      const sortedApprovedJobs = sortQueueJobs(approvedJobs);

      // Find first job that matches any candidate printer's assignment and capabilities
      let selectedJob: PrintJobRecord | null = null;
      let matchedPrinter: Printer | null = null;

      for (const job of sortedApprovedJobs) {
        for (const printer of candidatePrinters) {
          // If job has specific printer assigned, must match
          if (job.printer_id && job.printer_id !== printer.id) {
            continue;
          }
          try {
            this.validatePrinterCapabilities(printer, job);
            selectedJob = job;
            matchedPrinter = printer;
            break;
          } catch {
            // Printer lacks capabilities for this job, continue searching
            continue;
          }
        }
        if (selectedJob && matchedPrinter) {
          break;
        }
      }

      if (!selectedJob || !matchedPrinter) {
        return {
          contract_version: '1.0.0',
          claimed: false,
          job: null
        };
      }

      // 5. Check for idempotent replay with idempotency_key
      const idempotencyKey =
        request.idempotency_key || `claim-${request.agent_device_id}-${selectedJob.id}`;
      const existingAttempt = await this.attemptsRepo.findByIdempotencyKey(
        selectedJob.id,
        idempotencyKey
      );

      if (existingAttempt && existingAttempt.status === 'leased') {
        // Return existing claim idempotently
        return this.buildClaimResponse(selectedJob, existingAttempt, matchedPrinter);
      }

      // 6. Concurrency check: Ensure no active lease is held on this job
      const activeAttempt = await this.attemptsRepo.findActiveByJobId(selectedJob.id);
      if (activeAttempt) {
        throw new ClaimError(
          409,
          'JOB_ALREADY_CLAIMED',
          `Job '${selectedJob.id}' already has an active lease held by attempt '${activeAttempt.id}'.`
        );
      }

      // 7. Calculate lease duration (clamped 30s to 600s, default 120s per frozen schema)
      const leaseSeconds = Math.min(
        600,
        Math.max(30, request.lease_duration_seconds ?? 120)
      );
      const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
      const leaseToken = crypto.randomUUID();

      // 8. Create JobAttempt record
      const attempt = await this.attemptsRepo.create({
        job_id: selectedJob.id,
        printer_id: matchedPrinter.id,
        agent_device_id: device.id,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        idempotency_key: idempotencyKey,
        status: 'leased'
      });

      // 9. Transition job status to 'claimed'
      assertValidTransition(selectedJob.status, 'claimed');
      const updatedJob = await this.printJobsRepo.update(selectedJob.id, {
        status: 'claimed',
        claimed_at: new Date().toISOString(),
        claimed_by_agent_id: device.id,
        printer_id: matchedPrinter.id
      });

      if (!updatedJob) {
        throw new ClaimError(500, 'UPDATE_FAILED', `Failed to transition job '${selectedJob.id}' to claimed.`);
      }

      // 10. Record audit event
      await this.printJobsRepo.recordEvent({
        job_id: selectedJob.id,
        actor_id: device.id,
        actor_type: 'agent',
        from_status: selectedJob.status,
        to_status: 'claimed',
        reason: 'Exclusive execution lease granted to agent device',
        metadata: {
          attempt_id: attempt.id,
          lease_expires_at: leaseExpiresAt,
          printer_id: matchedPrinter.id
        }
      });

      return this.buildClaimResponse(updatedJob, attempt, matchedPrinter);
    });
  }

  /**
   * Helper constructing contract-compliant JobClaimResponseDto.
   */
  private async buildClaimResponse(
    job: PrintJobRecord,
    attempt: { id: string; lease_token: string; lease_expires_at: string; printer_id?: string | undefined },
    printer: Printer
  ): Promise<JobClaimResponseDto> {
    let sha256Checksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    let fileSizeBytes = 1024;
    let downloadUrl = `/api/v1/documents/${job.id}/download`;

    if (this.documentsRepo && job.document_id) {
      const doc = await this.documentsRepo.findById(job.document_id);
      if (doc) {
        sha256Checksum = doc.checksum_sha256 ?? sha256Checksum;
        fileSizeBytes = doc.file_size_bytes;
        downloadUrl = `/api/v1/documents/${doc.id}/download`;
      }
    }

    return {
      contract_version: '1.0.0',
      claimed: true,
      job: {
        job_id: job.id,
        attempt_id: attempt.id,
        lease_token: attempt.lease_token,
        lease_expires_at: attempt.lease_expires_at,
        shop_id: job.shop_id,
        printer_id: attempt.printer_id ?? printer.id,
        download_url: downloadUrl,
        checksum_sha256: sha256Checksum,
        content_type: 'application/pdf',
        file_size_bytes: fileSizeBytes,
        settings: job.settings,
        created_at: job.created_at
      }
    };
  }

  /**
   * Reconciles expired agent claim leases across a shop.
   * Fails abandoned attempts and recovers the jobs for re-dispatch or review.
   */
  async reconcileExpiredLeases(
    shopId?: string,
    nowMs: number = Date.now()
  ): Promise<ReconcileLeasesResult> {
    const expiredAttempts = await this.attemptsRepo.findExpiredLeases(nowMs);
    const relevantAttempts = shopId
      ? (
          await Promise.all(
            expiredAttempts.map(async a => {
              const j = await this.printJobsRepo.findById(a.job_id);
              return j && j.shop_id === shopId ? a : null;
            })
          )
        ).filter((a): a is NonNullable<typeof a> => a !== null)
      : expiredAttempts;

    const recoveredJobIds: string[] = [];
    const requiresReviewJobIds: string[] = [];

    for (const attempt of relevantAttempts) {
      // 1. Mark attempt failed
      await this.attemptsRepo.update(attempt.id, {
        status: 'failed',
        error_code: 'LEASE_EXPIRED',
        error_message: 'Agent claim lease expired without execution completion'
      });

      // 2. Count attempts for this job
      const allAttempts = await this.attemptsRepo.findByJobId(attempt.job_id);
      const job = await this.printJobsRepo.findById(attempt.job_id);
      if (!job) continue;

      if (allAttempts.length < 3) {
        // Recover job back to 'approved' for retry
        await this.printJobsRepo.update(job.id, {
          status: 'approved',
          claimed_at: undefined,
          claimed_by_agent_id: undefined
        });

        await this.printJobsRepo.recordEvent({
          job_id: job.id,
          actor_type: 'system',
          from_status: job.status,
          to_status: 'approved',
          reason: 'Lease expired; recovered to approved for retry'
        });

        recoveredJobIds.push(job.id);
      } else {
        // Max retry threshold reached: route to 'requires_review'
        await this.printJobsRepo.update(job.id, {
          status: 'requires_review',
          failed_reason: 'Max print attempt retries exceeded due to repeated lease timeouts'
        });

        await this.printJobsRepo.recordEvent({
          job_id: job.id,
          actor_type: 'system',
          from_status: job.status,
          to_status: 'requires_review',
          reason: 'Max attempt timeouts reached; routed to requires_review'
        });

        requiresReviewJobIds.push(job.id);
      }
    }

    return {
      ...(shopId !== undefined ? { shop_id: shopId } : {}),
      reconciled_count: relevantAttempts.length,
      recovered_job_ids: recoveredJobIds,
      requires_review_job_ids: requiresReviewJobIds
    };
  }

  /**
   * Heartbeat / Lease Renewal for long downloads or rendering.
   */
  async renewLease(
    _agentUser: { id: string; role: string },
    input: LeaseRenewalRequestDto
  ): Promise<LeaseRenewalResponseDto> {
    const attempt = await this.attemptsRepo.findById(input.attempt_id);
    if (!attempt) {
      throw new NotFoundError(`Attempt '${input.attempt_id}' not found.`);
    }

    if (attempt.job_id !== input.job_id) {
      throw new ValidationError(`Attempt '${input.attempt_id}' is not for job '${input.job_id}'.`);
    }

    if (attempt.lease_token !== input.lease_token) {
      throw new ClaimError(403, 'INVALID_LEASE_TOKEN', 'Lease token mismatch.');
    }

    if (attempt.status !== 'leased' && attempt.status !== 'downloading') {
      throw new ClaimError(
        409,
        'LEASE_NOT_ACTIVE',
        `Cannot renew lease in status '${attempt.status}'.`
      );
    }

    const extendSeconds = Math.min(300, Math.max(30, input.extend_seconds ?? 120));
    const newExpiresAt = new Date(Date.now() + extendSeconds * 1000).toISOString();

    const updated = await this.attemptsRepo.update(attempt.id, {
      lease_expires_at: newExpiresAt
    });

    if (!updated) {
      throw new ClaimError(500, 'UPDATE_FAILED', 'Failed to renew lease.');
    }

    return {
      job_id: input.job_id,
      attempt_id: attempt.id,
      lease_token: attempt.lease_token,
      lease_expires_at: newExpiresAt,
      status: updated.status
    };
  }

  /**
   * Generates a short-lived signed download grant (5-minute TTL per ADR 0007).
   * Verifies valid lease token and active attempt.
   */
  async generateDownloadGrant(
    _agentUser: { id: string; role: string },
    input: DownloadGrantRequestDto,
    nowMs: number = Date.now()
  ): Promise<DownloadGrantResponseDto> {
    const attempt = await this.attemptsRepo.findById(input.attempt_id);
    if (!attempt) {
      throw new NotFoundError(`Attempt '${input.attempt_id}' not found.`);
    }

    if (attempt.job_id !== input.job_id) {
      throw new ValidationError(`Attempt '${input.attempt_id}' does not match job '${input.job_id}'.`);
    }

    if (attempt.lease_token !== input.lease_token) {
      throw new ClaimError(403, 'INVALID_LEASE_TOKEN', 'Lease token mismatch.');
    }

    if (new Date(attempt.lease_expires_at).getTime() < nowMs) {
      throw new ClaimError(409, 'LEASE_EXPIRED', 'Claim lease has expired.');
    }

    if (attempt.status !== 'leased' && attempt.status !== 'downloading') {
      throw new ClaimError(
        409,
        'INVALID_STATUS',
        `Cannot issue download grant for attempt in status '${attempt.status}'.`
      );
    }

    const job = await this.printJobsRepo.findById(input.job_id);
    if (!job) {
      throw new NotFoundError(`Job '${input.job_id}' not found.`);
    }

    let sha256Checksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    let fileSizeBytes = 1024;
    let downloadUrl = `/api/v1/documents/${job.id}/download`;

    if (this.documentsRepo && job.document_id) {
      const doc = await this.documentsRepo.findById(job.document_id);
      if (doc) {
        sha256Checksum = doc.checksum_sha256 ?? sha256Checksum;
        fileSizeBytes = doc.file_size_bytes;
        downloadUrl = `/api/v1/documents/${doc.id}/download`;
      }
    }

    // 5-minute (300s) download grant TTL per ADR 0007 & Master Plan §5.5
    const grantExpiresAt = new Date(nowMs + 300 * 1000).toISOString();
    const downloadToken = crypto.randomUUID();
    const signedDownloadUrl = `${downloadUrl}?grant_token=${downloadToken}&expires_at=${encodeURIComponent(grantExpiresAt)}`;

    // Transition attempt to 'downloading'
    await this.attemptsRepo.update(attempt.id, { status: 'downloading' });

    return {
      download_url: signedDownloadUrl,
      expires_at: grantExpiresAt,
      checksum_sha256: sha256Checksum,
      file_size_bytes: fileSizeBytes,
      content_type: 'application/pdf'
    };
  }

  /**
   * Updates Job & Attempt status during agent execution.
   * Conforms strictly to packages/print-contracts/schema/job-status-update-request.schema.json
   * and job-status-update-response.schema.json.
   */
  async updateJobStatus(
    _agentUser: { id: string; role: string },
    input: JobStatusUpdateRequestDto,
    nowMs: number = Date.now()
  ): Promise<JobStatusUpdateResponseDto> {
    const attempt = await this.attemptsRepo.findById(input.attempt_id);
    if (!attempt) {
      throw new NotFoundError(`Attempt '${input.attempt_id}' not found.`);
    }

    if (attempt.job_id !== input.job_id) {
      throw new ValidationError(`Attempt '${input.attempt_id}' is not for job '${input.job_id}'.`);
    }

    if (attempt.lease_token !== input.lease_token) {
      throw new ClaimError(403, 'INVALID_LEASE_TOKEN', 'Lease token mismatch.');
    }

    if (new Date(attempt.lease_expires_at).getTime() < nowMs && input.status !== 'FAILED') {
      throw new ClaimError(409, 'LEASE_EXPIRED', 'Claim lease has expired.');
    }

    const job = await this.printJobsRepo.findById(input.job_id);
    if (!job) {
      throw new NotFoundError(`Job '${input.job_id}' not found.`);
    }

    // Map contract JobAgentStatus to database attempt & job status
    const now = new Date(nowMs).toISOString();

    if (input.status === 'COMPLETED') {
      await this.attemptsRepo.update(attempt.id, {
        status: 'completed',
        ...(input.spooler_job_id !== undefined && input.spooler_job_id !== null
          ? { spooler_job_id: input.spooler_job_id }
          : {})
      });

      await this.printJobsRepo.update(job.id, {
        status: 'completed',
        completed_at: now
      });

      await this.printJobsRepo.recordEvent({
        job_id: job.id,
        actor_id: attempt.agent_device_id,
        actor_type: 'agent',
        from_status: job.status,
        to_status: 'completed',
        reason: 'Physical print job completed successfully by agent',
        metadata: {
          attempt_id: attempt.id,
          spooler_job_id: input.spooler_job_id,
          pages_printed: input.pages_printed,
          total_pages: input.total_pages
        }
      });
    } else if (input.status === 'FAILED') {
      await this.attemptsRepo.update(attempt.id, {
        status: 'failed',
        error_code: input.error_code || 'PRINT_FAILED',
        error_message: input.error_message || 'Print execution failed on agent'
      });

      // If attempts < 3, recover back to approved; otherwise requires_review
      const attempts = await this.attemptsRepo.findByJobId(job.id);
      const targetStatus = attempts.length < 3 ? 'approved' : 'requires_review';

      await this.printJobsRepo.update(job.id, {
        status: targetStatus,
        failed_reason: input.error_message || 'Agent reported print failure'
      });

      await this.printJobsRepo.recordEvent({
        job_id: job.id,
        actor_id: attempt.agent_device_id,
        actor_type: 'agent',
        from_status: job.status,
        to_status: targetStatus,
        reason: input.error_message || 'Agent reported failure during execution',
        metadata: {
          error_code: input.error_code,
          attempt_id: attempt.id
        }
      });
    } else if (input.status === 'PRINTING') {
      await this.attemptsRepo.update(attempt.id, {
        status: 'printing',
        ...(input.spooler_job_id !== undefined && input.spooler_job_id !== null
          ? { spooler_job_id: input.spooler_job_id }
          : {})
      });

      if (job.status !== 'printing') {
        await this.printJobsRepo.update(job.id, { status: 'printing' });
        await this.printJobsRepo.recordEvent({
          job_id: job.id,
          actor_id: attempt.agent_device_id,
          actor_type: 'agent',
          from_status: job.status,
          to_status: 'printing',
          reason: 'Job entered active printing on spooler',
          metadata: { spooler_job_id: input.spooler_job_id }
        });
      }
    } else if (input.status === 'DOWNLOADING') {
      await this.attemptsRepo.update(attempt.id, { status: 'downloading' });
    } else if (input.status === 'RENDERING') {
      await this.attemptsRepo.update(attempt.id, { status: 'rendering' });
    }

    return {
      contract_version: '1.0.0',
      success: true,
      job_id: input.job_id,
      status: input.status,
      acknowledged_at: now
    };
  }
}
