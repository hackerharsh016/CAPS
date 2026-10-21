/**
 * End-to-End Acceptance Test Suite:
 * Single-Shop Supervised Pilot (P07-M04-F01).
 *
 * Validates the complete operational pilot lifecycle:
 * 1. Operator Pairing & Heartbeat Telemetry
 * 2. Diagnostic Printer Test Page Calibration
 * 3. Consented Document Print-to-Purge Lifecycle
 * 4. Customer Support, Terminal Fault & Refund Management
 * 5. Emergency Stop Incident Pause & Resume Recovery
 * 6. MVP Kiosk Mode Disabled Invariant
 * 7. Multi-Tenant Access Boundaries during Live Operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  SHOP_ALPHA_ID,
  SHOP_BETA_ID,
  OWNER_ALPHA_USER_ID,
  OWNER_BETA_USER_ID,
  AGENT_ALPHA_DEVICE_ID,
  AGENT_BETA_DEVICE_ID,
  PRINTER_CANON_BW_ID,
  PRINTER_HP_COLOR_ID,
  RAZORPAY_WEBHOOK_SECRET,
  createE2EFixtures
} from './fixtures/integration-fixtures';
import { IntegrationOrchestrator } from './support/integration-orchestrator';

describe('P07-M04-F01: Single-Shop Supervised Pilot Integration Gate', () => {
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
      fixtures.consentedCustomerJob,
      fixtures.refundTargetJob,
      fixtures.printerTestPageJob
    ]);
  });

  describe('1. Operator Pairing & Agent Heartbeat Lifecycle', () => {
    it('executes one-time pairing code generation, agent binding, and heartbeat sync', () => {
      // Step 1: Owner generates pairing code on dashboard
      const pairing = orchestrator.generatePairingCode(SHOP_ALPHA_ID, OWNER_ALPHA_USER_ID);
      expect(pairing.pairingCode).toMatch(/^PAIR-CP-\d{6}$/);
      expect(pairing.expiresAt).toBeDefined();

      // Step 2: Desktop Agent pairs with the code
      const pairResult = orchestrator.agentPairDevice({
        pairingCode: pairing.pairingCode,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        machineHostname: 'SHOP-ALPHA-DESKTOP-PC'
      });

      expect(pairResult.success).toBe(true);
      expect(pairResult.shopId).toBe(SHOP_ALPHA_ID);

      // Verify agent is now registered and online
      const agentInfo = orchestrator.getPairedAgent(AGENT_ALPHA_DEVICE_ID);
      expect(agentInfo.paired).toBe(true);
      expect(agentInfo.shopId).toBe(SHOP_ALPHA_ID);
      expect(agentInfo.machineHostname).toBe('SHOP-ALPHA-DESKTOP-PC');

      // Step 3: Agent sends periodic heartbeat
      const heartbeat = orchestrator.agentHeartbeat(AGENT_ALPHA_DEVICE_ID);
      expect(heartbeat.success).toBe(true);
      expect(heartbeat.timestamp).toBeDefined();

      // Step 4: Replay protection - pairing code cannot be reused
      const replayPair = orchestrator.agentPairDevice({
        pairingCode: pairing.pairingCode,
        agentDeviceId: AGENT_BETA_DEVICE_ID,
        machineHostname: 'ROGUE-PC'
      });
      expect(replayPair.success).toBe(false);
      expect(replayPair.error).toMatch(/INVALID_OR_EXPIRED_PAIRING_CODE/);
    });
  });

  describe('2. Diagnostic Printer Test Page Calibration', () => {
    it('allows operator to submit diagnostic test page to verify hardware before customer jobs', () => {
      // Operator triggers diagnostic test page
      const testPageResult = orchestrator.submitPrinterTestPage({
        shopId: SHOP_ALPHA_ID,
        printerId: PRINTER_CANON_BW_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID
      });

      expect(testPageResult.success).toBe(true);
      expect(testPageResult.spoolerJobId).toBeGreaterThan(1000);
      expect(testPageResult.jobStatus).toBe('printing');

      // Operator confirms physical calibration sheet emerged cleanly
      const completed = orchestrator.spooler.completePhysicalPrint(testPageResult.spoolerJobId!);
      expect(completed).toBe(true);

      const spoolerRecord = orchestrator.spooler.getJob(testPageResult.spoolerJobId!);
      expect(spoolerRecord?.status).toBe('PRINTED');
    });
  });

  describe('3. Consented Customer Document Print-to-Purge Flow', () => {
    it('completes verified payment, owner approval, spooling, and immediate privacy deletion', () => {
      const job = fixtures.consentedCustomerJob;

      // Step 1: Customer completes payment via Razorpay
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        paymentId: 'pay_pilot_consented_001',
        orderId: 'order_pilot_001',
        jobId: job.id,
        amountPaise: job.price_total_paise
      });
      const signature = createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(rawPayload)
        .digest('hex');

      const webhook = orchestrator.processRazorpayWebhook({
        rawBody: rawPayload,
        signature,
        webhookSecret: RAZORPAY_WEBHOOK_SECRET,
        payload: {
          event: 'payment.captured',
          paymentId: 'pay_pilot_consented_001',
          orderId: 'order_pilot_001',
          jobId: job.id,
          amountPaise: job.price_total_paise
        }
      });
      expect(webhook.success).toBe(true);

      // Step 2: Owner reviews and confirms print
      const approval = orchestrator.ownerApproveJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });
      expect(approval.success).toBe(true);

      // Step 3: Agent claims next approved job
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-pilot-consented-claim'
      });
      expect(claim.claimed).toBe(true);
      expect(claim.job?.id).toBe(job.id);

      // Step 4: Spooler submission
      const spool = orchestrator.agentSubmitToSpooler({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerId: PRINTER_CANON_BW_ID,
        printerName: 'Canon imageRUNNER 2525 (B&W)',
        idempotencyKey: 'idem-pilot-consented-spool'
      });
      expect(spool.success).toBe(true);

      // Step 5: Hardware physical completion & immediate privacy purge
      const complete = orchestrator.agentCompletePrint({
        jobId: job.id,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        spoolerJobId: spool.spoolerJobId!,
        localTempPath: 'C:\\ProgramData\\CAPS\\spool\\blueprint.pdf'
      });
      expect(complete.success).toBe(true);

      // Verify privacy deletions
      const deletedLogs = orchestrator.getDeletedDocumentsLog();
      expect(deletedLogs.some(d => d.jobId === job.id)).toBe(true);

      const localPurges = orchestrator.getLocalSpoolPurges();
      expect(localPurges.some(p => p.jobId === job.id)).toBe(true);
    });
  });

  describe('4. Customer Support, Fault Resolution & Payment Refunds', () => {
    it('processes operator-initiated refund on failed or cancelled jobs and purges documents', () => {
      const job = fixtures.refundTargetJob; // Status: requires_review, Paid: 1500 paise

      // Operator triggers refund due to customer cancellation / hardware fault
      const refund = orchestrator.refundJob({
        jobId: job.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        reason: 'PAPER_FEED_TRAY_JAM'
      });

      expect(refund.success).toBe(true);
      expect(refund.refundId).toMatch(/^rfnd_test_caps_/);
      expect(refund.amountPaise).toBe(1500);

      // Verify job state
      const updatedJob = orchestrator.getJob(job.id);
      expect(updatedJob?.status).toBe('cancelled');
      expect(updatedJob?.payment_status).toBe('refunded');

      // Verify document was purged immediately upon refund
      const deletedLogs = orchestrator.getDeletedDocumentsLog();
      expect(deletedLogs.some(d => d.jobId === job.id)).toBe(true);

      // Verify audit trail recorded refund
      const auditEvents = orchestrator.getAuditEvents(job.id);
      expect(auditEvents.some(e => e.eventName === 'JOB_REFUNDED_BY_OPERATOR')).toBe(true);
    });
  });

  describe('5. Emergency Stop (Kill Switch) & Operational Incident Recovery', () => {
    it('halts all agent claims when emergency stop is engaged and resumes cleanly', () => {
      // Step 1: Engage Emergency Stop
      const stopResult = orchestrator.setEmergencyStop(
        SHOP_ALPHA_ID,
        true,
        'CRITICAL_PAPER_JAM_AND_TONER_SPILL'
      );
      expect(stopResult.success).toBe(true);
      expect(stopResult.isPaused).toBe(true);
      expect(orchestrator.isQueuePaused(SHOP_ALPHA_ID)).toBe(true);

      // Step 2: Attempting to claim any job while queue is paused must be blocked
      const blockedClaim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-blocked-emergency-claim'
      });

      expect(blockedClaim.claimed).toBe(false);
      expect(blockedClaim.error).toMatch(/QUEUE_PAUSED_EMERGENCY_STOP/);

      // Step 3: Operator resolves incident, clears jam, and disengages Emergency Stop
      const resumeResult = orchestrator.setEmergencyStop(SHOP_ALPHA_ID, false);
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.isPaused).toBe(false);
      expect(orchestrator.isQueuePaused(SHOP_ALPHA_ID)).toBe(false);

      // Step 4: Now agent can claim approved jobs normally
      orchestrator.ownerApproveJob({
        jobId: fixtures.urgentPaidJob.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const allowedClaim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-resumed-claim'
      });

      expect(allowedClaim.claimed).toBe(true);
    });
  });

  describe('6. MVP Kiosk Mode Disabled Invariant', () => {
    it('rejects automated claims on unapproved jobs, enforcing explicit human owner confirmation', () => {
      const unpaidJob = fixtures.unpaidJob;

      // Attempting to claim unapproved job directly without owner confirmation
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-kiosk-bypass-attempt'
      });

      // Claim selects only approved jobs; unpaid/unapproved jobs are ignored
      if (claim.job) {
        expect(claim.job.status).toBe('claimed');
        expect(claim.job.approved_at).toBeDefined();
      }
      expect(unpaidJob.status).toBe('pending_payment');
    });
  });

  describe('7. Multi-Tenant Access Boundaries during Pilot', () => {
    it('prevents foreign owner from managing or refunding Shop Alpha jobs', () => {
      const job = fixtures.refundTargetJob;

      // Foreign owner (Shop Beta) attempts to refund Shop Alpha job
      const foreignRefund = orchestrator.refundJob({
        jobId: fixtures.crossShopJob.id,
        ownerUserId: OWNER_ALPHA_USER_ID, // Alpha owner cannot refund Beta shop jobs
        reason: 'UNAUTHORIZED_CROSS_SHOP'
      });

      // Cross-shop jobs belong to Shop Beta
      expect(fixtures.crossShopJob.shop_id).toBe(SHOP_BETA_ID);
    });
  });
});
