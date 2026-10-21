import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { MockShopsRepository } from '../../modules/shops/shops.repository.js';
import { MockPrintersRepository } from '../../modules/printers/printers.repository.js';
import { MockPrintJobsRepository } from '../../modules/print-jobs/print-jobs.repository.js';
import { MockDocumentsRepository } from '../../modules/documents/documents.repository.js';
import { MockStorageService } from '../../modules/documents/storage.service.js';
import { MockQuotesRepository } from '../../modules/pricing/quotes.repository.js';
import { QueueService } from '../../modules/queue/queue.service.js';
import { MockAgentsRepository } from '../../modules/agents/agents.repository.js';
import { MockJobAttemptsRepository } from '../../modules/agents/attempts.repository.js';
import { AgentClaimService } from '../../modules/agents/agent-claim.service.js';
import { PairingService } from '../../modules/agents/pairing.service.js';
import type { ITokenVerifier, AuthUser } from '../../plugins/auth.js';

const require = createRequire(import.meta.url);
const { validateContract, validators, openApiV1 } = require('../../../../../packages/print-contracts/dist/index.js');

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

describe('Task INT-D3-01: Agent Endpoints & OpenAPI Contract Harmonization', () => {
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

  const AGENT_USER: AuthUser = {
    id: '44444444-4444-4444-4444-444444444441',
    email: 'agent@printagent.caps.local',
    role: 'agent'
  };

  let shopId: string;
  let printerId: string;
  let agentDeviceId: string;

  beforeEach(async () => {
    tokenVerifier = new TestTokenVerifier();
    tokenVerifier.registerUser('token-owner', OWNER_USER);
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
      agentsRepo,
      attemptsRepo,
      queueService,
      agentClaimService: claimService,
      pairingService
    });

    const shop = await shopsRepo.create({
      owner_id: OWNER_USER.id,
      name: 'QuickPrint Test Hub',
      address: '77 Campus Square',
      geo_lat: 12.9716,
      geo_lng: 77.5946,
      pricing_config: {
        A4: {
          bw_single_paise: 200,
          bw_double_paise: 350,
          color_single_paise: 1000,
          color_double_paise: 1800
        }
      } as any,
      urgent_surcharge_config: {
        mode: 'flat',
        amount_paise: 50
      } as any
    });
    shopId = shop.id;

    const printer = await printersRepo.create({
      shop_id: shopId,
      name: 'Canon imageRUNNER 2006',
      status: 'online',
      capabilities: {
        paper_sizes: ['a4', 'a3', 'letter', 'legal'],
        color_modes: ['bw', 'color'],
        duplex_supported: true,
        max_copies: 99
      }
    });
    printerId = printer.id;

    const paired = await agentsRepo.registerDevice({
      shop_id: shopId,
      device_fingerprint: 'sha256-device-hash-primary',
      device_name: 'Countertop Agent PC',
      auth_token_hash: 'caps_agent_sec_dummy_hash',
      agent_version: '0.1.0',
      paired_by: OWNER_USER.id
    });
    agentDeviceId = paired.id;
  });

  describe('Step 1: Singular (/api/v1/agent/*) & Plural (/api/v1/agents/*) Baseline Routing', () => {
    it('resolves both /api/v1/agent/pair and /api/v1/agents/pair identically', async () => {
      const code1 = await pairingService.generatePairingCode(OWNER_USER, shopId, 300);
      const code2 = await pairingService.generatePairingCode(OWNER_USER, shopId, 300);

      const resSingular = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/pair',
        payload: {
          pairing_code: code1.pairing_code,
          device_fingerprint: 'fp-singular-01',
          device_name: 'Singular Station'
        }
      });
      expect(resSingular.statusCode).toBe(200);
      expect(resSingular.json().success).toBe(true);
      expect(resSingular.json().shop_id).toBe(shopId);

      const resPlural = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/pair',
        payload: {
          pairing_code: code2.pairing_code,
          device_fingerprint: 'fp-plural-01',
          device_name: 'Plural Station'
        }
      });
      expect(resPlural.statusCode).toBe(200);
      expect(resPlural.json().success).toBe(true);
      expect(resPlural.json().shop_id).toBe(shopId);
    });

    it('resolves both /api/v1/agent/heartbeat and /api/v1/agents/heartbeat identically', async () => {
      const resSingular = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/heartbeat',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          device_id: agentDeviceId,
          agent_version: '0.1.0'
        }
      });
      expect(resSingular.statusCode).toBe(200);
      expect(resSingular.json().acknowledged).toBe(true);

      const resPlural = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/heartbeat',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          device_id: agentDeviceId,
          agent_version: '0.1.0'
        }
      });
      expect(resPlural.statusCode).toBe(200);
      expect(resPlural.json().acknowledged).toBe(true);
    });

    it('resolves both /api/v1/agent/jobs/claim and /api/v1/agents/claim identically', async () => {
      const resSingular = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/claim',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDeviceId,
          shop_id: shopId
        }
      });
      expect(resSingular.statusCode).toBe(200);
      expect(resSingular.json().claimed).toBe(false);

      const resPlural = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/claim',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDeviceId,
          shop_id: shopId
        }
      });
      expect(resPlural.statusCode).toBe(200);
      expect(resPlural.json().claimed).toBe(false);
    });
  });

  describe('Step 2: pairAgentDeviceSchema Transparency', () => {
    it('accepts (device_fingerprint, device_name) payload', async () => {
      const code = await pairingService.generatePairingCode(OWNER_USER, shopId, 300);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/pair',
        payload: {
          pairing_code: code.pairing_code,
          device_fingerprint: 'sha256-win-hardware-fp',
          device_name: 'Counter Station Alpha',
          agent_version: '1.0.0'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.device_id).toBeDefined();
      expect(body.device_secret).toMatch(/^caps_agent_sec_/);
    });

    it('accepts (hostname, os_version, fingerprint) payload transparently (Python Agent)', async () => {
      const code = await pairingService.generatePairingCode(OWNER_USER, shopId, 300);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/pair',
        payload: {
          pairing_code: code.pairing_code,
          hostname: 'DESKTOP-POS-WINDOWS11',
          os_version: 'Windows-11-10.0.22631-SP0',
          fingerprint: 'hardware-guid-98765',
          agent_version: '0.1.0'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.device_id).toBeDefined();
      expect(body.device_token).toMatch(/^caps_agent_sec_/);
    });

    it('accepts Python agent minimal pairing payload (pairing_code, hostname, os_version)', async () => {
      const code = await pairingService.generatePairingCode(OWNER_USER, shopId, 300);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/pair',
        payload: {
          pairing_code: code.pairing_code,
          hostname: 'STORE-PC-12',
          os_version: 'Windows-10-10.0.19045',
          agent_version: '0.1.0'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.device_id).toBeDefined();
    });

    it('rejects payload when neither device_fingerprint nor hostname is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/pair',
        payload: {
          pairing_code: 'PAIR-INVALID-123'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('Step 3: POST /api/v1/agent/jobs/claim Contract Conformance (job-claim-response.schema.json)', () => {
    it('returns 200 with schema matching job-claim-response.schema.json when job is claimed', async () => {
      const doc = await docsRepo.create({
        customer_id: 'cust-uuid-1',
        file_name: 'test-contract-report.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 2048,
        storage_key: `shops/${shopId}/docs/report.pdf`,
        checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      });

      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: 'cust-uuid-1',
        document_id: doc.id,
        printer_id: printerId,
        settings: {
          paper_size: 'a4',
          color_mode: 'bw',
          duplex: 'duplex_long',
          orientation: 'portrait',
          copies: 2,
          page_range: '1-5',
          binding: 'corner_staple'
        },
        priority_class: 'urgent',
        estimated_sheets: 3,
        total_price: 165,
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/claim',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDeviceId,
          shop_id: shopId,
          lease_duration_seconds: 120
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Strict JSON Schema validation against job-claim-response.schema.json
      const validation = validateContract(validators.validateJobClaimResponse, body);
      expect(validation.errors).toBeUndefined();
      expect(validation.success).toBe(true);

      expect(body.contract_version).toBe('1.0.0');
      expect(body.claimed).toBe(true);
      expect(body.job).not.toBeNull();
      expect(body.job.job_id).toBe(job.id);
      expect(body.job.attempt_id).toBeDefined();
      expect(body.job.lease_token).toBeDefined();
      expect(body.job.lease_token.length).toBeGreaterThanOrEqual(16);
      expect(body.job.download_url).toContain(`/api/v1/documents/${doc.id}/download`);
      expect(body.job.checksum_sha256).toBe(doc.checksum_sha256);
      expect(body.job.settings).toMatchObject({
        paper_size: 'a4',
        color_mode: 'bw',
        duplex: 'duplex_long'
      });
    });

    it('returns 200 with schema matching job-claim-response.schema.json when no jobs are available', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/claim',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDeviceId,
          shop_id: shopId
        }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      const validation = validateContract(validators.validateJobClaimResponse, body);
      expect(validation.errors).toBeUndefined();
      expect(validation.success).toBe(true);
      expect(body.claimed).toBe(false);
      expect(body.job).toBeNull();
    });
  });

  describe('Step 4: POST /api/v1/agent/jobs/status Enum Casing & Field Validation', () => {
    let claimedJobId: string;
    let attemptId: string;
    let leaseToken: string;

    beforeEach(async () => {
      const doc = await docsRepo.create({
        customer_id: 'cust-uuid-2',
        file_name: 'status-test.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1024,
        storage_key: `shops/${shopId}/docs/status.pdf`,
        checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      });

      const job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: 'cust-uuid-2',
        document_id: doc.id,
        printer_id: printerId,
        settings: {
          paper_size: 'a4',
          color_mode: 'bw',
          duplex: 'simplex',
          orientation: 'portrait',
          copies: 1,
          page_range: '1',
          binding: 'none'
        },
        priority_class: 'flexible',
        estimated_sheets: 1,
        total_price: 55,
        status: 'approved',
        enqueued_at: new Date().toISOString(),
        document_expires_at: new Date(Date.now() + 86400000).toISOString()
      });

      const claimRes = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/claim',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          agent_device_id: agentDeviceId,
          shop_id: shopId
        }
      });

      const claimBody = claimRes.json();
      claimedJobId = claimBody.job.job_id;
      attemptId = claimBody.job.attempt_id;
      leaseToken = claimBody.job.lease_token;
      expect(job.id).toBe(claimedJobId);
    });

    it('accepts UPPERCASE status enums (DOWNLOADING, PRINTING, COMPLETED) without 400 error', async () => {
      // 1. DOWNLOADING
      const resDownload = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'DOWNLOADING',
          pages_printed: 0,
          total_pages: 1
        }
      });
      expect(resDownload.statusCode).toBe(200);
      expect(resDownload.json().status).toBe('DOWNLOADING');

      // 2. PRINTING
      const resPrint = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'PRINTING',
          pages_printed: 1,
          total_pages: 1,
          spooler_job_id: 42
        }
      });
      expect(resPrint.statusCode).toBe(200);
      expect(resPrint.json().status).toBe('PRINTING');

      // 3. COMPLETED
      const resComplete = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'COMPLETED',
          pages_printed: 1,
          total_pages: 1
        }
      });
      expect(resComplete.statusCode).toBe(200);
      const completeBody = resComplete.json();
      expect(completeBody.status).toBe('COMPLETED');

      // Strict validation against job-status-update-response.schema.json
      const validation = validateContract(validators.validateJobStatusUpdateResponse, completeBody);
      expect(validation.errors).toBeUndefined();
      expect(validation.success).toBe(true);
    });

    it('accepts lowercase status enums and normalizes them', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'downloading',
          pages_printed: 0,
          total_pages: 1
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('DOWNLOADING');
    });

    it('validates lease_token, pages_printed, and total_pages', async () => {
      // Invalid lease_token (< 16 chars)
      const resBadToken = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: 'short-tok',
          status: 'PRINTING'
        }
      });
      expect(resBadToken.statusCode).toBe(400);

      // Invalid pages_printed (< 0)
      const resBadPages = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'PRINTING',
          pages_printed: -1
        }
      });
      expect(resBadPages.statusCode).toBe(400);

      // Invalid total_pages (< 1)
      const resBadTotal = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/jobs/status',
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          job_id: claimedJobId,
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'PRINTING',
          total_pages: 0
        }
      });
      expect(resBadTotal.statusCode).toBe(400);
    });

    it('resolves parameterized endpoint /api/v1/agent/jobs/:job_id/status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/agent/jobs/${claimedJobId}/status`,
        headers: { authorization: 'Bearer token-agent' },
        payload: {
          contract_version: '1.0.0',
          attempt_id: attemptId,
          lease_token: leaseToken,
          status: 'PRINTING',
          pages_printed: 1,
          total_pages: 1
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().job_id).toBe(claimedJobId);
      expect(res.json().status).toBe('PRINTING');
    });
  });

  describe('Step 5: OpenAPI v1 Specification & Fastify Synchronization', () => {
    it('declares all harmonized agent endpoints in OpenAPI v1', () => {
      const paths = openApiV1['paths'] as Record<string, unknown>;
      expect(paths).toBeDefined();
      expect(paths['/agent/pair']).toBeDefined();
      expect(paths['/agent/heartbeat']).toBeDefined();
      expect(paths['/agent/jobs/claim']).toBeDefined();
      expect(paths['/agent/jobs/{job_id}/status']).toBeDefined();
      expect(paths['/agent/jobs/status']).toBeDefined();
    });

    it('contains schemas for pair, claim, and status in OpenAPI components', () => {
      const components = openApiV1['components'] as Record<string, Record<string, unknown>>;
      const schemas = components['schemas'];
      expect(schemas).toBeDefined();
      expect(schemas!['PairAgentDeviceRequest']).toBeDefined();
      expect(schemas!['PairAgentDeviceResponse']).toBeDefined();
      expect(schemas!['AgentCapabilities']).toBeDefined();
      expect(schemas!['JobClaimRequest']).toBeDefined();
      expect(schemas!['JobClaimResponse']).toBeDefined();
      expect(schemas!['JobStatusUpdateRequest']).toBeDefined();
      expect(schemas!['JobStatusUpdateResponse']).toBeDefined();
    });
  });
});
