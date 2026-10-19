import type { PrintJob } from './print-jobs.types.js';
import type { IJobAttemptsRepository } from '../attempts/attempts.repository.js';
import type { JobAttempt } from '../attempts/attempts.types.js';

export class JobNotClaimableError extends Error {
  constructor(message: string, public readonly code = 'JOB_NOT_CLAIMABLE') {
    super(message);
    this.name = 'JobNotClaimableError';
  }
}

export interface ClaimJobInput {
  job: PrintJob;
  printer_id: string;
  agent_device_id: string;
  idempotency_key: string;
  lease_duration_ms?: number | undefined;
}

export class JobClaimService {
  constructor(private readonly attemptsRepo: IJobAttemptsRepository) {}

  /**
   * Verifies whether a print job is eligible for agent claim.
   *
   * CRITICAL SECURITY & BUSINESS INVARIANTS:
   * 1. A job in 'pending_payment' status CAN NEVER be claimed or printed!
   *    Payment must be fully verified and enqueued before physical output.
   * 2. Only jobs in 'queued' or 'approved' status are eligible for claim.
   * 3. Cannot claim if an active lease/attempt already exists for the job.
   */
  static verifyEligibility(job: PrintJob): void {
    if (job.status === 'pending_payment') {
      throw new JobNotClaimableError(
        `Job '${job.id}' is pending payment. Unpaid print jobs cannot be claimed by print agents.`,
        'PAYMENT_PENDING'
      );
    }

    if (job.status !== 'queued' && job.status !== 'approved') {
      throw new JobNotClaimableError(
        `Job '${job.id}' is in status '${job.status}'. Only 'queued' or 'approved' jobs can be claimed.`,
        'INVALID_STATUS'
      );
    }
  }

  async claimJob(input: ClaimJobInput): Promise<JobAttempt> {
    // 1. Verify eligibility (strictly blocks pending_payment jobs)
    JobClaimService.verifyEligibility(input.job);

    // 2. Concurrency check: Ensure no active attempt already exists
    const existingActive = await this.attemptsRepo.findActiveByJobId(input.job.id);
    if (existingActive) {
      throw new JobNotClaimableError(
        `Job '${input.job.id}' already has an active lease held by attempt '${existingActive.id}'.`,
        'JOB_ALREADY_LEASED'
      );
    }

    const duration = input.lease_duration_ms ?? 5 * 60 * 1000; // 5 minutes default lease
    const leaseExpiresAt = new Date(Date.now() + duration).toISOString();

    // 3. Atomically create job attempt
    return this.attemptsRepo.create({
      job_id: input.job.id,
      printer_id: input.printer_id,
      agent_device_id: input.agent_device_id,
      lease_expires_at: leaseExpiresAt,
      idempotency_key: input.idempotency_key,
      status: 'leased'
    });
  }
}
