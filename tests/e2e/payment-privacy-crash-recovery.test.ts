/**
 * End-to-End Acceptance Test Suite:
 * Payment, Privacy and Crash-Recovery E2E Gate (P07-M03-F02).
 *
 * Verifies the 7 critical system invariants from the Master Architecture Baseline:
 * 1. Online Payment Verification & Cryptographic Webhook Reconciliation
 * 2. Webhook Race Condition Resolution & Idempotent Deduplication
 * 3. Urgent Insertion & Deterministic Queue Precedence
 * 4. Agent Network Loss, Lease TTL Timeout & Crash Restart
 * 5. Pre-Flight Printer Discovery & Hardware Capability Mismatch Guards
 * 6. Unknown Spooler Status & Operator Recovery (Zero Auto-Reprint)
 * 7. Privacy Purge, Document Retention Lifecycle & Zero Secret Leakage
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  SHOP_ALPHA_ID,
  CUSTOMER_USER_ID,
  OWNER_ALPHA_USER_ID,
  AGENT_ALPHA_DEVICE_ID,
  AGENT_BETA_DEVICE_ID,
  PRINTER_CANON_BW_ID,
  PRINTER_HP_COLOR_ID,
  PRINTER_UNREGISTERED_ID,
  RAZORPAY_WEBHOOK_SECRET,
  createE2EFixtures
} from './fixtures/integration-fixtures';
import { IntegrationOrchestrator } from './support/integration-orchestrator';

describe('P07-M03-F02: Payment, Privacy, and Crash-Recovery E2E Integration Gate', () => {
  let orchestrator: IntegrationOrchestrator;
  let fixtures: ReturnType<typeof createE2EFixtures>;

  beforeEach(() => {
    orchestrator = new IntegrationOrchestrator();
    fixtures = createE2EFixtures();
    orchestrator.seedPrinters(fixtures.printers);
    orchestrator.seedJobs([
      fixtures.urgentPaidJob,
      fixtures.flexiblePayAtCounterJob,
      fixtures.unpaidJob,
      fixtures.crossShopJob,
      fixtures.flexibleOldJob,
      fixtures.urgentNewJob,
      fixtures.colorJobOnBwPrinter,
      fixtures.missingPrinterJob,
      fixtures.crashRecoveryJob
    ]);
  });

  describe('1. Online Payment Verification & Webhook Race Conditions', () => {
    it('verifies valid cryptographic HMAC-SHA256 signature and enqueues job with verified paid status', () => {
      const job = fixtures.urgentNewJob;
      const paymentId = 'pay_test_razorpay_valid_001';
      const orderId = 'order_test_caps_001';

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId,
        orderId,
        jobId: job.id,
        amountPaise: job.price_total_paise
      });

      const validSignature = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawPayload)
        .digest('hex');

      const result = orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature: validSignature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId,
          orderId,
          jobId: job.id,
          amountPaise: job.price_total_paise
        }
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('processed');
      expect(result.jobId).toBe(job.id);

      // Verify job transitioned to queued & paid
      const updatedJob = orchestrator.getJob(job.id);
      expect(updatedJob?.status).toBe('queued');
      expect(updatedJob?.payment_status).toBe('paid');
      expect(updatedJob?.enqueued_at).toBeDefined();

      // Verify audit event
      const auditEvents = orchestrator.getAuditEvents(job.id);
      const paymentEvent = auditEvents.find(e => e.eventName === 'PAYMENT_VERIFIED_ENQUEUED');
      expect(paymentEvent).toBeDefined();
      expect(paymentEvent?.actorType).toBe('gateway');
    });

    it('rejects tampered or forged webhook signatures without modifying job state', () => {
      const job = fixtures.urgentNewJob;
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId: 'pay_test_forged_999',
        orderId: 'order_test_caps_999',
        jobId: job.id,
        amountPaise: job.price_total_paise
      });

      const invalidSignature = 'invalid_forged_sha256_signature_hex_code_12345';

      const result = orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature: invalidSignature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId: 'pay_test_forged_999',
          orderId: 'order_test_caps_999',
          jobId: job.id,
          amountPaise: job.price_total_paise
        }
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('signature_invalid');
      expect(result.error).toMatch(/SIGNATURE_INVALID/);

      // Verify job remained in pending_payment state
      const unchangedJob = orchestrator.getJob(job.id);
      expect(unchangedJob?.status).toBe('pending_payment');
      expect(unchangedJob?.payment_status).toBe('initiated');
    });

    it('rejects underpayment tampering when received amount is less than expected quote price', () => {
      const job = fixtures.urgentNewJob; // Expected price: 500 paise
      const tamperedAmount = 200; // Underpayment by 300 paise

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId: 'pay_test_tampered_amount',
        orderId: 'order_test_caps_002',
        jobId: job.id,
        amountPaise: tamperedAmount
      });

      const validSignature = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawPayload)
        .digest('hex');

      const result = orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature: validSignature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId: 'pay_test_tampered_amount',
          orderId: 'order_test_caps_002',
          jobId: job.id,
          amountPaise: tamperedAmount
        }
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('amount_mismatch');
      expect(result.error).toMatch(/AMOUNT_MISMATCH/);

      // Verify job did NOT transition to queued
      const unchangedJob = orchestrator.getJob(job.id);
      expect(unchangedJob?.status).toBe('pending_payment');
    });

    it('handles concurrent duplicate webhook deliveries idempotently without double-enqueuing', () => {
      const job = fixtures.urgentNewJob;
      const paymentId = 'pay_concurrent_race_001';
      const orderId = 'order_concurrent_race_001';

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId,
        orderId,
        jobId: job.id,
        amountPaise: job.price_total_paise
      });

      const signature = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawPayload)
        .digest('hex');

      // Delivery 1 (First arrival)
      const firstResult = orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId,
          orderId,
          jobId: job.id,
          amountPaise: job.price_total_paise
        }
      });

      // Delivery 2 (Concurrent race / duplicate webhook retry from gateway)
      const secondResult = orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId,
          orderId,
          jobId: job.id,
          amountPaise: job.price_total_paise
        }
      });

      expect(firstResult.success).toBe(true);
      expect(firstResult.status).toBe('processed');

      expect(secondResult.success).toBe(true);
      expect(secondResult.status).toBe('already_processed');

      // Verify only ONE payment transition event occurred in audit log
      const auditEvents = orchestrator.getAuditEvents(job.id);
      const enqueuedEvents = auditEvents.filter(e => e.eventName === 'PAYMENT_VERIFIED_ENQUEUED');
      expect(enqueuedEvents.length).toBe(1);
    });
  });

  describe('2. Urgent Insertion & Live Queue Deterministic Priority', () => {
    it('inserts newly enqueued urgent job ahead of older flexible jobs in the live queue', () => {
      // Step 1: Query initial live queue for Shop Alpha
      const initialQueue = orchestrator.getLiveQueue(SHOP_ALPHA_ID);
      const oldFlexibleJob = initialQueue.find(j => j.id === fixtures.flexibleOldJob.id);
      expect(oldFlexibleJob).toBeDefined();

      // Step 2: Customer completes payment on an Urgent job submitted later
      const urgentJob = fixtures.urgentNewJob;
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId: 'pay_urgent_insert_001',
        orderId: 'order_urgent_insert_001',
        jobId: urgentJob.id,
        amountPaise: urgentJob.price_total_paise
      });
      const signature = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawPayload)
        .digest('hex');

      orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId: 'pay_urgent_insert_001',
          orderId: 'order_urgent_insert_001',
          jobId: urgentJob.id,
          amountPaise: urgentJob.price_total_paise
        }
      });

      // Step 3: Re-evaluate Live Queue order
      const updatedQueue = orchestrator.getLiveQueue(SHOP_ALPHA_ID);

      // Verify urgent job appears ahead of the 15-minute older flexible job
      const urgentIndex = updatedQueue.findIndex(j => j.id === urgentJob.id);
      const flexibleIndex = updatedQueue.findIndex(j => j.id === fixtures.flexibleOldJob.id);

      expect(urgentIndex).toBeGreaterThanOrEqual(0);
      expect(flexibleIndex).toBeGreaterThanOrEqual(0);
      expect(urgentIndex).toBeLessThan(flexibleIndex);
    });

    it('ensures agent exclusive claim selects urgent approved jobs before flexible approved jobs', () => {
      // Approve both the old flexible job and the urgent job
      orchestrator.ownerApproveJob({
        jobId: fixtures.flexibleOldJob.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Activate urgent job via payment
      const urgentJob = fixtures.urgentNewJob;
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId: 'pay_urgent_claim_001',
        orderId: 'order_urgent_claim_001',
        jobId: urgentJob.id,
        amountPaise: urgentJob.price_total_paise
      });
      const signature = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawPayload)
        .digest('hex');
      orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId: 'pay_urgent_claim_001',
          orderId: 'order_urgent_claim_001',
          jobId: urgentJob.id,
          amountPaise: urgentJob.price_total_paise
        }
      });

      orchestrator.ownerApproveJob({
        jobId: urgentJob.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Agent claims next eligible job
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-urgent-claim-test'
      });

      expect(claim.claimed).toBe(true);
      // The urgent job must be chosen, despite flexible job having enqueued 15 mins prior
      expect(claim.job?.id).toBe(urgentJob.id);
      expect(claim.job?.priority_tier).toBe('urgent');
    });
  });

  describe('3. Agent Network Loss, Lease Timeout & Crash Recovery', () => {
    it('recovers cleanly when agent loses network after claiming: lease expires and reconnected agent re-claims', () => {
      const jobId = fixtures.crashRecoveryJob.id;

      // Owner approves job
      orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Phase 1: Agent Alpha claims job (Attempt #1)
      const claim1 = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-claim-attempt-1'
      });

      expect(claim1.claimed).toBe(true);
      expect(claim1.job?.id).toBe(jobId);
      expect(claim1.attemptNumber).toBe(1);
      const staleLeaseToken = claim1.leaseToken!;

      // Verify second agent cannot hijack the active lease
      const competingClaim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_BETA_DEVICE_ID,
        idempotencyKey: 'idem-competing-hijack'
      });
      // No other approved jobs, competing claim receives false
      expect(competingClaim.claimed).toBe(false);

      // Phase 2: Agent network disconnects / process crashes. 5-minute lease TTL expires.
      const reaperResult = orchestrator.expireLease(jobId);
      expect(reaperResult.success).toBe(true);

      // Verify job is back in approved status for reclamation
      const recoveredJob = orchestrator.getJob(jobId);
      expect(recoveredJob?.status).toBe('approved');

      // Phase 3: Stale Agent attempts spooler submission with expired lease token -> REJECTED
      const staleSubmission = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: staleLeaseToken,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-stale-submit'
      });

      expect(staleSubmission.success).toBe(false);
      expect(staleSubmission.error).toMatch(/INVALID_OR_EXPIRED_LEASE/);

      // Phase 4: Reconnected Agent re-claims the job (Attempt #2)
      const claim2 = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-claim-attempt-2'
      });

      expect(claim2.claimed).toBe(true);
      expect(claim2.attemptNumber).toBe(2);
      expect(claim2.leaseToken).not.toBe(staleLeaseToken);

      // Verify Attempt #2 can now submit to spooler successfully
      const validSubmission = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim2.leaseToken!,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-spool-attempt-2'
      });

      expect(validSubmission.success).toBe(true);
      expect(validSubmission.jobStatus).toBe('printing');
    });
  });

  describe('4. Missing Printer & Capability Mismatch Pre-Flight Handling', () => {
    it('halts and flags requires_review when job is routed to an unregistered printer ID', () => {
      const job = fixtures.missingPrinterJob;

      // Approve job
      orchestrator.ownerApproveJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Claim job
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-missing-printer-claim'
      });
      expect(claim.claimed).toBe(true);

      // Submit with unregistered printer ID
      const submission = orchestrator.agentSubmitToSpooler({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerId: PRINTER_UNREGISTERED_ID,
        printerName: 'NonExistent_Ghost_Printer',
        idempotencyKey: 'idem-missing-submit'
      });

      expect(submission.success).toBe(false);
      expect(submission.jobStatus).toBe('requires_review');
      expect(submission.error).toMatch(/PRINTER_NOT_FOUND/);

      // Status check
      const updatedJob = orchestrator.getJob(job.id);
      expect(updatedJob?.status).toBe('requires_review');
    });

    it('rejects pre-flight when customer demands color on a monochrome-only printer', () => {
      const job = fixtures.colorJobOnBwPrinter; // Demands color, assigned to Canon BW

      // Approve job
      orchestrator.ownerApproveJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Claim job
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-color-mismatch-claim'
      });
      expect(claim.claimed).toBe(true);

      // Submit with monochrome printer
      const submission = orchestrator.agentSubmitToSpooler({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-color-mismatch-submit'
      });

      expect(submission.success).toBe(false);
      expect(submission.jobStatus).toBe('requires_review');
      expect(submission.error).toMatch(/CAPABILITY_MISMATCH_COLOR/);

      // Verify audit trail logged capability mismatch
      const auditEvents = orchestrator.getAuditEvents(job.id);
      expect(auditEvents.some(e => e.eventName === 'CAPABILITY_MISMATCH_COLOR')).toBe(true);
    });
  });

  describe('5. Unknown Spooler Status & Crash Recovery (Strictly No Auto-Reprint)', () => {
    it('halts and requires human review if Win32 spooler returns UNKNOWN outcome without auto-reprinting', () => {
      const job = fixtures.urgentPaidJob;

      // Injected fault: configure printer to return UNKNOWN spooler status
      orchestrator.spooler.simulateUnknownStatusPrinters.add('Canon imageRUNNER 2525 (B&W)');

      // Approve and Claim
      orchestrator.ownerApproveJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-unknown-spooler-claim'
      });
      expect(claim.claimed).toBe(true);

      // Submit to Spooler
      const submission = orchestrator.agentSubmitToSpooler({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-unknown-spooler-submit'
      });

      // System must halt: do NOT auto-reprint!
      expect(submission.success).toBe(false);
      expect(submission.jobStatus).toBe('requires_review');
      expect(submission.error).toMatch(/UNKNOWN_SPOOLER_STATUS/);

      const auditEvents = orchestrator.getAuditEvents(job.id);
      expect(auditEvents.some(e => e.eventName === 'UNKNOWN_SPOOLER_OUTCOME_NO_AUTOREPRINT')).toBe(
        true
      );

      // Verify Operator Manual Intervention Path A: Operator checks physical tray, confirms output printed
      const operatorConfirm = orchestrator.operatorResolveRequiresReview({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        resolution: 'confirm_printed'
      });

      expect(operatorConfirm.success).toBe(true);
      expect(operatorConfirm.jobStatus).toBe('completed');

      const finalizedJob = orchestrator.getJob(job.id);
      expect(finalizedJob?.status).toBe('completed');
    });

    it('allows operator manual reprint resolution when physical inspection confirms tray is empty', () => {
      const job = fixtures.urgentPaidJob;
      orchestrator.spooler.simulateUnknownStatusPrinters.add('Canon imageRUNNER 2525 (B&W)');

      orchestrator.ownerApproveJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-unknown-retry-claim'
      });

      orchestrator.agentSubmitToSpooler({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-unknown-retry-submit'
      });

      // Operator manual inspection confirms paper never emerged -> triggers controlled retry
      const operatorRetry = orchestrator.operatorResolveRequiresReview({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        resolution: 'retry_job'
      });

      expect(operatorRetry.success).toBe(true);
      expect(operatorRetry.jobStatus).toBe('approved');

      const reApprovedJob = orchestrator.getJob(job.id);
      expect(reApprovedJob?.status).toBe('approved');
    });
  });

  describe('6. Privacy Purge & Document Lifecycle Retention', () => {
    it('purges cloud document and local spool temp file immediately upon physical completion', () => {
      const job = fixtures.urgentPaidJob;
      const localTempPath = 'C:\\ProgramData\\CAPS\\spool\\temp_job_001.pdf';

      // Approve, claim, and submit
      orchestrator.ownerApproveJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-privacy-claim'
      });

      // Authenticated agent downloads document prior to printing
      const downloadBefore = orchestrator.downloadDocument({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!
      });
      expect(downloadBefore.success).toBe(true);
      expect(downloadBefore.data).toBeDefined();

      const submission = orchestrator.agentSubmitToSpooler({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-privacy-submit'
      });
      expect(submission.success).toBe(true);

      // Hardware finishes physical printing
      const completion = orchestrator.agentCompletePrint({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        spoolerJobId: submission.spoolerJobId!,
        localTempPath
      });
      expect(completion.success).toBe(true);
      expect(completion.jobStatus).toBe('completed');

      // 1. Verify cloud storage purge
      const deletedLogs = orchestrator.getDeletedDocumentsLog();
      const jobPurge = deletedLogs.find(d => d.jobId === job.id);
      expect(jobPurge).toBeDefined();
      expect(jobPurge?.reason).toBe('print_completed');

      // 2. Verify local spool purge
      const localPurges = orchestrator.getLocalSpoolPurges();
      const localPurge = localPurges.find(p => p.jobId === job.id);
      expect(localPurge).toBeDefined();
      expect(localPurge?.localTempPath).toBe(localTempPath);

      // 3. Verify document download is now blocked (404 / Purged)
      const downloadAfter = orchestrator.downloadDocument({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!
      });
      expect(downloadAfter.success).toBe(false);
      expect(downloadAfter.error).toMatch(/DOCUMENT_PURGED/);
    });
  });

  describe('7. Security & Zero Secret Leakage Invariant', () => {
    it('guarantees no service-role secrets or gateway webhook secrets are present in audit logs or job records', () => {
      const securityCheck = orchestrator.verifyZeroSecretLeakage();
      expect(securityCheck.clean).toBe(true);
      expect(securityCheck.violations).toEqual([]);
    });
  });
});
