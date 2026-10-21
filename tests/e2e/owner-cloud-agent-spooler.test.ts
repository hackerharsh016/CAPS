/**
 * End-to-End Vertical Slice Integration Test Suite:
 * Owner → Cloud → Agent → Spooler Integration Gate (P05-M05-F02).
 *
 * Verifies:
 * 1. Happy Path: Paid urgent job approved by owner, claimed exclusively by agent, submitted to Win32 spooler, physically completed.
 * 2. Pay-at-Counter Path: Cash receipt confirmed by owner, transitioning counter-pending job to approved and completed.
 * 3. Cross-Tenant Rejection: Foreign shop owners and foreign desktop agents cannot approve or claim out-of-scope jobs.
 * 4. Zero Duplicates & Concurrency: Multi-agent claim race condition resolution & idempotent replayed submissions.
 * 5. Status Honesty & Hardware Fault Handling: Paper jam / empty paper tray marks job as requires_review without auto-reprinting.
 * 6. Privacy & Document Retention: Immediate document purge logged upon physical completion.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SHOP_ALPHA_ID,
  SHOP_BETA_ID,
  OWNER_ALPHA_USER_ID,
  OWNER_BETA_USER_ID,
  AGENT_ALPHA_DEVICE_ID,
  AGENT_BETA_DEVICE_ID,
  PRINTER_CANON_BW_ID,
  createE2EFixtures
} from './fixtures/integration-fixtures';
import { IntegrationOrchestrator } from './support/integration-orchestrator';

describe('P05-M05-F02: Owner→Cloud→Agent→Spooler Vertical Slice Integration Gate', () => {
  let orchestrator: IntegrationOrchestrator;
  let fixtures: ReturnType<typeof createE2EFixtures>;

  beforeEach(() => {
    orchestrator = new IntegrationOrchestrator();
    fixtures = createE2EFixtures();
    orchestrator.seedJobs([
      fixtures.urgentPaidJob,
      fixtures.flexiblePayAtCounterJob,
      fixtures.unpaidJob,
      fixtures.crossShopJob
    ]);
  });

  describe('1. Full End-to-End Happy Path (Paid Urgent Print)', () => {
    it('executes full vertical slice: queued -> owner approved -> agent claimed -> spooler printing -> completed', () => {
      const jobId = fixtures.urgentPaidJob.id;

      // Initial state verification
      const initialJob = orchestrator.getJob(jobId);
      expect(initialJob).not.toBeNull();
      expect(initialJob?.status).toBe('queued');
      expect(initialJob?.payment_status).toBe('paid');

      // Step 1: Owner confirms job on dashboard
      const approval = orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });
      expect(approval.success).toBe(true);
      expect(approval.status).toBe('approved');

      // Verify job is now approved
      const approvedJob = orchestrator.getJob(jobId);
      expect(approvedJob?.status).toBe('approved');
      expect(approvedJob?.approved_at).toBeDefined();

      // Step 2: Agent claims next approved job via atomic lease
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'idem-claim-001'
      });
      expect(claim.claimed).toBe(true);
      expect(claim.job?.id).toBe(jobId);
      expect(claim.leaseToken).toBeDefined();

      // Verify job is claimed and lease is active
      const claimedJob = orchestrator.getJob(jobId);
      expect(claimedJob?.status).toBe('claimed');

      // Step 3: Agent submits to Windows print spooler
      const submission = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerName: 'Canon imageRUNNER 2625 (Tray 1)',
        idempotencyKey: 'idem-spool-001'
      });
      expect(submission.success).toBe(true);
      expect(submission.spoolerJobId).toBeGreaterThan(1000);
      expect(submission.jobStatus).toBe('printing');

      // Status Honesty check: Job is 'printing', NOT 'completed' yet!
      const printingJob = orchestrator.getJob(jobId);
      expect(printingJob?.status).toBe('printing');

      // Step 4: Spooler finishes physical output -> Agent marks completed
      const completion = orchestrator.agentCompletePrint({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        spoolerJobId: submission.spoolerJobId!
      });
      expect(completion.success).toBe(true);
      expect(completion.jobStatus).toBe('completed');

      // Step 5: Final state & privacy retention purge validation
      const finalJob = orchestrator.getJob(jobId);
      expect(finalJob?.status).toBe('completed');
      expect(finalJob?.completed_at).toBeDefined();

      // Verify privacy deletion log recorded
      const deletionLogs = orchestrator.getDeletedDocumentsLog();
      expect(deletionLogs.some(log => log.jobId === jobId)).toBe(true);

      // Verify immutable audit trail contains all lifecycle milestones
      const auditTrail = orchestrator.getAuditEvents(jobId);
      const eventNames = auditTrail.map(e => e.eventName);
      expect(eventNames).toContain('OWNER_CONFIRMED');
      expect(eventNames).toContain('AGENT_CLAIMED_EXCLUSIVE');
      expect(eventNames).toContain('SUBMITTED_TO_WIN32_SPOOLER');
      expect(eventNames).toContain('PHYSICAL_PRINT_COMPLETED_AND_PURGED');
    });
  });

  describe('2. Pay-at-Counter Authorization Path', () => {
    it('allows owner to confirm cash receipt at counter and release job to agent spooler', () => {
      const jobId = fixtures.flexiblePayAtCounterJob.id;

      // Cannot claim pay-at-counter job before owner approval
      const prematureClaim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'premature-claim-1'
      });
      expect(prematureClaim.claimed).toBe(false);

      // Owner confirms payment at counter
      const approval = orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID,
        confirmAtCounter: true
      });
      expect(approval.success).toBe(true);

      const approvedJob = orchestrator.getJob(jobId);
      expect(approvedJob?.status).toBe('approved');
      expect(approvedJob?.payment_status).toBe('paid');

      // Now agent successfully claims and prints
      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'counter-claim-1'
      });
      expect(claim.claimed).toBe(true);
      expect(claim.job?.id).toBe(jobId);
    });
  });

  describe('3. Multi-Tenant Isolation & Access Control', () => {
    it('rejects cross-shop owner approval attempts', () => {
      const jobId = fixtures.urgentPaidJob.id; // Belongs to SHOP_ALPHA

      // Attacker owner from SHOP_BETA attempts approval
      const crossShopApproval = orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_BETA_USER_ID,
        ownerShopId: SHOP_BETA_ID
      });

      expect(crossShopApproval.success).toBe(false);
      expect(crossShopApproval.error).toMatch(/UNAUTHORIZED_CROSS_SHOP/);

      // Job remains untouched in queued status
      expect(orchestrator.getJob(jobId)?.status).toBe('queued');
    });

    it('rejects cross-shop agent claim attempts', () => {
      // Approve Shop Alpha job
      orchestrator.ownerApproveJob({
        jobId: fixtures.urgentPaidJob.id,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Agent paired with Shop Beta attempts to claim Shop Alpha job
      const foreignClaim = orchestrator.agentClaimNextJob({
        shopId: SHOP_BETA_ID,
        agentDeviceId: AGENT_BETA_DEVICE_ID,
        idempotencyKey: 'foreign-claim-1'
      });

      // Cannot claim Alpha's job
      expect(foreignClaim.claimed).toBe(false);
      expect(foreignClaim.job).toBeUndefined();
    });

    it('rejects approval on unpaid jobs without counter confirmation', () => {
      const unpaidJobId = fixtures.unpaidJob.id;

      const approval = orchestrator.ownerApproveJob({
        jobId: unpaidJobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID,
        confirmAtCounter: false
      });

      expect(approval.success).toBe(false);
      expect(approval.error).toMatch(/PAYMENT_REQUIRED/);
    });
  });

  describe('4. Concurrency & Zero Duplicate Prints', () => {
    it('guarantees that only ONE agent wins lease race when multiple agents claim simultaneously', () => {
      const jobId = fixtures.urgentPaidJob.id;

      orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      // Agent 1 claims
      const claim1 = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'race-agent-1'
      });
      expect(claim1.claimed).toBe(true);
      expect(claim1.job?.id).toBe(jobId);

      // Agent 2 immediately attempts to claim the same job
      const claim2 = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: 'agent-device-secondary',
        idempotencyKey: 'race-agent-2'
      });
      // Agent 2 is denied (no approved jobs available, already leased)
      expect(claim2.claimed).toBe(false);
      expect(claim2.error).toMatch(/NO_APPROVED_JOBS_AVAILABLE/);
    });

    it('replays identical claim idempotency key safely without creating duplicate leases', () => {
      const jobId = fixtures.urgentPaidJob.id;

      orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claimA = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'replayed-key-100'
      });

      // Exact replay of the network request
      const claimB = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'replayed-key-100'
      });

      expect(claimB.claimed).toBe(true);
      expect(claimB.leaseToken).toBe(claimA.leaseToken);
    });

    it('replays spooler submission safely and returns existing spoolerJobId without duplicate prints', () => {
      const jobId = fixtures.urgentPaidJob.id;

      orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'spool-test-key'
      });

      const sub1 = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerName: 'Canon imageRUNNER 2625 (Tray 1)',
        idempotencyKey: 'spooler-sub-idem-1'
      });

      // Network retry of spooler submission
      const sub2 = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerName: 'Canon imageRUNNER 2625 (Tray 1)',
        idempotencyKey: 'spooler-sub-idem-1'
      });

      expect(sub1.spoolerJobId).toBe(sub2.spoolerJobId);
    });
  });

  describe('5. Hardware Faults & Status Honesty (No Auto-Reprint)', () => {
    it('halts and marks job as requires_review on paper jam without auto-reprinting', () => {
      const jobId = fixtures.urgentPaidJob.id;
      const printerName = 'Faulty Jammed Canon 2625';

      // Inject paper jam hardware error into spooler
      orchestrator.spooler.simulatePaperJamPrinters.add(printerName);

      orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'jam-test-claim'
      });

      const submission = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerName,
        idempotencyKey: 'jam-test-spool'
      });

      expect(submission.success).toBe(false);
      expect(submission.jobStatus).toBe('requires_review');
      expect(submission.error).toMatch(/ERROR_PAPER_JAM/);

      // Status honesty: job is flagged for human operator review
      const job = orchestrator.getJob(jobId);
      expect(job?.status).toBe('requires_review');

      // Invariant: System does NOT auto-complete or auto-reprint
      expect(job?.status).not.toBe('completed');
      expect(job?.completed_at).toBeUndefined();
    });

    it('rejects spooler submission if printer is offline', () => {
      const jobId = fixtures.urgentPaidJob.id;
      const printerName = 'Offline Network Printer';

      orchestrator.spooler.offlinePrinters.add(printerName);

      orchestrator.ownerApproveJob({
        jobId,
        ownerUserId: OWNER_ALPHA_USER_ID,
        ownerShopId: SHOP_ALPHA_ID
      });

      const claim = orchestrator.agentClaimNextJob({
        shopId: SHOP_ALPHA_ID,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        idempotencyKey: 'offline-test-claim'
      });

      const submission = orchestrator.agentSubmitToSpooler({
        jobId,
        agentDeviceId: AGENT_ALPHA_DEVICE_ID,
        leaseToken: claim.leaseToken!,
        printerName,
        idempotencyKey: 'offline-test-spool'
      });

      expect(submission.success).toBe(false);
      expect(submission.error).toMatch(/PRINTER_OFFLINE/);
    });
  });
});
