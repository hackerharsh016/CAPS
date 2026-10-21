/**
 * Integration Orchestrator for Owner→Cloud→Agent→Spooler Vertical Slice (P05-M05-F02).
 * Implements atomic transactional state progression across the four trust boundaries:
 * Customer Client -> Owner Dashboard -> Cloud State Machine -> Desktop Agent -> Win32 Spooler.
 */

import type { E2EPrintJob } from '../fixtures/integration-fixtures';
import { FakeWindowsSpooler } from './fake-windows-spooler';

export interface AgentClaimResult {
  claimed: boolean;
  job?: E2EPrintJob | undefined;
  leaseToken?: string | undefined;
  leaseExpiresAt?: string | undefined;
  idempotencyKey?: string | undefined;
  error?: string | undefined;
}

export interface OwnerApprovalResult {
  success: boolean;
  jobId: string;
  status: string;
  error?: string | undefined;
}

export interface SpoolerSubmissionResult {
  success: boolean;
  spoolerJobId?: number | undefined;
  jobStatus: string;
  error?: string | undefined;
}

export interface ImmutableEventLog {
  id: number;
  jobId: string;
  actorType: 'customer' | 'owner' | 'agent' | 'system';
  actorId: string;
  fromStatus: string;
  toStatus: string;
  eventName: string;
  timestamp: string;
}

export class IntegrationOrchestrator {
  private readonly jobs = new Map<string, E2EPrintJob>();
  private readonly activeLeases = new Map<
    string,
    { agentDeviceId: string; leaseToken: string; expiresAt: number; idempotencyKey: string }
  >();
  private readonly auditEvents: ImmutableEventLog[] = [];
  private readonly deletedDocumentsLog: Array<{
    jobId: string;
    storageKey: string;
    reason: string;
    deletedAt: string;
  }> = [];
  private eventSequence = 0;

  public readonly spooler = new FakeWindowsSpooler();

  /**
   * Initializes orchestrator with test jobs.
   */
  seedJobs(jobsList: E2EPrintJob[]) {
    for (const job of jobsList) {
      this.jobs.set(job.id, { ...job });
    }
  }

  getJob(jobId: string): E2EPrintJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  getAuditEvents(jobId?: string): ImmutableEventLog[] {
    if (jobId) {
      return this.auditEvents.filter(e => e.jobId === jobId);
    }
    return [...this.auditEvents];
  }

  getDeletedDocumentsLog(): Array<{
    jobId: string;
    storageKey: string;
    reason: string;
    deletedAt: string;
  }> {
    return [...this.deletedDocumentsLog];
  }

  /**
   * Step 2: Owner Print Confirmation (One-Tap Confirmation Flow).
   * Verifies owner identity, tenant shop ownership, and valid payment status.
   */
  ownerApproveJob(params: {
    jobId: string;
    ownerUserId: string;
    ownerShopId: string;
    confirmAtCounter?: boolean | undefined;
  }): OwnerApprovalResult {
    const job = this.jobs.get(params.jobId);
    if (!job) {
      return { success: false, jobId: params.jobId, status: 'not_found', error: 'JOB_NOT_FOUND' };
    }

    // Tenant Isolation Check: Owner cannot approve jobs from another shop
    if (job.shop_id !== params.ownerShopId) {
      return {
        success: false,
        jobId: params.jobId,
        status: job.status,
        error: 'UNAUTHORIZED_CROSS_SHOP: Cannot approve jobs belonging to other shops.'
      };
    }

    // Payment Precondition: Must be paid OR authorized at counter
    const isPaid = job.payment_status === 'paid';
    const isCounterAuthorized =
      job.payment_status === 'pay_at_counter_pending' && params.confirmAtCounter === true;

    if (!isPaid && !isCounterAuthorized) {
      return {
        success: false,
        jobId: params.jobId,
        status: job.status,
        error: 'PAYMENT_REQUIRED: Cannot approve job without verified payment or counter receipt.'
      };
    }

    const previousStatus = job.status;
    job.status = 'approved';
    job.approved_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();

    if (isCounterAuthorized) {
      job.payment_status = 'paid';
    }

    this.recordAuditEvent({
      jobId: job.id,
      actorType: 'owner',
      actorId: params.ownerUserId,
      fromStatus: previousStatus,
      toStatus: 'approved',
      eventName: 'OWNER_CONFIRMED'
    });

    return {
      success: true,
      jobId: job.id,
      status: 'approved'
    };
  }

