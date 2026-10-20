/**
 * Test Suite: Realtime Signals and Missed-Event Reconciliation (P03-M03-F04).
 *
 * Verifies:
 * 1. Scoped notifications & tenant isolation (Shop A events never leak to Shop B).
 * 2. Realtime messages are wake-up signals only, NOT ownership claims.
 * 3. Disconnect / reconnect & missed event reconciliation (no lost job despite missed signal).
 * 4. Active in-flight lease recovery to prevent duplicate attempts or dropped work.
 * 5. Expired in-flight lease detection and reclamation.
 * 6. Revoked / wrong-shop device rejection (403 REVOKED_DEVICE / FORBIDDEN).
 * 7. Live queue positions, live ETA refresh, and customer privacy redaction.
 * 8. Cursor-based delta synchronization over /queue/events.
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
import type { QueueSignal } from '../src/modules/queue/realtime-signals.types.js';

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

describe('Realtime Signals & Missed-Event Reconciliation (P03-M03-F04)', () => {
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

  const OWNER_USER_A: AuthUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner-a@fastprint.com',
    role: 'shop_owner'
  };

  const OWNER_USER_B: AuthUser = {
    id: '11111111-1111-1111-1111-111111111112',
    email: 'owner-b@quickprint.com',
    role: 'shop_owner'
  };

  const CUSTOMER_USER_1: AuthUser = {
    id: '22222222-2222-2222-2222-222222222221',
    email: 'student1@university.edu',
    role: 'customer'
  };

  const CUSTOMER_USER_2: AuthUser = {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'student2@university.edu',
    role: 'customer'
  };

  const AGENT_USER_A: AuthUser = {
    id: '44444444-4444-4444-4444-444444444441',
    email: 'agent-a@printagent.caps.local',
    role: 'agent'
  };

  let shopIdA: string;
  let shopIdB: string;
  let printerIdA: string;
  let deviceIdA: string;

  beforeEach(async () => {
    tokenVerifier = new TestTokenVerifier();
    tokenVerifier.registerUser('token-owner-a', OWNER_USER_A);
    tokenVerifier.registerUser('token-owner-b', OWNER_USER_B);
    tokenVerifier.registerUser('token-customer-1', CUSTOMER_USER_1);
    tokenVerifier.registerUser('token-customer-2', CUSTOMER_USER_2);
    tokenVerifier.registerUser('token-agent-a', AGENT_USER_A);

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
      realtimeSignalsService
    );
    pairingService = new PairingService(agentsRepo, shopsRepo, claimService);

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
      realtimeSignalsService
    });

    // Create Shop A
    const shopA = await shopsRepo.create({
      owner_id: OWNER_USER_A.id,
      name: 'Campus FastPrint A',
      address: '100 University Ave',
      pricing_model: {
        bw_per_page: 200,
        color_per_page: 500,
        duplex_multiplier: 1.8,
        binding_options: { none: 0, spiral: 3000, staple: 500 }
      },
      urgent_surcharge_config: { type: 'flat', amount: 2500 }
    });
    shopIdA = shopA.id;

    // Create Shop B
    const shopB = await shopsRepo.create({
      owner_id: OWNER_USER_B.id,
      name: 'Downtown QuickPrint B',
      address: '200 Main Street',
      pricing_model: {
        bw_per_page: 250,
        color_per_page: 600,
        duplex_multiplier: 1.8,
        binding_options: { none: 0, spiral: 3500, staple: 500 }
      },
      urgent_surcharge_config: { type: 'flat', amount: 3000 }
    });
    shopIdB = shopB.id;

    // Create Printer for Shop A
    const printerA = await printersRepo.create({
      shop_id: shopIdA,
      name: 'HP LaserJet Enterprise',
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
    printerIdA = printerA.id;

    // Register Agent Device for Shop A
    const registeredDevice = await agentsRepo.registerDevice({
      shop_id: shopIdA,
      device_fingerprint: 'fp-hw-hash-shop-a-01',
      device_name: 'ShopA-PC-Agent',
      agent_version: '0.1.0',
      auth_token_hash: 'sha256_mock_hash'
    });
    deviceIdA = registeredDevice.id;
  });

  afterEach(async () => {
    await app.close();
  });

  // ============================================================================
  // 1. Scoped Notifications & Tenant Isolation
  // ============================================================================

  describe('Scoped Notifications & Tenant Isolation', () => {
    it('should strictly isolate signals so Shop A events never leak to Shop B', async () => {
      const shopAEvents: QueueSignal[] = [];
      const shopBEvents: QueueSignal[] = [];

      broadcaster.subscribe(`shop:${shopIdA}:agent`, signal => {
        shopAEvents.push(signal);
      });
      broadcaster.subscribe(`shop:${shopIdB}:agent`, signal => {
        shopBEvents.push(signal);
      });

      // Create a paid job in Shop A
      const jobA = await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/test.pdf',
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

      // Shop A Owner approves job
      await claimService.approveJob(OWNER_USER_A, jobA.id);

      // Verify Shop A subscriber received the wake event
      expect(shopAEvents).toHaveLength(1);
      expect(shopAEvents[0].event_type).toBe('AGENT_WAKE');
      expect(shopAEvents[0].shop_id).toBe(shopIdA);
      expect(shopAEvents[0].payload).toMatchObject({
        signal: 'AGENT_WAKE',
        shop_id: shopIdA,
        job_id: jobA.id,
        requires_claim: true
      });

      // Verify Shop B subscriber received absolutely ZERO events
      expect(shopBEvents).toHaveLength(0);
    });

    it('should route customer-specific notifications only to the job owner channel', async () => {
      const customer1Events: QueueSignal[] = [];
      const customer2Events: QueueSignal[] = [];

      broadcaster.subscribe(`customer:${CUSTOMER_USER_1.id}`, s => customer1Events.push(s));
      broadcaster.subscribe(`customer:${CUSTOMER_USER_2.id}`, s => customer2Events.push(s));

      const jobA = await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/doc1.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 2500 },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      await claimService.approveJob(OWNER_USER_A, jobA.id);

      // Customer 1 received job status changed event
      expect(customer1Events.length).toBeGreaterThanOrEqual(1);
      expect(customer1Events[0].payload).toMatchObject({
        signal: 'JOB_STATUS_CHANGED',
        job_id: jobA.id,
        to_status: 'approved'
      });

      // Customer 2 received ZERO events (no privacy leakage)
      expect(customer2Events).toHaveLength(0);
    });
  });

  // ============================================================================
  // 2. Realtime Messages Are Wake-Up Signals Only (NOT Ownership Claims)
  // ============================================================================

  describe('Wake-Up Signal Only Safeguard', () => {
    it('should assert AGENT_WAKE contains requires_claim: true and lacks document bytes or lease tokens', async () => {
      const receivedSignals: QueueSignal[] = [];
      broadcaster.subscribe(`shop:${shopIdA}:agent`, s => receivedSignals.push(s));

      const job = await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/sensitive-thesis.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 2500 },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      await claimService.approveJob(OWNER_USER_A, job.id);

      expect(receivedSignals).toHaveLength(1);
      const wake = receivedSignals[0];

      // Verifies explicit wake-up flag
      expect(wake.payload).toHaveProperty('requires_claim', true);
      expect(wake.payload).toHaveProperty('signal', 'AGENT_WAKE');

      // Security check: wake signal must NOT contain lease tokens, secrets, or document content
      const payloadStr = JSON.stringify(wake.payload);
      expect(payloadStr).not.toContain('lease_token');
      expect(payloadStr).not.toContain('download_url');
      expect(payloadStr).not.toContain('raw_document');
      expect(payloadStr).not.toContain('service_role');

      // Verifies job remains in 'approved' status awaiting authenticated claim RPC
      const freshJob = await jobsRepo.findById(job.id);
      expect(freshJob?.status).toBe('approved');
      expect(freshJob?.claimed_at).toBeUndefined();
    });
  });

  // ============================================================================
  // 3. Disconnect / Reconnect & Missed-Event Reconciliation (NO LOST JOB)
  // ============================================================================

  describe('Disconnect / Reconnect & Missed-Event Reconciliation', () => {
    it('should reconcile missed wake signals and claim pending job without losing work', async () => {
      // 1. Agent was offline / missed the event
      const job = await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/urgent-order.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          binding: 'none'
        },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: { base_price: 200, page_count: 1, discount: 0, surge: 2500 },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // Owner approves job while agent is disconnected
      await claimService.approveJob(OWNER_USER_A, job.id);

      // 2. Agent reconnects and queries reconciliation endpoint
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopIdA}/agents/reconcile`,
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          device_id: deviceIdA,
          last_event_id: 0
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;

      // Assert missed events were returned
      expect(data.shop_id).toBe(shopIdA);
      expect(data.device_id).toBe(deviceIdA);
      expect(data.has_claimable_jobs).toBe(true);
      expect(data.claimable_jobs_count).toBe(1);
      expect(data.missed_events.length).toBeGreaterThanOrEqual(1);

      const missedWake = data.missed_events.find(
        (e: QueueSignal) => e.event_type === 'AGENT_WAKE' && e.job_id === job.id
      );
      expect(missedWake).toBeDefined();

      // 3. Agent invokes atomic claim following reconciliation
      const claimRes = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: deviceIdA,
          shop_id: shopIdA,
          requested_printer_id: printerIdA
        }
      });

      expect(claimRes.statusCode).toBe(200);
      const claimData = claimRes.json();
      expect(claimData.claimed).toBe(true);
      expect(claimData.job.job_id).toBe(job.id);
      expect(claimData.job.printer_id).toBe(printerIdA);

      // The job was not lost despite missed realtime event!
      const finalJob = await jobsRepo.findById(job.id);
      expect(finalJob?.status).toBe('claimed');
      expect(finalJob?.claimed_by_agent_id).toBe(deviceIdA);
    });

    it('should support alternative /api/v1/agents/reconcile endpoint with device authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/reconcile',
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          device_id: deviceIdA,
          last_event_id: 0
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.device_id).toBe(deviceIdA);
      expect(data.shop_id).toBe(shopIdA);
    });
  });

  // ============================================================================
  // 4. Active In-Flight Lease Recovery
  // ============================================================================

  describe('Active In-Flight Lease Recovery', () => {
    it('should recover active unexpired lease metadata if agent reconnects mid-execution', async () => {
      // 1. Create and approve job
      const job = await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/long-render.pdf',
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

      // 2. Agent claims the job
      const claimResult = await claimService.claimJob(AGENT_USER_A, {
        contract_version: '1.0.0',
        agent_device_id: deviceIdA,
        shop_id: shopIdA,
        requested_printer_id: printerIdA
      });

      expect(claimResult.claimed).toBe(true);
      const attemptId = claimResult.job.attempt_id;
      const leaseToken = claimResult.job.lease_token;

      // 3. Agent drops connection and reconnects with in_flight_attempt_id
      const reconcileRes = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopIdA}/agents/reconcile`,
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          device_id: deviceIdA,
          in_flight_attempt_id: attemptId,
          in_flight_lease_token: leaseToken
        }
      });

      expect(reconcileRes.statusCode).toBe(200);
      const data = reconcileRes.json().data;

      // Assert active lease was recovered accurately
      expect(data.active_lease).not.toBeNull();
      expect(data.active_lease).toMatchObject({
        job_id: job.id,
        attempt_id: attemptId,
        lease_token: leaseToken,
        status: 'leased',
        is_expired: false
      });
    });

    it('should detect when in-flight lease has expired and inform the reconnecting agent', async () => {
      const past = new Date(Date.now() - 60000).toISOString();

      // Create an expired attempt directly
      const job = await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/expired.pdf',
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
        status: 'claimed',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const expiredAttempt = await attemptsRepo.create({
        job_id: job.id,
        printer_id: printerIdA,
        agent_device_id: deviceIdA,
        lease_expires_at: past,
        idempotency_key: 'exp-attempt-01',
        status: 'leased'
      });

      const reconcileRes = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopIdA}/agents/reconcile`,
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          device_id: deviceIdA,
          in_flight_attempt_id: expiredAttempt.id
        }
      });

      expect(reconcileRes.statusCode).toBe(200);
      const data = reconcileRes.json().data;

      // Expired in-flight lease is not active
      expect(data.active_lease).toBeNull();
    });
  });

  // ============================================================================
  // 5. Revoked Device Rejection
  // ============================================================================

  describe('Revocation and Security Rejections', () => {
    it('should immediately reject reconciliation from a revoked device with 403 REVOKED_DEVICE', async () => {
      // Revoke device
      await pairingService.revokeDevice(OWNER_USER_A, shopIdA, deviceIdA, 'Security compromise');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopIdA}/agents/reconcile`,
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          device_id: deviceIdA,
          last_event_id: 0
        }
      });

      expect(res.statusCode).toBe(403);
      const err = res.json().error;
      expect(err.code).toBe('REVOKED_DEVICE');
      expect(err.message).toContain('revoked');
    });

    it('should reject reconciliation if device does not belong to the target shop', async () => {
      // Attempt to reconcile Shop A device against Shop B
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopIdB}/agents/reconcile`,
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {
          device_id: deviceIdA,
          last_event_id: 0
        }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('should reject reconciliation with 400 if required payload fields are missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopIdA}/agents/reconcile`,
        headers: {
          authorization: 'Bearer token-agent-a'
        },
        payload: {}
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAYLOAD');
    });
  });

  // ============================================================================
  // 6. Dynamic Queue Positions & Live ETA Refresh
  // ============================================================================

  describe('Live Queue Positions & Live ETA Refresh', () => {
    it('should return full queue items and live projected ETAs to shop owner', async () => {
      await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/job1.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 2,
          binding: 'none'
        },
        priority_tier: 'urgent',
        price_total_paise: 2900,
        price_breakdown: { base_price: 400, page_count: 2, discount: 0, surge: 2500 },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopIdA}/queue/live`,
        headers: {
          authorization: 'Bearer token-owner-a'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.shop_id).toBe(shopIdA);
      expect(data.total_queued).toBe(1);
      expect(data.urgent_count).toBe(1);
      expect(data.queue[0].document_storage_key).toBe('shops/a/docs/job1.pdf');
    });

    it('should redact sensitive details and document keys when accessed by customer', async () => {
      await jobsRepo.create({
        shop_id: shopIdA,
        customer_id: CUSTOMER_USER_1.id,
        printer_id: printerIdA,
        document_storage_key: 'shops/a/docs/secret-thesis.pdf',
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

      // Customer 2 inspects the queue (they did not submit this job)
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopIdA}/queue/live`,
        headers: {
          authorization: 'Bearer token-customer-2'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      const jobItem = data.queue[0];

      // Privacy verification: document_storage_key and price breakdown are redacted!
      expect(jobItem.document_storage_key).toBeUndefined();
      expect(jobItem.price_breakdown).toBeUndefined();
      expect(jobItem.is_caller_job).toBe(false);
      expect(jobItem.queue_position).toBe(1);
      expect(jobItem.estimated_wait_seconds).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // 7. Delta Event Cursor Pagination via /queue/events
  // ============================================================================

  describe('Delta Cursor Event Sync', () => {
    it('should return missed signals paginated by after_id cursor', async () => {
      // Publish 3 signals for Shop A
      await broadcaster.publish({
        shop_id: shopIdA,
        channel: `shop:${shopIdA}:queue`,
        event_type: 'QUEUE_REORDERED',
        payload: { total_queued: 1 }
      });
      await broadcaster.publish({
        shop_id: shopIdA,
        channel: `shop:${shopIdA}:queue`,
        event_type: 'QUEUE_REORDERED',
        payload: { total_queued: 2 }
      });
      await broadcaster.publish({
        shop_id: shopIdA,
        channel: `shop:${shopIdA}:queue`,
        event_type: 'QUEUE_REORDERED',
        payload: { total_queued: 3 }
      });

      // Query signals after event ID 1
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopIdA}/queue/events?after_id=1&limit=2`,
        headers: {
          authorization: 'Bearer token-owner-a'
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.events).toHaveLength(2);
      expect(data.events[0].id).toBe(2);
      expect(data.events[1].id).toBe(3);
      expect(data.latest_event_id).toBe(3);
    });
  });
});
