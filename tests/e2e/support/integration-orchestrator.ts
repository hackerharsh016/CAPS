/**
 * Integration Orchestrator for Owner→Cloud→Agent→Spooler Vertical Slice &
 * Payment, Privacy and Crash-Recovery E2E Gate (P05-M05-F02 / P07-M03-F02).
 *
 * Implements atomic transactional state progression across the four trust boundaries:
 * Customer Client -> Owner Dashboard -> Cloud State Machine -> Desktop Agent -> Win32 Spooler.
 */

import { createHmac } from 'crypto';
import type { E2EPrintJob, PrinterCapabilities } from '../fixtures/integration-fixtures';
import { FakeWindowsSpooler } from './fake-windows-spooler';

export interface AgentClaimResult {
  claimed: boolean;
  job?: E2EPrintJob | undefined;
  leaseToken?: string | undefined;
  leaseExpiresAt?: string | undefined;
  idempotencyKey?: string | undefined;
  attemptNumber?: number | undefined;
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

export interface WebhookResult {
  success: boolean;
  status:
    'processed' | 'already_processed' | 'signature_invalid' | 'amount_mismatch' | 'job_not_found';
  jobId?: string | undefined;
  paymentId?: string | undefined;
  error?: string | undefined;
}

export interface ImmutableEventLog {
  id: number;
  jobId: string;
  actorType: 'customer' | 'owner' | 'agent' | 'system' | 'gateway';
  actorId: string;
  fromStatus: string;
  toStatus: string;
  eventName: string;
  timestamp: string;
  metadata?: Record<string, unknown> | undefined;
}

export class IntegrationOrchestrator {
  private readonly jobs = new Map<string, E2EPrintJob>();
  private readonly printers = new Map<string, PrinterCapabilities>();
  private readonly activeLeases = new Map<
    string,
    {
      agentDeviceId: string;
      leaseToken: string;
      expiresAt: number;
      idempotencyKey: string;
      attemptNumber: number;
    }
  >();
  private readonly auditEvents: ImmutableEventLog[] = [];
  private readonly processedPaymentIds = new Set<string>();
  private readonly deletedDocumentsLog: Array<{
    jobId: string;
    storageKey: string;
    reason: string;
    deletedAt: string;
  }> = [];
  private readonly localSpoolPurges: Array<{
    jobId: string;
    agentDeviceId: string;
    localTempPath: string;
    purgedAt: string;
  }> = [];

  private eventSequence = 0;

  public readonly spooler = new FakeWindowsSpooler();

  /**
   * Initializes orchestrator with test jobs and registered printers.
   */
  seedJobs(jobsList: E2EPrintJob[]) {
    for (const job of jobsList) {
      this.jobs.set(job.id, { ...job, attempt_count: job.attempt_count ?? 0 });
    }
  }

  seedPrinters(printerList: PrinterCapabilities[]) {
    for (const printer of printerList) {
      this.printers.set(printer.id, { ...printer });
    }
  }