  /**
   * Step 3: Agent Exclusive Claim with Atomic Lease Token.
   * Mirrors backend RPC `claim_next_approved_job`.
   * Enforces atomic claim: exactly one agent receives the lease.
   */
  agentClaimNextJob(params: {
    shopId: string;
    agentDeviceId: string;
    idempotencyKey: string;
  }): AgentClaimResult {
    // 1. Idempotency check: if agent already claimed with this key, return existing lease
    for (const [jobId, lease] of this.activeLeases.entries()) {
      if (
        lease.agentDeviceId === params.agentDeviceId &&
        lease.idempotencyKey === params.idempotencyKey
      ) {
        const job = this.jobs.get(jobId);
        return {
          claimed: true,
          job,
          leaseToken: lease.leaseToken,
          leaseExpiresAt: new Date(lease.expiresAt).toISOString(),
          idempotencyKey: params.idempotencyKey
        };
      }
    }

    // 2. Find eligible approved jobs in priority order (urgent before flexible, then FIFO)
    const eligibleJobs = Array.from(this.jobs.values())
      .filter(j => j.shop_id === params.shopId && j.status === 'approved')
      .filter(j => !this.activeLeases.has(j.id)) // Not currently leased
      .sort((a, b) => {
        // Urgent priority (tier 0) first, flexible (tier 1) second
        const tierOrder =
          (a.priority_tier === 'urgent' ? 0 : 1) - (b.priority_tier === 'urgent' ? 0 : 1);
        if (tierOrder !== 0) return tierOrder;
        // FIFO by enqueued_at
        const aTime = a.enqueued_at ? new Date(a.enqueued_at).getTime() : 0;
        const bTime = b.enqueued_at ? new Date(b.enqueued_at).getTime() : 0;
        return aTime - bTime;
      });

    if (eligibleJobs.length === 0) {
      return { claimed: false, error: 'NO_APPROVED_JOBS_AVAILABLE' };
    }

    const jobToClaim = eligibleJobs[0]!;
    const leaseToken = `lease-tok-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minute TTL

    // Atomic lease acquisition
    this.activeLeases.set(jobToClaim.id, {
      agentDeviceId: params.agentDeviceId,
      leaseToken,
      expiresAt,
      idempotencyKey: params.idempotencyKey
    });

    const previousStatus = jobToClaim.status;
    jobToClaim.status = 'claimed';
    jobToClaim.updated_at = new Date().toISOString();

    this.recordAuditEvent({
      jobId: jobToClaim.id,
      actorType: 'agent',
      actorId: params.agentDeviceId,
      fromStatus: previousStatus,
      toStatus: 'claimed',
      eventName: 'AGENT_CLAIMED_EXCLUSIVE'
    });

    return {
      claimed: true,
      job: jobToClaim,
      leaseToken,
      leaseExpiresAt: new Date(expiresAt).toISOString(),
      idempotencyKey: params.idempotencyKey
    };
  }

  /**
   * Step 4: Agent Submits to Windows Spooler.
   * Validates active lease and printer connectivity, then submits to Win32 spooler.
   */
  agentSubmitToSpooler(params: {
    jobId: string;
    agentDeviceId: string;
    leaseToken: string;
    printerName: string;
    idempotencyKey: string;
  }): SpoolerSubmissionResult {
    const job = this.jobs.get(params.jobId);
    if (!job) {
      return { success: false, jobStatus: 'unknown', error: 'JOB_NOT_FOUND' };
    }

    const lease = this.activeLeases.get(params.jobId);
    if (!lease || lease.leaseToken !== params.leaseToken) {
      return { success: false, jobStatus: job.status, error: 'INVALID_OR_EXPIRED_LEASE' };
    }

    if (Date.now() > lease.expiresAt) {
      return { success: false, jobStatus: job.status, error: 'LEASE_EXPIRED' };
    }

    // Submit to Win32 Spooler
    const spoolerResult = this.spooler.submitJob({
      printerName: params.printerName,
      documentTitle: job.document_name,
      leaseToken: params.leaseToken,
      idempotencyKey: params.idempotencyKey,
      pages: job.settings.copies * 10 // Mock page count
    });

    if (!spoolerResult.success) {
      // Hardware fault detected
      const previousStatus = job.status;
      job.status = 'requires_review';
      job.updated_at = new Date().toISOString();

      this.recordAuditEvent({
        jobId: job.id,
        actorType: 'agent',
        actorId: params.agentDeviceId,
        fromStatus: previousStatus,
        toStatus: 'requires_review',
        eventName: `SPOOLER_FAULT_${spoolerResult.errorCode}`
      });

      return {
        success: false,
        jobStatus: 'requires_review',
        error: `${spoolerResult.errorCode}: ${spoolerResult.errorMessage}`
      };
    }

    // Transition to printing (NOT completed yet — spooler ID is not physical completion!)
    const previousStatus = job.status;
    job.status = 'printing';
    job.updated_at = new Date().toISOString();

    this.recordAuditEvent({
      jobId: job.id,
      actorType: 'agent',
      actorId: params.agentDeviceId,
      fromStatus: previousStatus,
      toStatus: 'printing',
      eventName: 'SUBMITTED_TO_WIN32_SPOOLER'
    });

    return {
      success: true,
      spoolerJobId: spoolerResult.spoolerJobId,
      jobStatus: 'printing'
    };
  }

  /**
   * Step 5: Hardware Completion Telemetry & Immediate Privacy File Purge.
   */
  agentCompletePrint(params: { jobId: string; agentDeviceId: string; spoolerJobId: number }): {
    success: boolean;
    jobStatus: string;
    error?: string | undefined;
  } {
    const job = this.jobs.get(params.jobId);
    if (!job) {
      return { success: false, jobStatus: 'unknown', error: 'JOB_NOT_FOUND' };
    }

    const completed = this.spooler.completePhysicalPrint(params.spoolerJobId);
    if (!completed) {
      return {
        success: false,
        jobStatus: job.status,
        error: 'PHYSICAL_COMPLETION_UNVERIFIED: Hardware did not finish print'
      };
    }

    const previousStatus = job.status;
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();

    // Release lease
    this.activeLeases.delete(params.jobId);

    // Immediate privacy deletion
    this.deletedDocumentsLog.push({
      jobId: job.id,
      storageKey: job.document_storage_key,
      reason: 'print_completed',
      deletedAt: new Date().toISOString()
    });

    this.recordAuditEvent({
      jobId: job.id,
      actorType: 'agent',
      actorId: params.agentDeviceId,
      fromStatus: previousStatus,
      toStatus: 'completed',
      eventName: 'PHYSICAL_PRINT_COMPLETED_AND_PURGED'
    });

    return {
      success: true,
      jobStatus: 'completed'
    };
  }

  private recordAuditEvent(event: Omit<ImmutableEventLog, 'id' | 'timestamp'>) {
    this.eventSequence += 1;
    this.auditEvents.push({
      ...event,
      id: this.eventSequence,
      timestamp: new Date().toISOString()
    });
  }
}
