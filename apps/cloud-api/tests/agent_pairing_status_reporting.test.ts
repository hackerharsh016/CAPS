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
import { PairingService } from '../src/modules/agents/pairing.service.js';
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

describe('Agent Pairing, Heartbeat, Revocation & Status Reporting', () => {
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
  let pairingService: PairingService;

  const OWNER_USER: AuthUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner@fastprint.com',
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
  let _printerId: string;

  beforeEach(async () => {
    tokenVerifier = new TestTokenVerifier();
    tokenVerifier.registerUser('token-owner', OWNER_USER);
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

    queueService = new QueueService(jobsRepo, shopsRepo, printersRepo);
    claimService = new AgentClaimService(
      jobsRepo,
      shopsRepo,
      printersRepo,
      agentsRepo,
      attemptsRepo,
      docsRepo
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
      pairingService
    });

    await app.ready();

    // Create shop
    const shop = await shopsRepo.create({
      owner_id: OWNER_USER.id,
      name: 'Cyber Print Hub',
      address: 'Tech Block 3, Suite 102',
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
      urgent_surcharge_config: { type: 'flat', amount: 2500 }
    });
    shopId = shop.id;

    // Create printer
    const p = await printersRepo.create({
      shop_id: shopId,
      name: 'Canon imageRUNNER ADVANCE',
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
    _printerId = p.id;
  });

  afterEach(async () => {
    await app.close();
  });

  // ============================================================================
  // 1. Short-Lived Pairing Codes & Zero Service-Role Secret Leakage
  // ============================================================================

  describe('Agent Pairing & Credential Security', () => {
    it('allows owner to generate a short-lived pairing code with 10-minute TTL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/agents/pairing-code`,
        headers: { authorization: 'Bearer token-owner' },
        payload: { ttl_seconds: 600 }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.pairing_code).toMatch(/^CP-[2-9A-Z]{6}$/);
      expect(body.data.shop_id).toBe(shopId);
      expect(body.data.expires_at).toBeDefined();
    });

    it('rejects pairing code generation for customers with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/agents/pairing-code`,
        headers: { authorization: 'Bearer token-customer' },
        payload: { ttl_seconds: 600 }
      });

      expect(res.statusCode).toBe(403);
    });

    it('successfully pairs agent device, returns per-device secret with DPAPI guidance, and NEVER leaks service-role keys', async () => {
      // 1. Generate code
      const codeRes = await pairingService.generatePairingCode(OWNER_USER, shopId, 600);

      // 2. Pair device
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/pair',
        payload: {
          pairing_code: codeRes.pairing_code,
          device_fingerprint: 'win32-guid-1122334455',
          device_name: 'Reception Counter Desk',
          agent_version: '0.1.0'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.success).toBe(true);
      expect(body.data.device_id).toBeDefined();
      expect(body.data.shop_id).toBe(shopId);
      expect(body.data.device_name).toBe('Reception Counter Desk');

      // Per-device scoped credential generated
      expect(body.data.device_secret).toMatch(/^caps_agent_sec_[0-9a-f]{64}$/);

      // Windows DPAPI storage guidance payload
      expect(body.data.storage_guidance.recommended_provider).toBe('windows_dpapi');
      expect(body.data.storage_guidance.target_credential_name).toBe(
        `CAPS_AGENT_AUTH_${body.data.device_id}`
      );

      // CRITICAL SECURITY INVARIANT: Zero distribution of Supabase service-role keys or root secrets!
      const rawBody = res.body;
      expect(rawBody).not.toContain('service_role');
      expect(rawBody).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(rawBody).not.toContain('SUPABASE_JWT_SECRET');
      expect(rawBody).not.toContain('RAZORPAY_KEY_SECRET');
    });

    it('replay test: pairing code can only be used ONCE and is rejected on replay', async () => {
      const codeRes = await pairingService.generatePairingCode(OWNER_USER, shopId, 600);

      // 1. First pairing succeeds
      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/pair',
        payload: {
          pairing_code: codeRes.pairing_code,
          device_fingerprint: 'device-fp-1',
          device_name: 'First Station'
        }
      });
      expect(firstRes.statusCode).toBe(200);

      // 2. Replay with identical pairing code must be rejected with 409
      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/pair',
        payload: {
          pairing_code: codeRes.pairing_code,
          device_fingerprint: 'device-fp-2',
          device_name: 'Imposter Station'
        }
      });

      expect(replayRes.statusCode).toBe(409);
      const replayBody = JSON.parse(replayRes.body);
      expect(replayBody.error.code).toBe('PAIRING_CODE_ALREADY_USED');
    });

    it('rejects expired pairing codes with 410', async () => {
      // Create code expired 5 minutes ago
      const pairing = await agentsRepo.createPairingCode(shopId, OWNER_USER.id, -300);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/pair',
        payload: {
          pairing_code: pairing.code,
          device_fingerprint: 'device-fp-3',
          device_name: 'Late Station'
        }
      });

      expect(res.statusCode).toBe(410);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('PAIRING_CODE_EXPIRED');
    });
  });

  // ============================================================================
  // 2. Heartbeat, Device Revocation & Tenant Boundary
  // ============================================================================

  describe('Heartbeat & Device Revocation', () => {
    let pairedDeviceId: string;

    beforeEach(async () => {
      const codeRes = await pairingService.generatePairingCode(OWNER_USER, shopId, 600);
      const pairRes = await pairingService.pairDevice({
        pairing_code: codeRes.pairing_code,
        device_fingerprint: 'main-counter-pc-fp',
        device_name: 'Main Counter PC',
        agent_version: '0.1.0'
      });
      pairedDeviceId = pairRes.device_id;
    });

    it('records agent heartbeat successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/heartbeat',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          device_id: pairedDeviceId,
          agent_version: '0.1.0',
          metrics: { cpu_usage: 12.5, memory_mb: 256 }
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.acknowledged).toBe(true);
      expect(body.data.is_revoked).toBe(false);
      expect(body.data.server_time).toBeDefined();
    });

    it('revoked agent device is immediately denied heartbeats with 403 REVOKED_DEVICE', async () => {
      // 1. Owner revokes device
      const revokeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/agents/${pairedDeviceId}/revoke`,
        headers: { authorization: 'Bearer token-owner' },
        payload: { reason: 'Decommissioned PC hardware' }
      });
      expect(revokeRes.statusCode).toBe(200);

      // 2. Heartbeat rejected
      const hbRes = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/heartbeat',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          device_id: pairedDeviceId,
          agent_version: '0.1.0'
        }
      });

      expect(hbRes.statusCode).toBe(403);
      const hbBody = JSON.parse(hbRes.body);
      expect(hbBody.error.code).toBe('REVOKED_DEVICE');
    });

    it('owner can list paired agent devices for their shop', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/agents`,
        headers: { authorization: 'Bearer token-owner' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.devices).toHaveLength(1);
      expect(body.data.devices[0].id).toBe(pairedDeviceId);
      expect(body.data.devices[0].is_revoked).toBe(false);
    });
  });

  // ============================================================================
  // 3. Signed Download Grants (ADR 0007 Transient Lifecycles)
  // ============================================================================

  describe('Signed Download Grants', () => {
    let pairedDeviceId: string;
    let claimedJobId: string;
    let attemptId: string;
    let leaseToken: string;

    beforeEach(async () => {
      // 1. Pair agent
      const codeRes = await pairingService.generatePairingCode(OWNER_USER, shopId, 600);
      const pairRes = await pairingService.pairDevice({
        pairing_code: codeRes.pairing_code,
        device_fingerprint: 'download-test-agent',
        device_name: 'Download Test Station'
      });
      pairedDeviceId = pairRes.device_id;

      // 2. Seed doc & approved job
      const doc = await docsRepo.create({
        customer_id: CUSTOMER_USER.id,
        file_name: 'report.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 88200,
        storage_key: 'docs/report.pdf',
        checksum_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        page_count: 12,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
      await docsRepo.update(doc.id, { status: 'ready' });

      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_id: doc.id,
        document_storage_key: doc.storage_key,
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
      claimedJobId = job.id;

      // 3. Claim job
      const claim = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: pairedDeviceId,
        shop_id: shopId,
        lease_duration_seconds: 180,
        timestamp: new Date().toISOString()
      });
      attemptId = claim.job!.attempt_id;
      leaseToken = claim.job!.lease_token;
    });

    it('issues signed download grant with 5-minute (300s) TTL for active claim lease', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/download-grant',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.download_url).toContain('grant_token=');
      expect(body.data.download_url).toContain('expires_at=');
      expect(body.data.checksum_sha256).toBe(
        'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
      );
      expect(body.data.file_size_bytes).toBe(88200);
      expect(body.data.content_type).toBe('application/pdf');

      // Attempt transitioned to downloading
      const attempt = await attemptsRepo.findById(attemptId);
      expect(attempt!.status).toBe('downloading');
    });

    it('rejects download grant with mismatched lease token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/download-grant',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: 'bogus-lease-token-12345678'
        }
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ============================================================================
  // 4. Agent Status Reporting (Strict Frozen Schema Conformance)
  // ============================================================================

  describe('Agent Status Reporting Lifecycle', () => {
    let pairedDeviceId: string;
    let claimedJobId: string;
    let attemptId: string;
    let leaseToken: string;

    beforeEach(async () => {
      const codeRes = await pairingService.generatePairingCode(OWNER_USER, shopId, 600);
      const pairRes = await pairingService.pairDevice({
        pairing_code: codeRes.pairing_code,
        device_fingerprint: 'status-reporting-device',
        device_name: 'Status Station'
      });
      pairedDeviceId = pairRes.device_id;

      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_USER.id,
        document_storage_key: 'status-job.pdf',
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
      claimedJobId = job.id;

      const claim = await claimService.claimJob(AGENT_USER, {
        contract_version: '1.0.0',
        agent_device_id: pairedDeviceId,
        shop_id: shopId,
        lease_duration_seconds: 180,
        timestamp: new Date().toISOString()
      });
      attemptId = claim.job!.attempt_id;
      leaseToken = claim.job!.lease_token;
    });

    it('reports DOWNLOADING status and receives valid contract acknowledgment', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'DOWNLOADING',
          pages_printed: 0,
          total_pages: 10,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.contract_version).toBe('1.0.0');
      expect(body.success).toBe(true);
      expect(body.status).toBe('DOWNLOADING');
      expect(body.job_id).toBe(claimedJobId);
      expect(body.acknowledged_at).toBeDefined();

      const attempt = await attemptsRepo.findById(attemptId);
      expect(attempt!.status).toBe('downloading');
    });

    it('reports PRINTING status with Windows Spooler Job ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'PRINTING',
          spooler_job_id: 1042,
          pages_printed: 5,
          total_pages: 10,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('PRINTING');

      const attempt = await attemptsRepo.findById(attemptId);
      expect(attempt!.status).toBe('printing');
      expect(attempt!.spooler_job_id).toBe(1042);

      const job = await jobsRepo.findById(claimedJobId);
      expect(job!.status).toBe('printing');
    });

    it('reports COMPLETED status, marks job completed and updates audit ledger', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'COMPLETED',
          spooler_job_id: 1042,
          pages_printed: 10,
          total_pages: 10,
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('COMPLETED');

      const job = await jobsRepo.findById(claimedJobId);
      expect(job!.status).toBe('completed');
      expect(job!.completed_at).toBeDefined();

      const attempt = await attemptsRepo.findById(attemptId);
      expect(attempt!.status).toBe('completed');
    });

    it('reports FAILED status with error code, fails attempt, and recovers job for re-dispatch', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'FAILED',
          spooler_job_id: null,
          pages_printed: 2,
          total_pages: 10,
          error_code: 'PRINTER_OFFLINE',
          error_message: 'Paper tray empty and print job aborted by Windows spooler',
          timestamp: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('FAILED');

      const attempt = await attemptsRepo.findById(attemptId);
      expect(attempt!.status).toBe('failed');
      expect(attempt!.error_code).toBe('PRINTER_OFFLINE');

      // Job recovered to approved for re-dispatch (attempt 1 < 3)
      const job = await jobsRepo.findById(claimedJobId);
      expect(job!.status).toBe('approved');
    });
  });
});