  getJob(jobId: string): E2EPrintJob | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  getLiveQueue(shopId: string): E2EPrintJob[] {
    return Array.from(this.jobs.values())
      .filter(j => j.shop_id === shopId && (j.status === 'queued' || j.status === 'approved'))
      .sort((a, b) => {
        // Priority tier: urgent (tier 0) strictly precedes flexible (tier 1)
        const tierA = a.priority_tier === 'urgent' ? 0 : 1;
        const tierB = b.priority_tier === 'urgent' ? 0 : 1;
        if (tierA !== tierB) return tierA - tierB;

        // Within tier: FIFO by enqueued_at
        const timeA = a.enqueued_at ? new Date(a.enqueued_at).getTime() : 0;
        const timeB = b.enqueued_at ? new Date(b.enqueued_at).getTime() : 0;
        return timeA - timeB;
      });
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

  getLocalSpoolPurges(): Array<{
    jobId: string;
    agentDeviceId: string;
    localTempPath: string;
    purgedAt: string;
  }> {
    return [...this.localSpoolPurges];
  }

  /**
   * Section 1: Razorpay Webhook Processing & Concurrency Protection
   */
  processRazorpayWebhook(params: {
    rawBody: string;
    signature: string;
    webhookSecret: string;
    payload: {
      event: string;
      paymentId: string;
      orderId: string;
      jobId: string;
      amountPaise: number;
    };
  }): WebhookResult {
    // 1. Cryptographic HMAC-SHA256 signature check
    const expectedSignature = createHmac('sha256', params.webhookSecret)
      .update(params.rawBody)
      .digest('hex');

    if (params.signature !== expectedSignature) {
      this.recordAuditEvent({
        jobId: params.payload.jobId,
        actorType: 'gateway',
        actorId: 'razorpay-webhook',
        fromStatus: 'pending_payment',
        toStatus: 'pending_payment',
        eventName: 'WEBHOOK_SIGNATURE_VERIFICATION_FAILED'
      });
      return {
        success: false,
        status: 'signature_invalid',
        error: 'SIGNATURE_INVALID: Webhook cryptographic verification failed.'
      };
    }

    // 2. Concurrency & Idempotency: Prevent duplicate payment recording
    if (this.processedPaymentIds.has(params.payload.paymentId)) {
      return {
        success: true,
        status: 'already_processed',
        paymentId: params.payload.paymentId,
        jobId: params.payload.jobId
      };
    }

    const job = this.jobs.get(params.payload.jobId);
    if (!job) {
      return {
        success: false,
        status: 'job_not_found',
        error: 'JOB_NOT_FOUND: Target job could not be resolved from webhook payload.'
      };
    }

    // 3. Amount & Currency integrity check: Detect underpayment tampering
    if (params.payload.amountPaise < job.price_total_paise) {
      this.recordAuditEvent({
        jobId: job.id,
        actorType: 'gateway',
        actorId: params.payload.paymentId,
        fromStatus: job.status,
        toStatus: job.status,
        eventName: 'PAYMENT_AMOUNT_MISMATCH_REJECTED',
        metadata: {
          expectedPaise: job.price_total_paise,
          receivedPaise: params.payload.amountPaise
        }
      });
      return {
        success: false,
        status: 'amount_mismatch',
        jobId: job.id,
        error: `AMOUNT_MISMATCH: Expected ${job.price_total_paise} paise but received ${params.payload.amountPaise} paise.`
      };
    }

    // 4. Atomic Transition to Queued
    this.processedPaymentIds.add(params.payload.paymentId);

    const prevStatus = job.status;
    job.status = 'queued';
    job.payment_status = 'paid';
    job.enqueued_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();

    this.recordAuditEvent({
      jobId: job.id,
      actorType: 'gateway',
      actorId: params.payload.paymentId,
      fromStatus: prevStatus,
      toStatus: 'queued',
      eventName: 'PAYMENT_VERIFIED_ENQUEUED',
      metadata: {
        paymentId: params.payload.paymentId,
        amountPaise: params.payload.amountPaise,
        priorityTier: job.priority_tier
      }
    });

    return {
      success: true,
      status: 'processed',
      jobId: job.id,
      paymentId: params.payload.paymentId
    };
  }

  /**
   * Section 2: Owner Print Confirmation (One-Tap Confirmation Flow).
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

    if (job.shop_id !== params.ownerShopId) {
      return {
        success: false,
        jobId: params.jobId,
        status: job.status,
        error: 'UNAUTHORIZED_CROSS_SHOP: Cannot approve jobs belonging to other shops.'
      };
    }

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
   * Section 3: Agent Exclusive Claim with Atomic Lease Token & Priority Scheduling.
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
          idempotencyKey: params.idempotencyKey,
          attemptNumber: lease.attemptNumber
        };
      }
    }

    // 2. Priority Queue Selection: Urgent first, then FIFO by enqueued_at
    const eligibleJobs = Array.from(this.jobs.values())
      .filter(j => j.shop_id === params.shopId && j.status === 'approved')
      .filter(j => !this.activeLeases.has(j.id)) // Not currently leased
      .sort((a, b) => {
        const tierOrder =
          (a.priority_tier === 'urgent' ? 0 : 1) - (b.priority_tier === 'urgent' ? 0 : 1);
        if (tierOrder !== 0) return tierOrder;
        const aTime = a.enqueued_at ? new Date(a.enqueued_at).getTime() : 0;
        const bTime = b.enqueued_at ? new Date(b.enqueued_at).getTime() : 0;
        return aTime - bTime;
      });

    if (eligibleJobs.length === 0) {
      return { claimed: false, error: 'NO_APPROVED_JOBS_AVAILABLE' };
    }

    const jobToClaim = eligibleJobs[0]!;
    const attemptNumber = (jobToClaim.attempt_count ?? 0) + 1;
    jobToClaim.attempt_count = attemptNumber;

    const leaseToken = `lease-tok-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minute TTL

    this.activeLeases.set(jobToClaim.id, {
      agentDeviceId: params.agentDeviceId,
      leaseToken,
      expiresAt,
      idempotencyKey: params.idempotencyKey,
      attemptNumber
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
      eventName: 'AGENT_CLAIMED_EXCLUSIVE',
      metadata: { attemptNumber, leaseToken }
    });

    return {
      claimed: true,
      job: jobToClaim,
      leaseToken,
      leaseExpiresAt: new Date(expiresAt).toISOString(),
      idempotencyKey: params.idempotencyKey,
      attemptNumber
    };
  }

  /**
   * Section 4: Lease Expiry & Network Disconnect Recovery
   */
  expireLease(jobId: string): { success: boolean; message: string } {
    const lease = this.activeLeases.get(jobId);
    const job = this.jobs.get(jobId);
    if (!lease || !job) {
      return { success: false, message: 'NO_ACTIVE_LEASE' };
    }

    this.activeLeases.delete(jobId);

    const prevStatus = job.status;
    job.status = 'approved';
    job.updated_at = new Date().toISOString();

    this.recordAuditEvent({
      jobId: job.id,
      actorType: 'system',
      actorId: 'lease-reaper',
      fromStatus: prevStatus,
      toStatus: 'approved',
      eventName: 'AGENT_LEASE_EXPIRED_REQUEUED',
      metadata: {
        expiredAgentDeviceId: lease.agentDeviceId,
        attemptNumber: lease.attemptNumber
      }
    });

    return {
      success: true,
      message: 'Lease expired and job returned to approved state for reclamation.'
    };
  }

  /**
   * Section 5: Document Download by Authenticated Agent
   */
  downloadDocument(params: { jobId: string; agentDeviceId: string; leaseToken: string }): {
    success: boolean;
    data?: string | undefined;
    error?: string | undefined;
  } {
    const job = this.jobs.get(params.jobId);
    if (!job) {
      return { success: false, error: 'JOB_NOT_FOUND' };
    }

    const isPurged = this.deletedDocumentsLog.some(d => d.jobId === params.jobId);
    if (isPurged) {
      return { success: false, error: 'DOCUMENT_PURGED: Document has been securely erased.' };
    }

    const lease = this.activeLeases.get(params.jobId);
    if (!lease || lease.leaseToken !== params.leaseToken) {
      return { success: false, error: 'INVALID_LEASE_TOKEN' };
    }

    return {
      success: true,
      data: `MOCK_PDF_DATA_STREAM_FOR_${job.document_name}`
    };
  }

  /**
   * Section 6: Agent Submits to Windows Spooler with Full Pre-Flight Capability Checks
   */
  agentSubmitToSpooler(params: {
    jobId: string;
    agentDeviceId: string;
    leaseToken: string;
    printerId?: string | undefined;
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

    // 1. Printer Registry & Catalog Validation (when printerId is provided or printers catalog is populated)
    const effectivePrinterId = params.printerId ?? job.printer_id;
    if (effectivePrinterId && this.printers.size > 0) {
      const printer = this.printers.get(effectivePrinterId);
      if (!printer) {
        const prevStatus = job.status;
        job.status = 'requires_review';
        job.updated_at = new Date().toISOString();

        this.recordAuditEvent({
          jobId: job.id,
          actorType: 'agent',
          actorId: params.agentDeviceId,
          fromStatus: prevStatus,
          toStatus: 'requires_review',
          eventName: 'PRINTER_NOT_FOUND_HALT',
          metadata: { printerId: effectivePrinterId }
        });

        return {
          success: false,
          jobStatus: 'requires_review',
          error: `PRINTER_NOT_FOUND: Printer ID '${effectivePrinterId}' is not registered in shop catalog.`
        };
      }

      // 2. Hardware Pre-Flight Capability Checks (Prevent Waste & Corrupted Prints)
      if (job.settings.color_mode === 'color' && !printer.supports_color) {
        const prevStatus = job.status;
        job.status = 'requires_review';
        job.updated_at = new Date().toISOString();

        this.recordAuditEvent({
          jobId: job.id,
          actorType: 'agent',
          actorId: params.agentDeviceId,
          fromStatus: prevStatus,
          toStatus: 'requires_review',
          eventName: 'CAPABILITY_MISMATCH_COLOR',
          metadata: { requestedColor: true, printerSupportsColor: false }
        });

        return {
          success: false,
          jobStatus: 'requires_review',
          error:
            'CAPABILITY_MISMATCH_COLOR: Job requests color printing, but assigned printer is monochrome only.'
        };
      }

      if (job.settings.sides === 'double' && !printer.supports_duplex) {
        const prevStatus = job.status;
        job.status = 'requires_review';
        job.updated_at = new Date().toISOString();

        this.recordAuditEvent({
          jobId: job.id,
          actorType: 'agent',
          actorId: params.agentDeviceId,
          fromStatus: prevStatus,
          toStatus: 'requires_review',
          eventName: 'CAPABILITY_MISMATCH_DUPLEX',
          metadata: { requestedDuplex: true, printerSupportsDuplex: false }
        });

        return {
          success: false,
          jobStatus: 'requires_review',
          error:
            'CAPABILITY_MISMATCH_DUPLEX: Job requests double-sided printing, but printer does not support duplex.'
        };
      }
    }

    // 3. Submit to Win32 Spooler
    const spoolerResult = this.spooler.submitJob({
      printerName: params.printerName,
      documentTitle: job.document_name,
      leaseToken: params.leaseToken,
      idempotencyKey: params.idempotencyKey,
      pages: job.settings.copies * 10
    });

    if (!spoolerResult.success) {
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

    // Spooler returned SUBMITTED or UNKNOWN
    const spoolerRecord = this.spooler.getJob(spoolerResult.spoolerJobId!);
    if (spoolerRecord?.status === 'UNKNOWN') {
      const previousStatus = job.status;
      job.status = 'requires_review';
      job.updated_at = new Date().toISOString();

      this.recordAuditEvent({
        jobId: job.id,
        actorType: 'agent',
        actorId: params.agentDeviceId,
        fromStatus: previousStatus,
        toStatus: 'requires_review',
        eventName: 'UNKNOWN_SPOOLER_OUTCOME_NO_AUTOREPRINT',
        metadata: { spoolerJobId: spoolerResult.spoolerJobId }
      });

      return {
        success: false,
        spoolerJobId: spoolerResult.spoolerJobId,
        jobStatus: 'requires_review',
        error:
          'UNKNOWN_SPOOLER_STATUS: Win32 spooler outcome could not be verified; auto-reprint forbidden.'
      };
    }

    const previousStatus = job.status;
    job.status = 'printing';
    job.updated_at = new Date().toISOString();

    this.recordAuditEvent({
      jobId: job.id,
      actorType: 'agent',
      actorId: params.agentDeviceId,
      fromStatus: previousStatus,
      toStatus: 'printing',
      eventName: 'SUBMITTED_TO_WIN32_SPOOLER',
      metadata: { spoolerJobId: spoolerResult.spoolerJobId }
    });

    return {
      success: true,
      spoolerJobId: spoolerResult.spoolerJobId,
      jobStatus: 'printing'
    };
  }

  /**
   * Section 7: Crash Recovery & Operator Manual Intervention (Strictly No Auto-Reprint)
   */
  operatorResolveRequiresReview(params: {
    jobId: string;
    ownerUserId: string;
    resolution: 'confirm_printed' | 'retry_job';
  }): { success: boolean; jobStatus: string; error?: string | undefined } {
    const job = this.jobs.get(params.jobId);
    if (!job) {
      return { success: false, jobStatus: 'unknown', error: 'JOB_NOT_FOUND' };
    }

    if (job.status !== 'requires_review') {
      return {
        success: false,
        jobStatus: job.status,
        error: 'INVALID_STATE: Job is not in requires_review state.'
      };
    }

    const prevStatus = job.status;

    if (params.resolution === 'confirm_printed') {
      job.status = 'completed';
      job.completed_at = new Date().toISOString();
      job.updated_at = new Date().toISOString();
      this.activeLeases.delete(params.jobId);

      // Trigger privacy deletion
      this.deletedDocumentsLog.push({
        jobId: job.id,
        storageKey: job.document_storage_key,
        reason: 'operator_confirmed_printed',
        deletedAt: new Date().toISOString()
      });

      this.recordAuditEvent({
        jobId: job.id,
        actorType: 'owner',
        actorId: params.ownerUserId,
        fromStatus: prevStatus,
        toStatus: 'completed',
        eventName: 'OPERATOR_MANUALLY_CONFIRMED_PRINTED'
      });

      return { success: true, jobStatus: 'completed' };
    } else {
      // Operator selected manual retry after verifying empty output tray
      job.status = 'approved';
      job.updated_at = new Date().toISOString();
      this.activeLeases.delete(params.jobId);

      this.recordAuditEvent({
        jobId: job.id,
        actorType: 'owner',
        actorId: params.ownerUserId,
        fromStatus: prevStatus,
        toStatus: 'approved',
        eventName: 'OPERATOR_MANUAL_REPRINT_AUTHORIZED'
      });

      return { success: true, jobStatus: 'approved' };
    }
  }

  /**
   * Section 8: Hardware Completion Telemetry & Immediate Privacy File Purge
   */
  agentCompletePrint(params: {
    jobId: string;
    agentDeviceId: string;
    spoolerJobId: number;
    localTempPath?: string | undefined;
  }): {
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
        error: 'PHYSICAL_COMPLETION_UNVERIFIED: Hardware did not finish print or was in fault state'
      };
    }

    const previousStatus = job.status;
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();

    // Release lease
    this.activeLeases.delete(params.jobId);

    // 1. Cloud storage privacy deletion
    this.deletedDocumentsLog.push({
      jobId: job.id,
      storageKey: job.document_storage_key,
      reason: 'print_completed',
      deletedAt: new Date().toISOString()
    });

    // 2. Local desktop agent spool purge
    if (params.localTempPath) {
      this.localSpoolPurges.push({
        jobId: job.id,
        agentDeviceId: params.agentDeviceId,
        localTempPath: params.localTempPath,
        purgedAt: new Date().toISOString()
      });
    }

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

  /**
   * Section 9: Security Review: Zero Secret Leakage Invariant
   */
  verifyZeroSecretLeakage(): { clean: boolean; violations: string[] } {
    const violations: string[] = [];
    const sensitiveTokens = [
      'SUPABASE_SERVICE_ROLE_KEY',
      'service_role',
      'whsec_caps_test_secret_key_mock_001',
      'RAZORPAY_KEY_SECRET'
    ];

    for (const event of this.auditEvents) {
      const serialized = JSON.stringify(event);
      for (const token of sensitiveTokens) {
        if (serialized.includes(token)) {
          violations.push(`Security Leak in event ${event.id}: contains '${token}'`);
        }
      }
    }

    for (const job of this.jobs.values()) {
      const serialized = JSON.stringify(job);
      for (const token of sensitiveTokens) {
        if (serialized.includes(token)) {
          violations.push(`Security Leak in job ${job.id}: contains '${token}'`);
        }
      }
    }

    return {
      clean: violations.length === 0,
      violations
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
