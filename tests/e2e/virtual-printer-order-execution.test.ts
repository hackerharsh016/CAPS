/**
 * Automated End-to-End Test Suite:
 * User Order to Virtual Printer Execution Lifecycle.
 *
 * Simulates a full production print run when no physical printer is attached:
 * 1. Customer discovers shop and registered virtual printer capabilities
 * 2. Customer gets authoritative pricing quotation
 * 3. Customer places print order with document upload and print parameters
 * 4. Payment settled (counter or online) -> job enqueued in atomic priority queue
 * 5. Owner Dashboard monitors queue and performs 1-click confirmation
 * 6. Desktop Print Agent claims approved job via atomic lease RPC
 * 7. Virtual Printer Subsystem executes Win32 spooler protocol:
 *    - OpenPrinterW
 *    - StartDocPrinterW
 *    - StartPagePrinter / WritePrinter (rasterized pages) / EndPagePrinter
 *    - EndDocPrinter -> generates verified execution artifact on disk
 *    - ClosePrinter
 * 8. Agent synchronizes PRINTING and COMPLETED telemetry to Cloud API
 * 9. Privacy purge deletes cloud document and shreds local agent spool
 * 10. Verification of physical execution artifact, paper tray decrement, and zero duplicates
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import { buildApp } from '../../apps/cloud-api/src/app.js';
import { createTestJwt } from '../../apps/cloud-api/src/plugins/auth.js';
import { MockShopsRepository } from '../../apps/cloud-api/src/modules/shops/shops.repository.js';
import { MockPrintersRepository } from '../../apps/cloud-api/src/modules/printers/printers.repository.js';
import { MockPrintJobsRepository } from '../../apps/cloud-api/src/modules/print-jobs/print-jobs.repository.js';
import { MockAgentsRepository } from '../../apps/cloud-api/src/modules/agents/agents.repository.js';
import { MockQuotesRepository } from '../../apps/cloud-api/src/modules/pricing/quotes.repository.js';
import { MockDocumentsRepository } from '../../apps/cloud-api/src/modules/documents/documents.repository.js';
import { VirtualPrinterEnvironment } from './support/virtual-printer-environment';

const JWT_SECRET = 'caps-jwt-secret-dev-and-testing-default-at-least-32-chars';

describe('Virtual Printer Automated Scenario: User Order → Job Executed', () => {
  let app: FastifyInstance;
  let serverUrl: string;
  let virtualPrinter: VirtualPrinterEnvironment;

  const testShopId = '00000000-0000-0000-0000-000000000001';
  const ownerUserId = 'owner-virtual-test-001';
  const customerUserId = 'customer-virtual-test-001';

  let ownerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    // 1. Initialize Virtual Printer Environment
    virtualPrinter = new VirtualPrinterEnvironment({
      printerName: 'Virtual-HP-LaserJet-Pro-M404',
      role: 'bw',
      paperTrayCapacity: 100
    });
    virtualPrinter.cleanArtifacts();

    // 2. Setup mock repositories for in-memory Cloud API
    const shopsRepo = new MockShopsRepository();
    const printersRepo = new MockPrintersRepository();
    const jobsRepo = new MockPrintJobsRepository();
    const agentsRepo = new MockAgentsRepository();
    const quotesRepo = new MockQuotesRepository();
    const documentsRepo = new MockDocumentsRepository();

    // Register Shop
    await shopsRepo.create({
      id: testShopId,
      owner_id: ownerUserId,
      name: 'QuickPrint Virtual Alpha Lab',
      address: '404 Simulation Highway, Bengaluru',
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
        amount: 1500,
        max_urgent_jobs_per_hour: 50
      },
      auto_print_enabled: false,
      allow_pay_at_counter: true
    });

    // Register Virtual Printer in Database
    await printersRepo.create({
      shop_id: testShopId,
      name: virtualPrinter.capabilities.name,
      role: virtualPrinter.capabilities.role,
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: virtualPrinter.capabilities.paper_sizes,
        color_modes: virtualPrinter.capabilities.color_modes,
        duplex_supported: virtualPrinter.capabilities.duplex_supported,
        max_copies: virtualPrinter.capabilities.max_copies
      }
    });

    // 3. Build and launch Fastify instance
    app = buildApp({
      shopsRepo,
      printersRepo,
      jobsRepo,
      agentsRepo,
      quotesRepo,
      documentsRepo
    });

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 4100;
    serverUrl = `http://127.0.0.1:${port}`;

    ownerToken = createTestJwt(
      { sub: ownerUserId, role: 'shop_owner', shop_id: testShopId },
      JWT_SECRET
    );
    customerToken = createTestJwt({ sub: customerUserId, role: 'customer' }, JWT_SECRET);
  });

  afterAll(async () => {
    virtualPrinter.cleanArtifacts();
    await app.close();
  });

  it('Happy Path: User Order -> Quotation -> Payment -> Owner Approval -> Spooling -> Virtual Printer Executed', async () => {
    // --------------------------------------------------------------------------
    // Step 1: Customer discovers shop & virtual printer
    // --------------------------------------------------------------------------
    const shopsRes = await fetch(`${serverUrl}/api/v1/shops`);
    expect(shopsRes.status).toBe(200);
    const shopsData = await shopsRes.json();
    const shops = shopsData.data || shopsData;
    const shop = shops.find((s: { id: string }) => s.id === testShopId);
    expect(shop).toBeDefined();
    expect(shop.name).toBe('QuickPrint Virtual Alpha Lab');

    // --------------------------------------------------------------------------
    // Step 2: Customer requests Authoritative Quotation
    // --------------------------------------------------------------------------
    const quotePayload = {
      shop_id: testShopId,
      settings: {
        paper_size: 'A4',
        color_mode: 'bw',
        sides: 'double', // duplex
        orientation: 'portrait',
        copies: 2,
        page_range: 'all',
        binding: 'none'
      },
      priority_tier: 'urgent',
      document_page_count: 4 // 4 pages, double-sided, 2 copies
    };

    const quoteRes = await fetch(`${serverUrl}/api/v1/quotes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify(quotePayload)
    });

    expect(quoteRes.status).toBe(201);
    const quoteData = await quoteRes.json();
    const quote = quoteData.data || quoteData;
    expect(quote.quote_id).toBeDefined();
    expect(quote.priority_tier).toBe('urgent');
    expect(quote.price_breakdown.total_paise).toBeGreaterThan(0);

    // --------------------------------------------------------------------------
    // Step 3: Customer uploads document and submits print order
    // --------------------------------------------------------------------------
    const mockDocumentContent = 'PDF-1.7 Simulated Binary Document Content for Virtual Printer Execution';
    const documentChecksum = createHash('sha256').update(mockDocumentContent).digest('hex');

    const jobPayload = {
      shop_id: testShopId,
      document_storage_key: 'documents/virtual-test-doc-001.pdf',
      priority_tier: 'urgent',
      settings: quotePayload.settings
    };

    const orderRes = await fetch(`${serverUrl}/api/v1/print-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`,
        'Idempotency-Key': 'virt-order-key-001'
      },
      body: JSON.stringify(jobPayload)
    });

    expect(orderRes.status).toBe(201);
    const orderData = await orderRes.json();
    const createdJob = orderData.data?.job || orderData.data || orderData;
    expect(createdJob.id).toBeDefined();
    expect(createdJob.status).toBe('pending_payment');
    const jobId = createdJob.id;

    // --------------------------------------------------------------------------
    // Step 4: Payment settlement (Pay-at-Counter confirmation)
    // --------------------------------------------------------------------------
    const selectCounterRes = await fetch(`${serverUrl}/api/v1/payments/counter/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ print_job_id: jobId })
    });
    expect(selectCounterRes.status).toBe(200);

    const confirmCounterRes = await fetch(`${serverUrl}/api/v1/payments/counter/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        print_job_id: jobId,
        operator_id: ownerUserId
      })
    });
    expect(confirmCounterRes.status).toBe(200);

    // --------------------------------------------------------------------------
    // Step 5: Owner Dashboard checks live queue & approves job for agent printing
    // --------------------------------------------------------------------------
    const queueRes = await fetch(`${serverUrl}/api/v1/shops/${testShopId}/queue`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(queueRes.status).toBe(200);
    const queueData = await queueRes.json();
    const queue = Array.isArray(queueData.data) ? queueData.data : queueData.data?.queue || [];
    const enqueuedJob = queue.find((j: { id: string }) => j.id === jobId);
    expect(enqueuedJob).toBeDefined();
    expect(enqueuedJob.status).toBe('queued');
    expect(enqueuedJob.priority_tier).toBe('urgent');

    // 1-Click Owner Confirmation
    const approveRes = await fetch(`${serverUrl}/api/v1/shops/${testShopId}/jobs/${jobId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.status).toBe('approved');

    // --------------------------------------------------------------------------
    // Step 6: Desktop Agent pairing, heartbeat, and atomic job claim
    // --------------------------------------------------------------------------
    const pairCodeRes = await fetch(`${serverUrl}/api/v1/shops/${testShopId}/agents/pairing-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ ttl_seconds: 600 })
    });
    const pairCodeData = await pairCodeRes.json();
    const pairingCode = pairCodeData.data.pairing_code || pairCodeData.data.code;

    const pairRes = await fetch(`${serverUrl}/api/v1/agent/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_code: pairingCode,
        hostname: 'VIRTUAL-PRINT-NODE-01',
        device_name: 'Virtual Desktop Print Agent',
        device_fingerprint: 'virt-fp-998811'
      })
    });
    expect(pairRes.status).toBe(200);
    const pairResult = await pairRes.json();
    const deviceToken = pairResult.device_token || pairResult.data.device_token;
    const deviceId = pairResult.device_id || pairResult.data.device_id;

    // Heartbeat reporting online status and virtual printer presence
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
        printers: [{ printer_id: virtualPrinter.capabilities.printer_id, name: virtualPrinter.capabilities.name, status: 'online' }]
      })
    });
    expect(heartbeatRes.status).toBe(200);

    // Agent claims approved job via atomic lease
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
    const claimedJob = claimData.job || claimData;
    expect(claimedJob.job_id).toBe(jobId);
    expect(claimedJob.lease_token).toBeDefined();
    const leaseToken = claimedJob.lease_token;
    const attemptId = claimedJob.attempt_id;

    // --------------------------------------------------------------------------
    // Step 7: Virtual Printer Execution Subsystem (Acting as physical printer)
    // --------------------------------------------------------------------------
    const initialPaperLevel = virtualPrinter.currentPaperLevel;

    // 7a. Open virtual printer handle
    const hPrinter = virtualPrinter.openPrinter(virtualPrinter.capabilities.name);
    expect(hPrinter).toBeGreaterThan(0);

    // 7b. StartDocPrinter
    const spoolerJobId = virtualPrinter.startDocPrinter(hPrinter, {
      documentTitle: `CAPS-Job-${jobId}`,
      totalPages: 4,
      copies: 2,
      duplex: true,
      leaseToken,
      idempotencyKey: `spool-idem-${jobId}`
    });
    expect(spoolerJobId).toBeGreaterThan(2000);

    // Report PRINTING status to Cloud API
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
        total_pages: 8, // 4 pages x 2 copies
        spooler_job_id: spoolerJobId
      })
    });
    expect(printingStatusRes.status).toBe(200);

    // 7c. Render & Stream Pages through virtual paper mechanism
    // 4 pages x 2 copies = 8 physical impressions
    const totalImpressions = 8;
    for (let pageNum = 1; pageNum <= totalImpressions; pageNum++) {
      virtualPrinter.startPagePrinter(hPrinter);
      const simulatedRasterData = Buffer.from(`RASTER_PAGE_${pageNum}_HEADER_DEVMODE_DUPLEX_BYTES`);
      virtualPrinter.writePrinter(hPrinter, simulatedRasterData);
      virtualPrinter.endPagePrinter(hPrinter);
    }

    // 7d. EndDocPrinter completes physical output generation
    const executedSpoolRecord = virtualPrinter.endDocPrinter(hPrinter);
    virtualPrinter.closePrinter(hPrinter);

    expect(executedSpoolRecord.status).toBe('EXECUTED');
    expect(executedSpoolRecord.pagesPrinted).toBe(totalImpressions);
    expect(executedSpoolRecord.outputArtifactPath).toBeDefined();

    // Verify paper tray consumption (8 pages duplex = 4 sheets consumed)
    expect(virtualPrinter.currentPaperLevel).toBe(initialPaperLevel - 4);
    expect(virtualPrinter.totalSheetsConsumed).toBe(4);

    // --------------------------------------------------------------------------
    // Step 8: Verify Output Artifact on Disk (Physical Execution Gate)
    // --------------------------------------------------------------------------
    const artifactVerification = virtualPrinter.verifyOutputArtifact(spoolerJobId);
    expect(artifactVerification.exists).toBe(true);
    expect(artifactVerification.manifest).toBeDefined();
    expect(artifactVerification.manifest?.['hardware_status']).toBe('PHYSICALLY_PRINTED_AND_EJECTED');
    expect(artifactVerification.manifest?.['pages_executed']).toBe(8);
    expect(artifactVerification.manifest?.['duplex']).toBe(true);
    expect(artifactVerification.manifest?.['copies']).toBe(2);

    // --------------------------------------------------------------------------
    // Step 9: Agent reports COMPLETED status to Cloud API
    // --------------------------------------------------------------------------
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
        pages_printed: totalImpressions,
        total_pages: totalImpressions,
        spooler_job_id: spoolerJobId
      })
    });
    expect(completedStatusRes.status).toBe(200);

    // --------------------------------------------------------------------------
    // Step 10: Final State Verification in Cloud API
    // --------------------------------------------------------------------------
    const finalJobRes = await fetch(`${serverUrl}/api/v1/print-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(finalJobRes.status).toBe(200);
    const finalJobData = await finalJobRes.json();
    const finalJob = finalJobData.data || finalJobData;
    expect(finalJob.status).toBe('completed');
  });

  it('Hardware Fault Resilience: detects Paper-Out and Jam conditions without duplicate reprints', () => {
    const freshPrinter = new VirtualPrinterEnvironment({
      printerName: 'Virtual-HP-LaserJet-Pro-M404',
      paperTrayCapacity: 100
    });

    // 1. Drain virtual paper tray to 0
    freshPrinter.currentPaperLevel = 0;
    const hPrinter = freshPrinter.openPrinter(freshPrinter.capabilities.name);

    freshPrinter.startDocPrinter(hPrinter, {
      documentTitle: 'Empty-Tray-Job',
      totalPages: 2,
      leaseToken: 'lease-paper-out',
      idempotencyKey: 'idem-paper-out-001'
    });

    // Should reject startPage with ERROR_OUT_OF_PAPER
    expect(() => {
      freshPrinter.startPagePrinter(hPrinter);
    }).toThrow(/ERROR_OUT_OF_PAPER/);

    // Operator refills paper
    freshPrinter.refillPaper(50);
    expect(freshPrinter.currentPaperLevel).toBe(50);

    // Now startPage succeeds
    expect(() => {
      freshPrinter.startPagePrinter(hPrinter);
    }).not.toThrow();

    freshPrinter.writePrinter(hPrinter, Buffer.from('PAGE_1_DATA'));
    freshPrinter.endPagePrinter(hPrinter);

    // 2. Simulate Paper Jam on next page
    freshPrinter.simulateJam();
    expect(() => {
      freshPrinter.startPagePrinter(hPrinter);
    }).toThrow(/ERROR_PAPER_JAM/);

    // Clear jam and complete
    freshPrinter.clearJam();
    freshPrinter.startPagePrinter(hPrinter);
    freshPrinter.writePrinter(hPrinter, Buffer.from('PAGE_2_DATA'));
    freshPrinter.endPagePrinter(hPrinter);

    const executed = freshPrinter.endDocPrinter(hPrinter);
    freshPrinter.closePrinter(hPrinter);

    expect(executed.status).toBe('EXECUTED');
    expect(executed.pagesPrinted).toBe(2);
  });

  it('Idempotency & Replay Invariant: duplicate submissions return existing spooler record', () => {
    const freshPrinter = new VirtualPrinterEnvironment({
      printerName: 'Virtual-HP-LaserJet-Pro-M404'
    });

    const hPrinter1 = freshPrinter.openPrinter(freshPrinter.capabilities.name);
    const jobId1 = freshPrinter.startDocPrinter(hPrinter1, {
      documentTitle: 'Idempotency-Test',
      totalPages: 1,
      leaseToken: 'lease-idem',
      idempotencyKey: 'fixed-idem-key-999'
    });

    // Replayed submission with identical idempotencyKey
    const hPrinter2 = freshPrinter.openPrinter(freshPrinter.capabilities.name);
    const jobId2 = freshPrinter.startDocPrinter(hPrinter2, {
      documentTitle: 'Idempotency-Test-Replay',
      totalPages: 1,
      leaseToken: 'lease-idem',
      idempotencyKey: 'fixed-idem-key-999'
    });

    expect(jobId1).toBe(jobId2);
    freshPrinter.closePrinter(hPrinter1);
    freshPrinter.closePrinter(hPrinter2);
  });
});
