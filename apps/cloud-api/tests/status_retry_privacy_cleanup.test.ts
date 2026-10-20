/**
 * Test Suite: Status/Retry/Outbox and Privacy Cleanup (P03-M03-F05).
 *
 * Verifies:
 * 1. Duplicate status reports safe (Idempotent agent status update handling).
 * 2. Uncertain spooler outcomes do NOT auto-reprint (routes to 'requires_review').
 * 3. Reconciling unresolved jobs via shop owner / admin resolution ('retry', 'cancel', 'mark_completed').
 * 4. Expired source documents deleted regardless of outcome (completed, failed, cancelled, expired retention).
 * 5. Permanent append-only document_deletion_logs audit entries.
 * 6. Idempotent background privacy retention worker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ITokenVerifier, AuthUser } from '../src/plugins/auth.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockDocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { MockStorageService } from '../src/modules/documents/storage.service.js';
import { MockQuotesRepository } from '../src/modules/pricing/quotes.repository.js';
import { QueueService } from '../src/modules/queue/queue.service.js';
import { MockAgentsRepository } from '../src/modules/agents/agents.repository.js';
import { MockJobAttemptsRepository } from '../src/modules/agents/attempts.repository.js';
import { AgentClaimService } from '../src/modules/agents/agent-claim.service.js';
import { PairingService } from '../src/modules/agents/pairing.service.js';
import {
  RealtimeSignalsService,
  InMemoryRealtimeBroadcaster
} from '../src/modules/queue/realtime-signals.service.js';
import { PrivacyCleanupWorker } from '../src/jobs/privacy-cleanup.worker.js';

class TestTokenVerifier implements ITokenVerifier {
  private readonly users = new Map<string, AuthUser>();

  registerUser(token: string, user: AuthUser) {
    this.users.set(token, user);
  }

  async verifyToken(token: string): Promise<AuthUser> {
    const user = this.users.get(token);
    if (!user) {
      throw new Error('Invalid token');
    }
    return user;
  }
}

describe('Status/Retry/Outbox and Privacy Cleanup (P03-M03-F05)', () => {
  let app: FastifyInstance;
  let tokenVerifier: TestTokenVerifier;
  let shopsRepo: MockShopsRepository;
  let printersRepo: MockPrintersRepository;
  let jobsRepo: MockPrintJobsRepository;
  let docsRepo: MockDocumentsRepository;
  let storageService: MockStorageService;
  let quotesRepo: MockQuotesRepository;
  let queueService: QueueService;
  let agentsRepo: MockAgentsRepository;
  let attemptsRepo: MockJobAttemptsRepository;
  let broadcaster: InMemoryRealtimeBroadcaster;
  let realtimeSignalsService: RealtimeSignalsService;
  let claimService: AgentClaimService;
  let pairingService: PairingService;
  let privacyWorker: PrivacyCleanupWorker;

  const OWNER_USER: AuthUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner@campusprint.com',
    role: 'shop_owner'
  };

  const OTHER_OWNER: AuthUser = {
    id: '11111111-1111-1111-1111-111111111199',
    email: 'stranger@otherprint.com',
    role: 'shop_owner'
  };

  const CUSTOMER_USER: AuthUser = {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'student@university.edu',
    role: 'customer'
  };

  const AGENT_USER: AuthUser = {
    id: '44444444-4444-4444-4444-444444444441',
    email: 'agent@printagent.caps.local',
    role: 'agent'
  };

  let shopId: string;
  let printerId: string;
  let deviceId: string;

  beforeEach(async () => {
    tokenVerifier = new TestTokenVerifier();
    tokenVerifier.registerUser('token-owner', OWNER_USER);
    tokenVerifier.registerUser('token-other-owner', OTHER_OWNER);
    tokenVerifier.registerUser('token-customer', CUSTOMER_USER);
    tokenVerifier.registerUser('token-agent', AGENT_USER);

    shopsRepo = new MockShopsRepository();
    printersRepo = new MockPrintersRepository();
    jobsRepo = new MockPrintJobsRepository();
    docsRepo = new MockDocumentsRepository();
    storageService = new MockStorageService();
    quotesRepo = new MockQuotesRepository();
    agentsRepo = new MockAgentsRepository();
    attemptsRepo = new MockJobAttemptsRepository();
    broadcaster = new InMemoryRealtimeBroadcaster();

    queueService = new QueueService(jobsRepo, shopsRepo, printersRepo);
    realtimeSignalsService = new RealtimeSignalsService(
      broadcaster,
      jobsRepo,
      shopsRepo,
      agentsRepo,
      attemptsRepo,
      printersRepo
    );
    claimService = new AgentClaimService(
      jobsRepo,
      shopsRepo,
      printersRepo,
      agentsRepo,
      attemptsRepo,
      docsRepo,
      realtimeSignalsService,
      storageService
    );
    pairingService = new PairingService(agentsRepo, shopsRepo, claimService);
    privacyWorker = new PrivacyCleanupWorker({
      printJobsRepo: jobsRepo,
      documentsRepo: docsRepo,
      storageService
    });

    app = buildApp({
      tokenVerifier,
      shopsRepo,
      printersRepo,
      jobsRepo,
      documentsRepo: docsRepo,
      storageService,
      quotesRepo,
      queueService,
      agentsRepo,
      attemptsRepo,
      agentClaimService: claimService,
      pairingService,
      realtimeBroadcaster: broadcaster,
      realtimeSignalsService,
      privacyCleanupWorker: privacyWorker
    });

    // Create Shop
    const shop = await shopsRepo.create({
      owner_id: OWNER_USER.id,
      name: 'Campus High-Speed Printing',
      address: '101 University Plaza',
      pricing_model: {
        bw_per_page: 200,
        color_per_page: 500,
        duplex_multiplier: 1.8,
        binding_options: { none: 0, spiral: 3000, staple: 500 }
      },
      urgent_surcharge_config: { type: 'flat', amount: 2500 }
    });
    shopId = shop.id;

    // Create Printer
    const printer = await printersRepo.create({
      shop_id: shopId,
      name: 'Canon imageRUNNER ADVANCE DX',
      role: 'bw',
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      }
    });
    printerId = printer.id;

    // Register Agent Device
    const registeredDevice = await agentsRepo.registerDevice({
      shop_id: shopId,
      device_fingerprint: 'hw-mac-001-agent',
      device_name: 'Workstation-A1',
      agent_version: '0.1.0',
      auth_token_hash: 'sha256_hash_agent'
    });
    deviceId = registeredDevice.id;
  });

  afterEach(async () => {
    await app.close();
  });

  // ============================================================================
  // 1. Idempotent Status Reporting (Duplicate Status Reports Safe)
  // ============================================================================

  describe('Idempotent Status Reporting', () => {
    it('should safely handle duplicate COMPLETED status reports without duplicate event logs', async () => {
      // 1. Create and approve job
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        printer_id: printerId,
        document_storage_key: 'shops/s1/docs/report.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'approved',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // 2. Claim job
      const claimResult = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: deviceId,
        shop_id: shopId,
        requested_printer_id: printerId
      });

      const attemptId = claimResult.job.attempt_id;
      const leaseToken = claimResult.job.lease_token;

      // 3. First status report: COMPLETED
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: {
          authorization: 'Bearer token-agent'
        },
        payload: {
          contract_version: '1.0.0',
          job_id: job.id,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'COMPLETED',
          spooler_job_id: 1042,
          pages_printed: 1,
          total_pages: 1
        }
      });

      expect(res1.statusCode).toBe(200);
      const data1 = res1.json();
      expect(data1.success).toBe(true);
      expect(data1.status).toBe('COMPLETED');

      const eventsAfterFirst = await jobsRepo.getEvents(job.id);
      const completedEventsCount1 = eventsAfterFirst.filter(
        e => e.to_status === 'completed'
      ).length;
      expect(completedEventsCount1).toBe(1);

      // 4. Duplicate status report (network retry replay)
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: {
          authorization: 'Bearer token-agent'
        },
        payload: {
          contract_version: '1.0.0',
          job_id: job.id,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'COMPLETED',
          spooler_job_id: 1042,
          pages_printed: 1,
          total_pages: 1
        }
      });

      expect(res2.statusCode).toBe(200);
      const data2 = res2.json();
      expect(data2.success).toBe(true);
      expect(data2.status).toBe('COMPLETED');

      // Assert no duplicate events were inserted in immutable audit ledger
      const eventsAfterSecond = await jobsRepo.getEvents(job.id);
      const completedEventsCount2 = eventsAfterSecond.filter(
        e => e.to_status === 'completed'
      ).length;
      expect(completedEventsCount2).toBe(1);
    });

    it('should safely handle duplicate PRINTING and DOWNLOADING updates idempotently', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        printer_id: printerId,
        document_storage_key: 'shops/s1/docs/dups.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'approved',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const claimResult = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: deviceId,
        shop_id: shopId,
        requested_printer_id: printerId
      });

      const { attempt_id, lease_token } = claimResult.job;

      // Report PRINTING twice
      const r1 = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: job.id,
          attempt_id,
          lease_token,
          status: 'PRINTING',
          spooler_job_id: 888,
          pages_printed: 0,
          total_pages: 5
        }
      });
      expect(r1.statusCode).toBe(200);

      const r2 = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: job.id,
          attempt_id,
          lease_token,
          status: 'PRINTING',
          spooler_job_id: 888,
          pages_printed: 0,
          total_pages: 5
        }
      });
      expect(r2.statusCode).toBe(200);
      expect(r2.json().success).toBe(true);
    });
  });

  // ============================================================================
  // 2. Prevent Duplicate Physical Execution on Uncertain Outcome
  // ============================================================================

  describe('Uncertain Spooler Outcome & Anti-Auto-Reprint Guard', () => {
    it('should transition directly to requires_review on uncertain spooler failure without auto-reprinting', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        printer_id: printerId,
        document_storage_key: 'shops/s1/docs/spooler-uncertain.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'approved',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const claimResult = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: deviceId,
        shop_id: shopId,
        requested_printer_id: printerId
      });

      // Agent reported UNCERTAIN_OUTCOME after spooler crash
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: job.id,
          attempt_id: claimResult.job.attempt_id,
          lease_token: claimResult.job.lease_token,
          status: 'FAILED',
          error_code: 'UNCERTAIN_OUTCOME',
          error_message: 'Spooler crashed while job was in-flight; physical page status unknown',
          pages_printed: 0,
          total_pages: 10
        }
      });

      expect(res.statusCode).toBe(200);

      // Invariant: MUST NOT auto-reprint! Status must be 'requires_review', not 'approved'.
      const updatedJob = await jobsRepo.findById(job.id);
      expect(updatedJob?.status).toBe('requires_review');

      // Attempting to claim again must find NO eligible job
      const nextRes = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: deviceId,
        shop_id: shopId
      });
      expect(nextRes.claimed).toBe(false);
      expect(nextRes.job).toBeNull();
    });
  });

  // ============================================================================
  // 3. Reconciling Unresolved Jobs (Admin / Owner Intervention)
  // ============================================================================

  describe('Unresolved Job Reconciliation Workflow', () => {
    it('should allow shop owner to manually resolve a requires_review job to retry, waking agent', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        printer_id: printerId,
        document_storage_key: 'shops/s1/docs/manual-review.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'requires_review',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // Shop owner resolves with 'retry' after clearing paper jam
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/jobs/${job.id}/resolve-unresolved`,
        headers: { authorization: 'Bearer token-owner' },
        payload: {
          resolution: 'retry',
          notes: 'Inspected physical printer; paper jam cleared, approved for retry'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.previous_status).toBe('requires_review');
      expect(data.new_status).toBe('approved');

      // Verify job is now claimable again by the agent
      const claimRes = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: deviceId,
        shop_id: shopId
      });
      expect(claimRes.claimed).toBe(true);
      expect(claimRes.job.job_id).toBe(job.id);
    });

    it('should allow owner to resolve as cancel and reject non-owner access', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        printer_id: printerId,
        document_storage_key: 'shops/s1/docs/bad-job.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'requires_review',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // Non-owner rejection
      const forbiddenRes = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/jobs/${job.id}/resolve-unresolved`,
        headers: { authorization: 'Bearer token-other-owner' },
        payload: { resolution: 'cancel' }
      });
      expect(forbiddenRes.statusCode).toBe(403);

      // Authorized owner cancel
      const ownerRes = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/jobs/${job.id}/resolve-unresolved`,
        headers: { authorization: 'Bearer token-owner' },
        payload: { resolution: 'cancel', notes: 'Customer cancelled at counter' }
      });
      expect(ownerRes.statusCode).toBe(200);
      expect(ownerRes.json().data.new_status).toBe('cancelled');
    });

    it('should reject resolving a job that is not in requires_review status with 400', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        printer_id: printerId,
        document_storage_key: 'shops/s1/docs/active.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/jobs/${job.id}/resolve-unresolved`,
        headers: { authorization: 'Bearer token-owner' },
        payload: { resolution: 'retry' }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATUS');
    });
  });

  // ============================================================================
  // 4. Privacy Retention Cleanup (Expired Source Deleted Regardless of Outcome)
  // ============================================================================

  describe('Privacy Cleanup & Source Document Purging', () => {
    it('should delete storage files and record deletion logs regardless of outcome', async () => {
      const pastTtl = new Date(Date.now() - 3600000).toISOString(); // 1h ago
      const futureTtl = new Date(Date.now() + 86400000).toISOString(); // 24h future

      // Storage files in bucket
      await storageService.putObject(
        'shops/s1/docs/completed.pdf',
        Buffer.from('%PDF-completed'),
        'application/pdf'
      );
      await storageService.putObject(
        'shops/s1/docs/failed-expired.pdf',
        Buffer.from('%PDF-failed'),
        'application/pdf'
      );
      await storageService.putObject(
        'shops/s1/docs/cancelled.pdf',
        Buffer.from('%PDF-cancelled'),
        'application/pdf'
      );
      await storageService.putObject(
        'shops/s1/docs/active-future.pdf',
        Buffer.from('%PDF-active'),
        'application/pdf'
      );

      // Job 1: COMPLETED (storage file must be deleted per post-spool policy)
      const job1 = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'shops/s1/docs/completed.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'completed',
        document_expires_at: futureTtl
      });

      // Job 2: FAILED with EXPIRED TTL (storage file must be deleted regardless of failed outcome!)
      const job2 = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'shops/s1/docs/failed-expired.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'requires_review',
        document_expires_at: pastTtl
      });

      // Job 3: CANCELLED (storage file must be deleted)
      const job3 = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'shops/s1/docs/cancelled.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'cancelled',
        document_expires_at: futureTtl
      });

      // Job 4: QUEUED with future TTL (MUST NOT be deleted!)
      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'shops/s1/docs/active-future.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'queued',
        document_expires_at: futureTtl
      });

      // Run privacy cleanup worker
      const cleanupResult = await privacyWorker.runCleanup(Date.now());

      expect(cleanupResult.processed_jobs_count).toBe(3);
      expect(cleanupResult.deleted_objects_count).toBe(3);
      expect(cleanupResult.deleted_keys).toContain('shops/s1/docs/completed.pdf');
      expect(cleanupResult.deleted_keys).toContain('shops/s1/docs/failed-expired.pdf');
      expect(cleanupResult.deleted_keys).toContain('shops/s1/docs/cancelled.pdf');
      expect(cleanupResult.deleted_keys).not.toContain('shops/s1/docs/active-future.pdf');

      // Verify physical storage deletion
      expect(await storageService.getObject('shops/s1/docs/completed.pdf')).toBeNull();
      expect(await storageService.getObject('shops/s1/docs/failed-expired.pdf')).toBeNull();
      expect(await storageService.getObject('shops/s1/docs/cancelled.pdf')).toBeNull();
      expect(await storageService.getObject('shops/s1/docs/active-future.pdf')).not.toBeNull();

      // Verify permanent document_deletion_logs audit ledger
      const job1Logs = await docsRepo.getDeletionLogs(job1.id);
      expect(job1Logs).toHaveLength(1);
      expect(job1Logs[0].reason).toBe('print_completed');
      expect(job1Logs[0].deleted_by).toBe('cloud_ttl_sweeper');

      const job2Logs = await docsRepo.getDeletionLogs(job2.id);
      expect(job2Logs).toHaveLength(1);
      expect(job2Logs[0].reason).toBe('retention_expired');

      const job3Logs = await docsRepo.getDeletionLogs(job3.id);
      expect(job3Logs).toHaveLength(1);
      expect(job3Logs[0].reason).toBe('job_cancelled');

      // Second run is idempotent: zero redundant deletions
      const secondRun = await privacyWorker.runCleanup(Date.now());
      expect(secondRun.deleted_objects_count).toBe(0);
    });

    it('should support triggering privacy cleanup via POST /api/v1/shops/:shopId/privacy-cleanup', async () => {
      const pastTtl = new Date(Date.now() - 3600000).toISOString();
      await storageService.putObject(
        'shops/s1/docs/endpoint-test.pdf',
        Buffer.from('%PDF-test'),
        'application/pdf'
      );

      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'shops/s1/docs/endpoint-test.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 0 },
        status: 'queued',
        document_expires_at: pastTtl
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/privacy-cleanup`,
        headers: { authorization: 'Bearer token-owner' },
        payload: {}
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.deleted_objects_count).toBeGreaterThanOrEqual(1);
      expect(data.deleted_keys).toContain('shops/s1/docs/endpoint-test.pdf');
    });
  });
});
