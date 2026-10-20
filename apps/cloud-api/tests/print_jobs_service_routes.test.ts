import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { createTestJwt, SupabaseJwtVerifier } from '../src/plugins/auth.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import { MockDocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { MockQuotesRepository } from '../src/modules/pricing/quotes.repository.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import type { FastifyInstance } from 'fastify';
import type { PricingConfig, UrgentSurchargeConfig } from '../src/modules/pricing/pricing.types.js';

describe('Cloud API — Print Job Service & State Machine Routes (P03-M02-F05)', () => {
  const jwtSecret = 'test-jwt-secret-for-print-jobs-domain-service-32-chars';
  const env = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
    SUPABASE_JWT_SECRET: jwtSecret
  });

  let app: FastifyInstance;
  let shopsRepo: MockShopsRepository;
  let printersRepo: MockPrintersRepository;
  let documentsRepo: MockDocumentsRepository;
  let quotesRepo: MockQuotesRepository;
  let jobsRepo: MockPrintJobsRepository;

  // Identity tokens
  const customer1Id = '11111111-1111-1111-1111-111111111111';
  const customer1Token = createTestJwt(
    { sub: customer1Id, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  const customer2Id = '22222222-2222-2222-2222-222222222222';
  const customer2Token = createTestJwt(
    { sub: customer2Id, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  const owner1Id = '33333333-3333-3333-3333-333333333333';
  const owner1Token = createTestJwt(
    { sub: owner1Id, role: 'shop_owner', app_metadata: { role: 'shop_owner' } },
    jwtSecret
  );

  const owner2Id = '44444444-4444-4444-4444-444444444444';
  const owner2Token = createTestJwt(
    { sub: owner2Id, role: 'shop_owner', app_metadata: { role: 'shop_owner' } },
    jwtSecret
  );

  const agentId = '55555555-5555-5555-5555-555555555555';
  const agentToken = createTestJwt(
    { sub: agentId, role: 'agent', app_metadata: { role: 'agent' } },
    jwtSecret
  );

  const adminId = '66666666-6666-6666-6666-666666666666';
  const adminToken = createTestJwt(
    { sub: adminId, role: 'admin', app_metadata: { role: 'admin' } },
    jwtSecret
  );

  // Default shop pricing config
  const standardPricingConfig: PricingConfig = {
    A4: {
      bw_single_paise: 200,
      bw_double_paise: 150,
      color_single_paise: 1000,
      color_double_paise: 800
    },
    A3: {
      bw_single_paise: 500,
      bw_double_paise: 400,
      color_single_paise: 2500,
      color_double_paise: 2000
    },
    Legal: {
      bw_single_paise: 300,
      bw_double_paise: 250,
      color_single_paise: 1500,
      color_double_paise: 1200
    },
    binding_prices_paise: {
      none: 0,
      spiral: 4000,
      staple: 500,
      lamination: 2000
    },
    gst_percentage: 18
  };

  const standardUrgentConfig: UrgentSurchargeConfig = {
    type: 'flat',
    amount: 3000,
    max_urgent_jobs_per_hour: 10
  };

  let shop1Id: string;
  let shop2Id: string;
  let closedShopId: string;
  let customer1DocId: string;
  let customer1QuoteId: string;

  beforeAll(async () => {
    shopsRepo = new MockShopsRepository();
    printersRepo = new MockPrintersRepository();
    documentsRepo = new MockDocumentsRepository();
    quotesRepo = new MockQuotesRepository();
    jobsRepo = new MockPrintJobsRepository();

    app = buildApp({
      env,
      tokenVerifier: new SupabaseJwtVerifier(jwtSecret),
      shopsRepo,
      printersRepo,
      documentsRepo,
      quotesRepo,
      jobsRepo
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    shopsRepo.clear();
    printersRepo.clear();
    documentsRepo.clear();
    quotesRepo.clear();
    jobsRepo.clear();

    // 1. Create Shop 1 owned by Owner 1
    const shop1 = await shopsRepo.create({
      owner_id: owner1Id,
      name: 'North Campus Print Hub',
      address: 'Science Block Gate 1',
      geo_lat: 18.5204,
      geo_lng: 73.8567,
      pricing_config: standardPricingConfig,
      urgent_surcharge_config: standardUrgentConfig
    });
    shop1Id = shop1.id;

    // 2. Create Shop 2 owned by Owner 2
    const shop2 = await shopsRepo.create({
      owner_id: owner2Id,
      name: 'South Campus Graphics',
      address: 'Arts Block Room 12',
      geo_lat: 18.5304,
      geo_lng: 73.8667,
      pricing_config: standardPricingConfig,
      urgent_surcharge_config: standardUrgentConfig
    });
    shop2Id = shop2.id;

    // 3. Create closed shop
    const closedShop = await shopsRepo.create({
      owner_id: owner1Id,
      name: 'Night Owl Prints',
      address: 'East Quad',
      geo_lat: 18.51,
      geo_lng: 73.82,
      pricing_config: standardPricingConfig,
      urgent_surcharge_config: standardUrgentConfig
    });
    await shopsRepo.update(closedShop.id, { status: 'closed' });
    closedShopId = closedShop.id;

    // 4. Create verified document for Customer 1
    const doc = await documentsRepo.create({
      customer_id: customer1Id,
      file_name: 'dissertation.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1024 * 50,
      page_count: 10,
      storage_key: `documents/${customer1Id}/dissertation.pdf`,
      status: 'ready',
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    });
    customer1DocId = doc.id;

    // 5. Create authoritative quote for Customer 1 at Shop 1
    const quote = await quotesRepo.create({
      customer_id: customer1Id,
      shop_id: shop1Id,
      document_id: customer1DocId,
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
      page_count: 10,
      pricing_snapshot: {
        pricing_config: standardPricingConfig,
        urgent_surcharge_config: standardUrgentConfig
      },
      price_breakdown: {
        base_pages_paise: 2000,
        color_surcharge_paise: 0,
        duplex_discount_paise: 0,
        binding_fee_paise: 0,
        urgent_surcharge_paise: 0,
        subtotal_paise: 2000,
        gst_paise: 360,
        total_paise: 2360
      },
      estimated_wait_minutes: 5,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: 'active'
    });
    customer1QuoteId = quote.id;
  });

  describe('1. Idempotent Print Job Creation (POST /api/v1/print-jobs)', () => {
    it('creates print job successfully from authoritative quote and verified document', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/print-jobs',
        headers: {
          authorization: `Bearer ${customer1Token}`
        },
        payload: {
          shop_id: shop1Id,
          quote_id: customer1QuoteId,
          document_id: customer1DocId
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.id).toBeDefined();
      expect(body.data.shop_id).toBe(shop1Id);
      expect(body.data.customer_id).toBe(customer1Id);
      expect(body.data.status).toBe('pending_payment');
      expect(body.data.price_total_paise).toBe(2360);
      expect(body.data.price_breakdown.total_paise).toBe(2360);
      expect(body.is_idempotent_replay).toBe(false);

      // Verify quote marked as consumed
      const consumedQuote = await quotesRepo.findById(customer1QuoteId);
      expect(consumedQuote?.status).toBe('consumed');
    });

    it('enforces idempotency: replayed request with same Idempotency-Key returns exact same job', async () => {
      const idempotencyKey = crypto.randomUUID();

      // First call
      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/print-jobs',
        headers: {
          authorization: `Bearer ${customer1Token}`,
          'idempotency-key': idempotencyKey
        },
        payload: {
          shop_id: shop1Id,
          quote_id: customer1QuoteId,
          document_id: customer1DocId
        }
      });

      expect(firstRes.statusCode).toBe(201);
      const firstJob = firstRes.json().data;
      expect(firstRes.json().is_idempotent_replay).toBe(false);

      // Replayed second call with identical idempotency key
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/v1/print-jobs',
        headers: {
          authorization: `Bearer ${customer1Token}`,
          'idempotency-key': idempotencyKey
        },
        payload: {
          shop_id: shop1Id,
          quote_id: customer1QuoteId,
          document_id: customer1DocId
        }
      });

      expect(secondRes.statusCode).toBe(200);
      const secondJob = secondRes.json().data;
      expect(secondRes.json().is_idempotent_replay).toBe(true);
      expect(secondJob.id).toBe(firstJob.id);
      expect(secondJob.price_total_paise).toBe(firstJob.price_total_paise);

      // Verify no duplicate jobs in repository
      const allJobs = await jobsRepo.findAll({ customer_id: customer1Id });
      expect(allJobs.total).toBe(1);
    });

    it('rejects job creation if shop is closed with 400 SHOP_CLOSED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/print-jobs',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          shop_id: closedShopId,
          document_storage_key: 'uploads/file.pdf',
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            orientation: 'portrait',
            copies: 1,
            page_range: 'all',
            binding: 'none'
          },
          priority_tier: 'flexible'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('SHOP_CLOSED');
    });

    it('rejects job creation with expired quote with 410 QUOTE_EXPIRED', async () => {
      // Fast-forward quote expiry
      await quotesRepo.update(customer1QuoteId, {
        expires_at: new Date(Date.now() - 60000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/print-jobs',
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          shop_id: shop1Id,
          quote_id: customer1QuoteId,
          document_id: customer1DocId
        }
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().error.code).toBe('QUOTE_EXPIRED');
    });

    it('rejects unauthenticated job creation request with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/print-jobs',
        payload: {
          shop_id: shop1Id,
          quote_id: customer1QuoteId
        }
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('2. Role-Scoped Reads & Tenant Isolation (GET /api/v1/print-jobs)', () => {
    let job1Shop1Customer1Id: string;
    let job2Shop2Customer2Id: string;

    beforeEach(async () => {
      // Job 1: Customer 1 at Shop 1
      const job1 = await jobsRepo.create({
        shop_id: shop1Id,
        customer_id: customer1Id,
        document_storage_key: 'documents/c1/doc1.pdf',
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
        price_total_paise: 2360,
        price_breakdown: {
          base_pages_paise: 2000,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 2000,
          gst_paise: 360,
          total_paise: 2360
        },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });
      job1Shop1Customer1Id = job1.id;

      // Job 2: Customer 2 at Shop 2
      const job2 = await jobsRepo.create({
        shop_id: shop2Id,
        customer_id: customer2Id,
        document_storage_key: 'documents/c2/doc2.pdf',
        settings: {
          paper_size: 'A4',
          color_mode: 'color',
          sides: 'double',
          orientation: 'portrait',
          copies: 2,
          page_range: 'all',
          binding: 'spiral'
        },
        priority_tier: 'urgent',
        price_total_paise: 11000,
        price_breakdown: {
          base_pages_paise: 4000,
          color_surcharge_paise: 2000,
          duplex_discount_paise: 500,
          binding_fee_paise: 2000,
          urgent_surcharge_paise: 1500,
          subtotal_paise: 9000,
          gst_paise: 2000,
          total_paise: 11000
        },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });
      job2Shop2Customer2Id = job2.id;
    });

    it('customer only sees their own jobs in list endpoint', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/print-jobs',
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(res.statusCode).toBe(200);
      const jobs = res.json().data;
      expect(jobs.length).toBe(1);
      expect(jobs[0].id).toBe(job1Shop1Customer1Id);
      expect(jobs[0].customer_id).toBe(customer1Id);
    });

    it('customer cannot read another customer print job by ID (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/print-jobs/${job2Shop2Customer2Id}`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('customer 2 can read their own job by ID (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/print-jobs/${job2Shop2Customer2Id}`,
        headers: { authorization: `Bearer ${customer2Token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(job2Shop2Customer2Id);
      expect(res.json().data.customer_id).toBe(customer2Id);
    });

    it('shop owner only sees jobs for shops they own', async () => {
      // Owner 1 owns Shop 1
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/print-jobs',
        headers: { authorization: `Bearer ${owner1Token}` }
      });

      expect(res.statusCode).toBe(200);
      const jobs = res.json().data;
      expect(jobs.length).toBe(1);
      expect(jobs[0].shop_id).toBe(shop1Id);
    });

    it('shop owner cannot read jobs for a shop they do not own (403 FORBIDDEN)', async () => {
      // Owner 1 tries to read Job 2 (which is at Shop 2 owned by Owner 2)
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/print-jobs/${job2Shop2Customer2Id}`,
        headers: { authorization: `Bearer ${owner1Token}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('admin can read all print jobs across shops and customers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/print-jobs',
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const jobs = res.json().data;
      expect(jobs.length).toBe(2);
    });
  });

  describe('3. Owner Confirmation & Approval (ADR 0004)', () => {
    let queuedJobId: string;

    beforeEach(async () => {
      const job = await jobsRepo.create({
        shop_id: shop1Id,
        customer_id: customer1Id,
        document_storage_key: 'documents/c1/approval.pdf',
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
        price_total_paise: 2360,
        price_breakdown: {
          base_pages_paise: 2000,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 2000,
          gst_paise: 360,
          total_paise: 2360
        },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });
      queuedJobId = job.id;
    });

    it('shop owner approves queued job and transitions status to approved', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/print-jobs/${queuedJobId}/approve`,
        headers: { authorization: `Bearer ${owner1Token}` }
      });

      expect(res.statusCode).toBe(200);
      const job = res.json().data;
      expect(job.status).toBe('approved');

      // Verify audit event logged
      const events = await jobsRepo.getEvents(queuedJobId);
      expect(events.length).toBe(1);
      expect(events[0].actor_type).toBe('owner');
      expect(events[0].to_status).toBe('approved');
    });

    it('rejects approval from non-owner shop owner with 403 FORBIDDEN', async () => {
      // Owner 2 tries to approve job at Shop 1
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/print-jobs/${queuedJobId}/approve`,
        headers: { authorization: `Bearer ${owner2Token}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('rejects approval from customer role with 403 FORBIDDEN_ROLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/print-jobs/${queuedJobId}/approve`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('4. State Machine Transition Graph & Illegal State Rejection', () => {
    let testJobId: string;

    beforeEach(async () => {
      const job = await jobsRepo.create({
        shop_id: shop1Id,
        customer_id: customer1Id,
        document_storage_key: 'documents/c1/statemachine.pdf',
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
        price_total_paise: 2360,
        price_breakdown: {
          base_pages_paise: 2000,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 2000,
          gst_paise: 360,
          total_paise: 2360
        },
        status: 'pending_payment',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });
      testJobId = job.id;
    });

    it('rejects illegal transition: pending_payment directly to completed (400 INVALID_STATE_TRANSITION)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'completed'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.json().error.message).toContain('Illegal print job state transition');
    });

    it('rejects illegal transition: queued directly to printing without approval and claim', async () => {
      // Transition to queued first
      await jobsRepo.update(testJobId, { status: 'queued' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'printing'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('rejects illegal transition: completed back to printing or approved (terminal state)', async () => {
      await jobsRepo.update(testJobId, { status: 'completed' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'printing'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('rejects illegal transition: cancelled back to queued (terminal state)', async () => {
      await jobsRepo.update(testJobId, { status: 'cancelled' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'queued'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('executes full valid linear lifecycle: pending_payment -> queued -> approved -> claimed -> printing -> completed', async () => {
      // 1. Payment verified -> queued
      const qRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'queued' }
      });
      expect(qRes.statusCode).toBe(200);
      expect(qRes.json().data.status).toBe('queued');

      // 2. Owner approval -> approved
      const appRes = await app.inject({
        method: 'POST',
        url: `/api/v1/print-jobs/${testJobId}/approve`,
        headers: { authorization: `Bearer ${owner1Token}` }
      });
      expect(appRes.statusCode).toBe(200);
      expect(appRes.json().data.status).toBe('approved');

      // 3. Agent claims job -> claimed
      const clRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${agentToken}` },
        payload: { status: 'claimed' }
      });
      expect(clRes.statusCode).toBe(200);
      expect(clRes.json().data.status).toBe('claimed');

      // 4. Agent starts printing -> printing
      const prRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${agentToken}` },
        payload: { status: 'printing' }
      });
      expect(prRes.statusCode).toBe(200);
      expect(prRes.json().data.status).toBe('printing');

      // 5. Printing completes -> completed
      const compRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${testJobId}/status`,
        headers: { authorization: `Bearer ${agentToken}` },
        payload: { status: 'completed' }
      });
      expect(compRes.statusCode).toBe(200);
      expect(compRes.json().data.status).toBe('completed');

      // Verify complete event audit trail
      const events = await jobsRepo.getEvents(testJobId);
      expect(events.length).toBe(5);
    });
  });

  describe('5. Job Cancellation Rules & Immutability', () => {
    it('customer can cancel job when pending_payment or queued', async () => {
      const job = await jobsRepo.create({
        shop_id: shop1Id,
        customer_id: customer1Id,
        document_storage_key: 'documents/c1/cancel.pdf',
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
        price_total_paise: 2360,
        price_breakdown: {
          base_pages_paise: 2000,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 2000,
          gst_paise: 360,
          total_paise: 2360
        },
        status: 'pending_payment',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/print-jobs/${job.id}/cancel`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: { reason: 'Changed my mind' }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('cancelled');
    });

    it('customer cannot cancel job once claimed or printing (400 CANNOT_CANCEL)', async () => {
      const job = await jobsRepo.create({
        shop_id: shop1Id,
        customer_id: customer1Id,
        document_storage_key: 'documents/c1/cancel.pdf',
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
        price_total_paise: 2360,
        price_breakdown: {
          base_pages_paise: 2000,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 2000,
          gst_paise: 360,
          total_paise: 2360
        },
        status: 'printing',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/print-jobs/${job.id}/cancel`,
        headers: { authorization: `Bearer ${customer1Token}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CANNOT_CANCEL');
    });

    it('customer settings are immutable after creation (PATCH returns 404 for modification attempts)', async () => {
      const job = await jobsRepo.create({
        shop_id: shop1Id,
        customer_id: customer1Id,
        document_storage_key: 'documents/c1/doc.pdf',
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
        price_total_paise: 2360,
        price_breakdown: {
          base_pages_paise: 2000,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 2000,
          gst_paise: 360,
          total_paise: 2360
        },
        status: 'pending_payment',
        document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      });

      // Attempting to patch settings on the job directly
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/print-jobs/${job.id}`,
        headers: { authorization: `Bearer ${customer1Token}` },
        payload: {
          settings: {
            color_mode: 'color'
          },
          price_total_paise: 100
        }
      });

      // No mutation route exists for modifying settings; settings are locked and immutable
      expect(patchRes.statusCode).toBe(404);
    });
  });

  describe('6. Readiness Check', () => {
    it('readiness check confirms operational database including jobs repository', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ready'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('ok');
    });
  });
});
