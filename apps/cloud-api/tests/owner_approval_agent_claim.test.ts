import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
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
import type { ITokenVerifier, AuthUser } from '../src/plugins/auth.js';

class TestTokenVerifier implements ITokenVerifier {
  private users = new Map<string, AuthUser>();

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

describe('Owner Approval & Exclusive Agent Claim Protocol', () => {
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
  let claimService: AgentClaimService;

  const OWNER_USER: AuthUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner@fastprint.com',
    role: 'shop_owner'
  };

  const OTHER_OWNER: AuthUser = {
    id: '99999999-9999-9999-9999-999999999999',
    email: 'otherowner@competitor.com',
    role: 'shop_owner'
  };

  const CUSTOMER_USER: AuthUser = {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'student@university.edu',
    role: 'customer'
  };

  const AGENT_USER_1: AuthUser = {
    id: '44444444-4444-4444-4444-444444444441',
    email: 'agent1@printagent.caps.local',
    role: 'agent'
  };

  const AGENT_USER_2: AuthUser = {
    id: '44444444-4444-4444-4444-444444444442',
    email: 'agent2@printagent.caps.local',
    role: 'agent'
  };

  let shopId: string;
  let bwPrinterId: string;
  let _colorPrinterId: string;
  let agentDevice1Id: string;
  let agentDevice2Id: string;
  let otherShopId: string;
  let otherShopAgentId: string;

  beforeEach(async () => {
    tokenVerifier = new TestTokenVerifier();
    tokenVerifier.registerUser('token-owner', OWNER_USER);
    tokenVerifier.registerUser('token-other-owner', OTHER_OWNER);
    tokenVerifier.registerUser('token-customer', CUSTOMER_USER);
    tokenVerifier.registerUser('token-agent-1', AGENT_USER_1);
    tokenVerifier.registerUser('token-agent-2', AGENT_USER_2);

    shopsRepo = new MockShopsRepository();
    printersRepo = new MockPrintersRepository();
    jobsRepo = new MockPrintJobsRepository();
    docsRepo = new MockDocumentsRepository();
    storageService = new MockStorageService();
    quotesRepo = new MockQuotesRepository();
    agentsRepo = new MockAgentsRepository();
    attemptsRepo = new MockJobAttemptsRepository();

    queueService = new QueueService(jobsRepo, shopsRepo, printersRepo);
    claimService = new AgentClaimService(
      jobsRepo,
      shopsRepo,
      printersRepo,
      agentsRepo,
      attemptsRepo,
      docsRepo
    );

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
      agentClaimService: claimService
    });

    await app.ready();

    // 1. Create primary shop
    const shop = await shopsRepo.create({
      owner_id: OWNER_USER.id,
      name: 'Campus Express Copy',
      address: 'Main Quad, Hall A',
      geo_lat: 12.9716,
      geo_lng: 77.5946,
      pricing_config: {
        A4: {
          bw_single_paise: 200,
          bw_double_paise: 350,
          color_single_paise: 1000,
          color_double_paise: 1800
        },
        A3: {
          bw_single_paise: 500,
          bw_double_paise: 900,
          color_single_paise: 2000,
          color_double_paise: 3500
        },
        Legal: {
          bw_single_paise: 250,
          bw_double_paise: 450,
          color_single_paise: 1200,
          color_double_paise: 2000
        },
        binding_prices_paise: { none: 0, spiral: 3000, staple: 500, lamination: 2000 },
        gst_percentage: 18
      },
      urgent_surcharge_config: { type: 'flat', amount: 2500 },
      auto_print_enabled: false
    });
    shopId = shop.id;

    // 2. Create another shop for tenant boundary testing
    const otherShop = await shopsRepo.create({
      owner_id: OTHER_OWNER.id,
      name: 'Competitor Print',
      address: 'North Campus',
      geo_lat: 12.98,
      geo_lng: 77.6,
      pricing_config: {
        A4: {
          bw_single_paise: 200,
          bw_double_paise: 350,
          color_single_paise: 1000,
          color_double_paise: 1800
        },
        A3: {
          bw_single_paise: 500,
          bw_double_paise: 900,
          color_single_paise: 2000,
          color_double_paise: 3500
        },
        Legal: {
          bw_single_paise: 250,
          bw_double_paise: 450,
          color_single_paise: 1200,
          color_double_paise: 2000
        },
        binding_prices_paise: { none: 0, spiral: 3000, staple: 500, lamination: 2000 },
        gst_percentage: 18
      },
      urgent_surcharge_config: { type: 'flat', amount: 2000 }
    });
    otherShopId = otherShop.id;

    // 3. Create printers
    const bwPrinter = await printersRepo.create({
      shop_id: shopId,
      name: 'HP LaserJet 400 (B&W Simplex/Duplex)',
      role: 'bw',
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: ['A4', 'Legal'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      }
    });
    bwPrinterId = bwPrinter.id;

    const colorPrinter = await printersRepo.create({
      shop_id: shopId,
      name: 'Epson WorkForce Color (Color Simplex)',
      role: 'color',
      status: 'online',
      is_default: false,
      capabilities: {
        paper_sizes: ['A4'],
        color_modes: ['bw', 'color'],
        duplex_supported: false, // Simplex only
        max_copies: 50
      }
    });
    _colorPrinterId = colorPrinter.id;

    // 4. Register agent devices
    const d1 = await agentsRepo.registerDevice({
      shop_id: shopId,
      device_fingerprint: 'win32-desktop-station-01-hash',
      device_name: 'Counter Desk PC 1',
      auth_token_hash: 'hash-agent-1',
      paired_by: OWNER_USER.id
    });
    agentDevice1Id = d1.id;

    const d2 = await agentsRepo.registerDevice({
      shop_id: shopId,
      device_fingerprint: 'win32-desktop-station-02-hash',
      device_name: 'Counter Desk PC 2',
      auth_token_hash: 'hash-agent-2',
      paired_by: OWNER_USER.id
    });
    agentDevice2Id = d2.id;

    const otherDevice = await agentsRepo.registerDevice({
      shop_id: otherShopId,
      device_fingerprint: 'competitor-device-hash',
      device_name: 'Competitor Station',
      auth_token_hash: 'hash-competitor',
      paired_by: OTHER_OWNER.id
    });
    otherShopAgentId = otherDevice.id;
  });

  afterEach(async () => {
    await app.close();
  });

  // ============================================================================
  // 1. Owner Approval Gate (ADR 0004 & MVP Confirmation)
  // ============================================================================

  describe('Owner Approval Gate', () => {
    it('blocks approval of unpaid print jobs in pending_payment status', async () => {
      const unpaidJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'unpaid.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'pending_payment',
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      await expect(claimService.approveJob(OWNER_USER, unpaidJob.id)).rejects.toThrow(
        /pending_payment/i
      );
    });

    it('rejects approval attempt by customers with 403 Forbidden', async () => {
      const queuedJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'queued.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'queued',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/jobs/${queuedJob.id}/approve`,
        headers: { authorization: 'Bearer token-customer' }
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects approval attempt by owner of a different shop', async () => {
      const queuedJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'queued.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'queued',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      await expect(claimService.approveJob(OTHER_OWNER, queuedJob.id)).rejects.toThrow(
        /do not own shop/i
      );
    });

    it('allows shop owner to approve a queued job advancing it to approved', async () => {
      const queuedJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'queued.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'queued',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/jobs/${queuedJob.id}/approve`,
        headers: { authorization: 'Bearer token-owner' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.job.status).toBe('approved');

      // Audit event recorded
      const events = await jobsRepo.getEvents(queuedJob.id);
      expect(events.some(e => e.to_status === 'approved')).toBe(true);
    });
  });

  // ============================================================================
  // 2. Exclusive Agent Claim Protocol
  // ============================================================================

  describe('Agent Claim Protocol & Capability Scoping', () => {
    it('returns claimed: false when no approved jobs exist in the shop', async () => {
      // 1 job in queued (unapproved)
      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'queued.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'queued', // NOT approved yet!
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDevice1Id,
          shop_id: shopId,
          lease_duration_seconds: 120,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.claimed).toBe(false);
      expect(body.job).toBeNull();
    });

    it('rejects claim if agent device belongs to a different shop (tenant boundary)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: otherShopAgentId, // belongs to otherShopId
          shop_id: shopId, // claiming against shopId
          lease_duration_seconds: 120,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('TENANT_MISMATCH');
    });

    it('rejects claim if agent device is revoked', async () => {
      await agentsRepo.revokeDevice(agentDevice1Id, 'Compromised machine key');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDevice1Id,
          shop_id: shopId,
          lease_duration_seconds: 120,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('REVOKED_DEVICE');
    });

    it('validates printer capabilities: color duplex job cannot be claimed on simplex B&W printer', async () => {
      // Create approved color duplex job
      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'color-duplex.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'color',
          sides: 'double', // Duplex
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 1800,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 1600,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 1800,
          gst_paise: 324,
          total_paise: 2124
        },
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // Requesting claim explicitly on B&W printer: color duplex job cannot be claimed on it, so claimed: false
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDevice1Id,
          shop_id: shopId,
          requested_printer_id: bwPrinterId, // B&W printer cannot print color!
          lease_duration_seconds: 120,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.claimed).toBe(false);
      expect(body.job).toBeNull();
    });

    it('successfully claims next eligible approved job conforming to frozen contract schema', async () => {
      // Create document in docsRepo
      const doc = await docsRepo.create({
        customer_id: CUSTOMER_USER.id,
        file_name: 'lecture-notes.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 45000,
        storage_key: 'docs/lecture-notes.pdf',
        checksum_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        page_count: 5,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
      await docsRepo.update(doc.id, { status: 'ready' });

      // Create approved job linked to doc
      const approvedJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_id: doc.id,
        document_storage_key: doc.storage_key,
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'double',
          orientation: 'portrait',
          copies: 2,
          page_range: 'all',
          binding: 'staple'
        },
        priority_tier: 'urgent',
        price_total_paise: 3200,
        price_breakdown: {
          base_pages_paise: 700,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 500,
          urgent_surcharge_paise: 2000,
          subtotal_paise: 3200,
          gst_paise: 576,
          total_paise: 3776
        },
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDevice1Id,
          shop_id: shopId,
          requested_printer_id: bwPrinterId,
          lease_duration_seconds: 180,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Verify contract conformance
      expect(body.contract_version).toBe('1.0.0');
      expect(body.claimed).toBe(true);
      expect(body.job).not.toBeNull();
      expect(body.job.job_id).toBe(approvedJob.id);
      expect(body.job.attempt_id).toBeDefined();
      expect(body.job.lease_token).toBeDefined();
      expect(body.job.lease_token.length).toBeGreaterThanOrEqual(16);
      expect(body.job.lease_expires_at).toBeDefined();
      expect(body.job.printer_id).toBe(bwPrinterId);
      expect(body.job.download_url).toBe(`/api/v1/documents/${doc.id}/download`);
      expect(body.job.checksum_sha256).toBe(doc.checksum_sha256);
      expect(body.job.file_size_bytes).toBe(doc.file_size_bytes);
      expect(body.job.settings.paper_size).toBe('A4');
      expect(body.job.settings.binding).toBe('staple');

      // Verify DB state
      const updatedJob = await jobsRepo.findById(approvedJob.id);
      expect(updatedJob!.status).toBe('claimed');
      expect(updatedJob!.claimed_by_agent_id).toBe(agentDevice1Id);

      // Verify Attempt record
      const activeAttempt = await attemptsRepo.findActiveByJobId(approvedJob.id);
      expect(activeAttempt).not.toBeNull();
      expect(activeAttempt!.status).toBe('leased');
      expect(activeAttempt!.lease_token).toBe(body.job.lease_token);
    });
  });

  // ============================================================================
  // 3. Concurrency Protection & Idempotency
  // ============================================================================

  describe('Concurrency & Idempotency', () => {
    it('guarantees mutual exclusion: two agents attempting concurrent claim of the same job cannot both claim', async () => {
      // 1 single approved job
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'single.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      // Fire 2 concurrent claims from different agent devices
      const [res1, res2] = await Promise.all([
        claimService.claimJob(AGENT_USER_1, {
          contract_version: '1.0.0',
          agent_device_id: agentDevice1Id,
          shop_id: shopId,
          lease_duration_seconds: 120,
          timestamp: new Date().toISOString()
        }),
        claimService.claimJob(AGENT_USER_2, {
          contract_version: '1.0.0',
          agent_device_id: agentDevice2Id,
          shop_id: shopId,
          lease_duration_seconds: 120,
          timestamp: new Date().toISOString()
        })
      ]);

      // Exactly ONE claim succeeded with job; the other received claimed: false
      const claimsSucceeded = [res1.claimed, res2.claimed].filter(Boolean).length;
      expect(claimsSucceeded).toBe(1);

      const winner = res1.claimed ? res1 : res2;
      const loser = res1.claimed ? res2 : res1;

      expect(winner.job?.job_id).toBe(job.id);
      expect(loser.job).toBeNull();
    });

    it('returns existing lease idempotently when identical idempotency_key is replayed', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'idemp.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const fixedKey = 'agent-claim-idemp-12345';

      // 1. First claim
      const firstClaim = await claimService.claimJob(AGENT_USER_1, {
        contract_version: '1.0.0',
        agent_device_id: agentDevice1Id,
        shop_id: shopId,
        idempotency_key: fixedKey,
        lease_duration_seconds: 120,
        timestamp: new Date().toISOString()
      });
      expect(firstClaim.claimed).toBe(true);

      // 2. Replayed claim with identical idempotency_key
      const replayClaim = await claimService.claimJob(AGENT_USER_1, {
        contract_version: '1.0.0',
        agent_device_id: agentDevice1Id,
        shop_id: shopId,
        idempotency_key: fixedKey,
        lease_duration_seconds: 120,
        timestamp: new Date().toISOString()
      });

      expect(replayClaim.claimed).toBe(true);
      expect(replayClaim.job!.attempt_id).toBe(firstClaim.job!.attempt_id);
      expect(replayClaim.job!.lease_token).toBe(firstClaim.job!.lease_token);

      // Only ONE attempt record created
      const attempts = await attemptsRepo.findByJobId(job.id);
      expect(attempts).toHaveLength(1);
    });
  });

  // ============================================================================
  // 4. Expired Lease Reconciliation & Recovery
  // ============================================================================

  describe('Expired Lease Reconciliation & Recovery', () => {
    it('identifies expired claim lease, marks attempt failed, and recovers job back to approved for re-dispatch', async () => {
      const now = Date.now();

      // Create an approved job that was claimed 10 minutes ago with a 2 minute lease (expired 8 minutes ago)
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'abandoned.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'claimed',
        enqueued_at: new Date(now - 15 * 60 * 1000).toISOString(),
        claimed_at: new Date(now - 10 * 60 * 1000).toISOString(),
        claimed_by_agent_id: agentDevice1Id,
        document_expires_at: new Date(now + 86400000).toISOString()
      });

      const attempt = await attemptsRepo.create({
        job_id: job.id,
        printer_id: bwPrinterId,
        agent_device_id: agentDevice1Id,
        lease_expires_at: new Date(now - 8 * 60 * 1000).toISOString(), // Expired
        idempotency_key: 'abandoned-attempt-key',
        status: 'leased'
      });

      // Execute reconciliation
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/leases/reconcile`,
        headers: { authorization: 'Bearer token-owner' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.reconciled_count).toBe(1);
      expect(body.data.recovered_job_ids).toContain(job.id);

      // Verify attempt failed
      const updatedAttempt = await attemptsRepo.findById(attempt.id);
      expect(updatedAttempt!.status).toBe('failed');
      expect(updatedAttempt!.error_code).toBe('LEASE_EXPIRED');

      // Verify job recovered back to 'approved'
      const updatedJob = await jobsRepo.findById(job.id);
      expect(updatedJob!.status).toBe('approved');
      expect(updatedJob!.claimed_by_agent_id).toBeUndefined();

      // Proves another agent can now claim the recovered job!
      const newClaim = await claimService.claimJob(AGENT_USER_2, {
        contract_version: '1.0.0',
        agent_device_id: agentDevice2Id,
        shop_id: shopId,
        lease_duration_seconds: 120,
        timestamp: new Date().toISOString()
      });

      expect(newClaim.claimed).toBe(true);
      expect(newClaim.job!.job_id).toBe(job.id);
      expect(newClaim.job!.attempt_id).not.toBe(attempt.id);
    });

    it('routes job to requires_review when lease timeouts exceed maximum retry threshold (3 attempts)', async () => {
      const now = Date.now();

      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'flaky.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'claimed',
        enqueued_at: new Date(now - 30 * 60 * 1000).toISOString(),
        claimed_at: new Date(now - 10 * 60 * 1000).toISOString(),
        document_expires_at: new Date(now + 86400000).toISOString()
      });

      // 2 prior failed attempts
      await attemptsRepo.create({
        job_id: job.id,
        lease_expires_at: new Date(now - 25 * 60 * 1000).toISOString(),
        idempotency_key: 'prior-1',
        status: 'failed',
        error_code: 'LEASE_EXPIRED'
      });

      await attemptsRepo.create({
        job_id: job.id,
        lease_expires_at: new Date(now - 20 * 60 * 1000).toISOString(),
        idempotency_key: 'prior-2',
        status: 'failed',
        error_code: 'LEASE_EXPIRED'
      });

      // 3rd attempt is currently expired
      await attemptsRepo.create({
        job_id: job.id,
        lease_expires_at: new Date(now - 5 * 60 * 1000).toISOString(),
        idempotency_key: 'prior-3',
        status: 'leased'
      });

      const reconcileResult = await claimService.reconcileExpiredLeases(shopId, now);
      expect(reconcileResult.requires_review_job_ids).toContain(job.id);

      const finalJob = await jobsRepo.findById(job.id);
      expect(finalJob!.status).toBe('requires_review');
    });
  });

  // ============================================================================
  // 5. Lease Renewal & Heartbeat
  // ============================================================================

  describe('Lease Renewal & Heartbeat', () => {
    it('extends active claim lease deadline for long downloads', async () => {
      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'large.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          orientation: 'portrait',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        price_total_paise: 200,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 200,
          gst_paise: 36,
          total_paise: 236
        },
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const claim = await claimService.claimJob(AGENT_USER_1, {
        contract_version: '1.0.0',
        agent_device_id: agentDevice1Id,
        shop_id: shopId,
        lease_duration_seconds: 60,
        timestamp: new Date().toISOString()
      });

      const initialExpires = new Date(claim.job!.lease_expires_at).getTime();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/leases/renew',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          job_id: job.id,
          attempt_id: claim.job!.attempt_id,
          lease_token: claim.job!.lease_token,
          extend_seconds: 180
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const renewedExpires = new Date(body.data.lease_expires_at).getTime();
      expect(renewedExpires).toBeGreaterThan(initialExpires);
    });

    it('rejects lease renewal with wrong lease token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/leases/renew',
        headers: { authorization: 'Bearer token-agent-1' },
        payload: {
          job_id: 'nonexistent-job',
          attempt_id: 'nonexistent-attempt',
          lease_token: 'bogus-token-12345678'
        }
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
