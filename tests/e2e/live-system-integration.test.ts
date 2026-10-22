/**
 * Live Cross-Track System Integration Test Suite
 *
 * Validates the complete live synchronization between:
 * 1. Customer Web (Shops discovery, Quote generation, Order checkout)
 * 2. Cloud API (Composite JWT & Agent Secret auth, Priority Queue RPCs, Fastify endpoints)
 * 3. Shop Owner Dashboard (Live Queue intake, One-click Print Approval)
 * 4. Desktop Print Agent (Enrollment, Heartbeat, Atomic Claim with Lease, Status Synchronization)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/cloud-api/src/app.js';
import { createTestJwt } from '../../apps/cloud-api/src/plugins/auth.js';
import { MockShopsRepository } from '../../apps/cloud-api/src/modules/shops/shops.repository.js';
import { MockPrintersRepository } from '../../apps/cloud-api/src/modules/printers/printers.repository.js';
import { MockPrintJobsRepository } from '../../apps/cloud-api/src/modules/print-jobs/print-jobs.repository.js';
import { MockAgentsRepository } from '../../apps/cloud-api/src/modules/agents/agents.repository.js';
import { MockQuotesRepository } from '../../apps/cloud-api/src/modules/pricing/quotes.repository.js';
import { MockDocumentsRepository } from '../../apps/cloud-api/src/modules/documents/documents.repository.js';

const JWT_SECRET = 'caps-jwt-secret-dev-and-testing-default-at-least-32-chars';

describe('CAPS Live Cross-Track System Integration', () => {
  let app: FastifyInstance;
  let serverUrl: string;

  const testShopId = '00000000-0000-0000-0000-000000000001';
  const ownerUserId = 'owner-user-001';
  const customerUserId = 'customer-user-001';

  let ownerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    // Seed initial shop and printer into repositories
    const shopsRepo = new MockShopsRepository();
    const printersRepo = new MockPrintersRepository();
    const jobsRepo = new MockPrintJobsRepository();
    const agentsRepo = new MockAgentsRepository();
    const quotesRepo = new MockQuotesRepository();
    const documentsRepo = new MockDocumentsRepository();

    await shopsRepo.create({
      id: testShopId,
      owner_id: ownerUserId,
      name: 'QuickPrint Live Alpha',
      address: '100 University Road, Bengaluru',
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
          bw_double_paise: 800,
          color_single_paise: 2000,
          color_double_paise: 3500
        },
        Legal: {
          bw_single_paise: 300,
          bw_double_paise: 500,
          color_single_paise: 1200,
          color_double_paise: 2000
        },
        binding_prices_paise: {
          none: 0,
          spiral: 3500,
          staple: 500,
          lamination: 2000
        },
        gst_percentage: 18
      },
      urgent_surcharge_config: {
        type: 'flat',
        amount: 2000,
        max_urgent_jobs_per_hour: 30
      },
      auto_print_enabled: false,
      allow_pay_at_counter: true
    });

    await printersRepo.create({
      shop_id: testShopId,
      name: 'Canon imageRUNNER 2625 PCL6',
      role: 'bw',
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: ['A4', 'A3'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 99
      }
    });

    app = buildApp({
      shopsRepo,
      printersRepo,
      jobsRepo,
      agentsRepo,
      quotesRepo,
      documentsRepo
    });

    // Start Fastify server on dynamic loopback port
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 4000;
    serverUrl = `http://127.0.0.1:${port}`;

    // Configure test environment variable for clients
    process.env['NEXT_PUBLIC_API_URL'] = serverUrl;

    ownerToken = createTestJwt(
      { sub: ownerUserId, role: 'shop_owner', shop_id: testShopId },
      JWT_SECRET
    );

    customerToken = createTestJwt({ sub: customerUserId, role: 'customer' }, JWT_SECRET);
  });

  afterAll(async () => {
    delete process.env['NEXT_PUBLIC_API_URL'];
    await app.close();
  });

  it('Step 1: Customer Web discovers live shops from Cloud API', async () => {
    const res = await fetch(`${serverUrl}/api/v1/shops`);
    expect(res.status).toBe(200);

    const data = await res.json();
    const shops = data.data || data;
    expect(Array.isArray(shops)).toBe(true);
    expect(shops.length).toBeGreaterThanOrEqual(1);

    const alpha = shops.find((s: { id: string }) => s.id === testShopId);
    expect(alpha).toBeDefined();
    expect(alpha.name).toBe('QuickPrint Live Alpha');
  });

  it('Step 2: Customer Web calculates authoritative pricing quote via Cloud API', async () => {
    const quotePayload = {
      shop_id: testShopId,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'single',
        orientation: 'portrait',
        copies: 2,
        page_range: 'all',
        binding: 'none'
      },
      priority_tier: 'urgent',
      document_page_count: 5
    };

    const res = await fetch(`${serverUrl}/api/v1/quotes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify(quotePayload)
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    const quote = data.data || data;

    expect(quote.quote_id).toBeDefined();
    expect(quote.shop_id).toBe(testShopId);
    expect(quote.priority_tier).toBe('urgent');
    expect(quote.price_breakdown.total_paise).toBeGreaterThan(0);
  });

  it('Step 3: Customer Web creates live print job and submits order', async () => {
    const jobPayload = {
      shop_id: testShopId,
      document_storage_key: 'documents/live-test-doc-001.pdf',
      priority_tier: 'urgent',
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'single',
        orientation: 'portrait',
        copies: 2,
        page_range: 'all',
        binding: 'none'
      }
    };

    const res = await fetch(`${serverUrl}/api/v1/print-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
        'Idempotency-Key': 'live-test-order-key-001'
      },
      body: JSON.stringify(jobPayload)
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    const job = data.data?.job || data.data || data;

    expect(job.id).toBeDefined();
    expect(job.shop_id).toBe(testShopId);
    expect(job.status).toBe('pending_payment');

    // Customer selects Pay-at-Counter
    const selectRes = await fetch(`${serverUrl}/api/v1/payments/counter/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ print_job_id: job.id })
    });
    expect(selectRes.status).toBe(200);

    // Shop Owner confirms cash settlement, enqueuing job for printing
    const confirmRes = await fetch(`${serverUrl}/api/v1/payments/counter/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        print_job_id: job.id,
        operator_id: ownerUserId
      })
    });
    expect(confirmRes.status).toBe(200);
  });

  it('Step 4: Owner Dashboard queries live queue and verifies enqueued job', async () => {
    const res = await fetch(`${serverUrl}/api/v1/shops/${testShopId}/queue`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ownerToken}`
      }
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    const queue = Array.isArray(data.data) ? data.data : data.data?.queue || data.queue || [];

    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBeGreaterThanOrEqual(1);

    const targetJob = queue[0];
    expect(targetJob.shop_id).toBe(testShopId);
    expect(targetJob.status).toBe('queued');
    expect(targetJob.priority_tier).toBe('urgent');
  });

  it('Step 5: Owner Dashboard performs 1-click confirmation to approve job for agent printing', async () => {
    // Fetch queue to get job ID
    const queueRes = await fetch(`${serverUrl}/api/v1/shops/${testShopId}/queue`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    const queueData = await queueRes.json();
    const queue = Array.isArray(queueData.data)
      ? queueData.data
      : queueData.data?.queue || queueData.queue || [];
    const targetJob = queue[0];
    expect(targetJob).toBeDefined();

    const approveRes = await fetch(
      `${serverUrl}/api/v1/shops/${testShopId}/jobs/${targetJob.id}/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`
        }
      }
    );

    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.status).toBe('approved');
  });

  it('Step 6: Desktop Print Agent pairs, heartbeats, claims approved job, and reports status updates', async () => {
    // 6a. Generate pairing code from Owner Dashboard
    const pairCodeRes = await fetch(`${serverUrl}/api/v1/shops/${testShopId}/agents/pairing-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ ttl_seconds: 600 })
    });
    expect(pairCodeRes.status).toBe(200);
    const pairCodeData = await pairCodeRes.json();
    const pairingCode = pairCodeData.data.pairing_code || pairCodeData.data.code;

    // 6b. Agent executes pairing handshake via /api/v1/agent/pair
    const pairRes = await fetch(`${serverUrl}/api/v1/agent/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_code: pairingCode,
        hostname: 'DESKTOP-PRINT-01',
        device_name: 'Windows Print Agent',
        device_fingerprint: 'win-fp-104928'
      })
    });
    expect(pairRes.status).toBe(200);
    const pairResult = await pairRes.json();
    const deviceToken = pairResult.device_token || pairResult.data.device_token;
    const deviceId = pairResult.device_id || pairResult.data.device_id;
    expect(deviceToken).toMatch(/^caps_agent_sec_/);

    // 6c. Agent sends heartbeat telemetry via /api/v1/agent/heartbeat with device token auth
    const heartbeatRes = await fetch(`${serverUrl}/api/v1/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        agent_id: deviceId,
        shop_id: testShopId,
        status: 'online',
        printers: [{ printer_id: 'p1', name: 'Canon imageRUNNER', status: 'online' }]
      })
    });
    expect(heartbeatRes.status).toBe(200);

    // 6d. Agent claims next approved job via /api/v1/agent/jobs/claim
    const claimRes = await fetch(`${serverUrl}/api/v1/agent/jobs/claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        agent_device_id: deviceId,
        shop_id: testShopId,
        lease_duration_seconds: 120
      })
    });
    expect(claimRes.status).toBe(200);
    const claimData = await claimRes.json();

    // Verify both nested OpenAPI contract and flat root compatibility
    const claimedJob = claimData.job || claimData;
    expect(claimedJob.job_id).toBeDefined();
    expect(claimedJob.lease_token).toBeDefined();
    expect(claimedJob.attempt_id).toBeDefined();

    const jobId = claimedJob.job_id;
    const attemptId = claimedJob.attempt_id;
    const leaseToken = claimedJob.lease_token;

    // 6e. Agent reports PRINTING status via /api/v1/agent/jobs/status
    const printingStatusRes = await fetch(`${serverUrl}/api/v1/agent/jobs/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        contract_version: '1.0.0',
        job_id: jobId,
        attempt_id: attemptId,
        lease_token: leaseToken,
        status: 'PRINTING',
        pages_printed: 1,
        total_pages: 5,
        spooler_job_id: 1042
      })
    });
    expect(printingStatusRes.status).toBe(200);

    // 6f. Agent reports COMPLETED status
    const completedStatusRes = await fetch(`${serverUrl}/api/v1/agent/jobs/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        contract_version: '1.0.0',
        job_id: jobId,
        attempt_id: attemptId,
        lease_token: leaseToken,
        status: 'COMPLETED',
        pages_printed: 5,
        total_pages: 5,
        spooler_job_id: 1042
      })
    });
    expect(completedStatusRes.status).toBe(200);

    // 6g. Verify final state in Cloud API
    const finalJobRes = await fetch(`${serverUrl}/api/v1/print-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(finalJobRes.status).toBe(200);
    const finalJobData = await finalJobRes.json();
    const finalJob = finalJobData.data || finalJobData;
    expect(finalJob.status).toBe('completed');
  });
});
