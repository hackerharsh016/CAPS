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
import {
  sortQueueJobs,
  projectQueueSchedule,
  evaluateUrgentCapAndFairness
} from '../src/modules/queue/queue.calculator.js';
import type { ITokenVerifier, AuthUser } from '../src/plugins/auth.js';
import type { PrintJobRecord } from '../src/modules/print-jobs/print-jobs.types.js';

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

describe('Atomic Priority Queue Ordering & Concurrency Controls', () => {
  let app: FastifyInstance;
  let tokenVerifier: TestTokenVerifier;
  let shopsRepo: MockShopsRepository;
  let printersRepo: MockPrintersRepository;
  let jobsRepo: MockPrintJobsRepository;
  let docsRepo: MockDocumentsRepository;
  let storageService: MockStorageService;
  let quotesRepo: MockQuotesRepository;
  let queueService: QueueService;

  const OWNER_USER: AuthUser = {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'owner@xerox.com',
    role: 'shop_owner'
  };

  const CUSTOMER_1: AuthUser = {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'student1@university.edu',
    role: 'customer'
  };

  const CUSTOMER_2: AuthUser = {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'student2@university.edu',
    role: 'customer'
  };

  const AGENT_USER: AuthUser = {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'agent@agent.caps.local',
    role: 'agent'
  };

  let shopId: string;
  let printer1Id: string;
  let printer2Id: string;

  beforeEach(async () => {
    tokenVerifier = new TestTokenVerifier();
    tokenVerifier.registerUser('token-owner', OWNER_USER);
    tokenVerifier.registerUser('token-cust-1', CUSTOMER_1);
    tokenVerifier.registerUser('token-cust-2', CUSTOMER_2);
    tokenVerifier.registerUser('token-agent', AGENT_USER);

    shopsRepo = new MockShopsRepository();
    printersRepo = new MockPrintersRepository();
    jobsRepo = new MockPrintJobsRepository();
    docsRepo = new MockDocumentsRepository();
    storageService = new MockStorageService();
    quotesRepo = new MockQuotesRepository();

    queueService = new QueueService(jobsRepo, shopsRepo, printersRepo);

    app = buildApp({
      tokenVerifier,
      shopsRepo,
      printersRepo,
      jobsRepo,
      documentsRepo: docsRepo,
      storageService,
      quotesRepo,
      queueService
    });

    await app.ready();

    // Create test shop
    const shop = await shopsRepo.create({
      owner_id: OWNER_USER.id,
      name: 'Campus Fast Print',
      address: 'Student Center, Building B',
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
        binding_prices_paise: {
          none: 0,
          spiral: 3000,
          staple: 500,
          lamination: 2000
        },
        gst_percentage: 18
      },
      urgent_surcharge_config: {
        type: 'flat',
        amount: 2500,
        max_urgent_jobs_per_hour: 10,
        max_urgent_jobs_in_queue: 5,
        fairness_guard_enabled: true,
        max_flexible_wait_threshold_seconds: 1800
      },
      auto_print_enabled: true
    });
    shopId = shop.id;

    // Create test printers
    const p1 = await printersRepo.create({
      shop_id: shopId,
      name: 'HP LaserJet Pro MFP',
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
    printer1Id = p1.id;

    const p2 = await printersRepo.create({
      shop_id: shopId,
      name: 'Canon Color imageRUNNER',
      role: 'color',
      status: 'online',
      is_default: false,
      capabilities: {
        paper_sizes: ['A4', 'A3'],
        color_modes: ['bw', 'color'],
        duplex_supported: true,
        max_copies: 50
      }
    });
    printer2Id = p2.id;
  });

  afterEach(async () => {
    await app.close();
  });

  // ============================================================================
  // 1. Two-Tier Queue Discipline & Ordering Invariants
  // ============================================================================

  describe('Queue Comparator & Ordering Invariants', () => {
    it('orders Urgent tier ahead of Flexible tier regardless of submission timestamp', () => {
      const flexibleJobEarly: PrintJobRecord = {
        id: '10000000-0000-0000-0000-000000000001',
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'doc1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
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
        enqueued_at: '2026-10-20T10:00:00.000Z',
        document_expires_at: '2026-10-21T10:00:00.000Z',
        created_at: '2026-10-20T10:00:00.000Z',
        updated_at: '2026-10-20T10:00:00.000Z'
      };

      const urgentJobLate: PrintJobRecord = {
        id: '20000000-0000-0000-0000-000000000002',
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        document_storage_key: 'doc2.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:15:00.000Z', // 15 mins later
        document_expires_at: '2026-10-21T10:15:00.000Z',
        created_at: '2026-10-20T10:15:00.000Z',
        updated_at: '2026-10-20T10:15:00.000Z'
      };

      const sorted = sortQueueJobs([flexibleJobEarly, urgentJobLate]);
      expect(sorted[0]!.id).toBe(urgentJobLate.id);
      expect(sorted[1]!.id).toBe(flexibleJobEarly.id);
    });

    it('enforces strict FIFO ordering within the same priority tier', () => {
      const urgent1: PrintJobRecord = {
        id: '11111111-0000-0000-0000-000000000001',
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'doc1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:00:00.000Z',
        document_expires_at: '2026-10-21T10:00:00.000Z',
        created_at: '2026-10-20T10:00:00.000Z',
        updated_at: '2026-10-20T10:00:00.000Z'
      };

      const urgent2: PrintJobRecord = {
        id: '22222222-0000-0000-0000-000000000002',
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        document_storage_key: 'doc2.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:05:00.000Z',
        document_expires_at: '2026-10-21T10:05:00.000Z',
        created_at: '2026-10-20T10:05:00.000Z',
        updated_at: '2026-10-20T10:05:00.000Z'
      };

      const sorted = sortQueueJobs([urgent2, urgent1]);
      expect(sorted[0]!.id).toBe(urgent1.id);
      expect(sorted[1]!.id).toBe(urgent2.id);
    });

    it('uses deterministic ID tie-breaking when enqueued_at timestamps are identical', () => {
      const sameTimestamp = '2026-10-20T10:00:00.000Z';
      const jobA: PrintJobRecord = {
        id: 'aaaaaa-0000-0000-0000-000000000000',
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'docA.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: sameTimestamp,
        document_expires_at: '2026-10-21T10:00:00.000Z',
        created_at: sameTimestamp,
        updated_at: sameTimestamp
      };

      const jobZ: PrintJobRecord = {
        id: 'zzzzzz-0000-0000-0000-000000000000',
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        document_storage_key: 'docZ.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: sameTimestamp,
        document_expires_at: '2026-10-21T10:00:00.000Z',
        created_at: sameTimestamp,
        updated_at: sameTimestamp
      };

      const sorted1 = sortQueueJobs([jobZ, jobA]);
      expect(sorted1[0]!.id).toBe(jobA.id);
      expect(sorted1[1]!.id).toBe(jobZ.id);

      const sorted2 = sortQueueJobs([jobA, jobZ]);
      expect(sorted2[0]!.id).toBe(jobA.id);
      expect(sorted2[1]!.id).toBe(jobZ.id);
    });

    it('guarantees non-preemption: actively printing or claimed job is never displaced by incoming Urgent job', () => {
      const activePrintJob: PrintJobRecord = {
        id: 'active-printing-job',
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'printing.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'flexible', // flexible job already printing
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
        status: 'printing', // in physical/local print execution
        claimed_at: '2026-10-20T10:00:00.000Z',
        enqueued_at: '2026-10-20T09:50:00.000Z',
        document_expires_at: '2026-10-21T10:00:00.000Z',
        created_at: '2026-10-20T09:50:00.000Z',
        updated_at: '2026-10-20T10:00:00.000Z'
      };

      const brandNewUrgentJob: PrintJobRecord = {
        id: 'new-urgent-job',
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        document_storage_key: 'urgent.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:05:00.000Z',
        document_expires_at: '2026-10-21T10:05:00.000Z',
        created_at: '2026-10-20T10:05:00.000Z',
        updated_at: '2026-10-20T10:05:00.000Z'
      };

      const sorted = sortQueueJobs([brandNewUrgentJob, activePrintJob]);
      expect(sorted[0]!.id).toBe(activePrintJob.id); // Active print is NOT preempted
      expect(sorted[1]!.id).toBe(brandNewUrgentJob.id);
    });
  });

  // ============================================================================
  // 2. Dynamic Positioning & Projected Schedule
  // ============================================================================

  describe('Dynamic Position & Schedule Projection', () => {
    it('derives sequential 1-based positions dynamically without sorting by mutable column', () => {
      const job1: PrintJobRecord = {
        id: 'job-1',
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'doc1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
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
        enqueued_at: '2026-10-20T10:00:00.000Z',
        document_expires_at: '2026-10-21T10:00:00.000Z',
        created_at: '2026-10-20T10:00:00.000Z',
        updated_at: '2026-10-20T10:00:00.000Z'
      };

      const job2: PrintJobRecord = {
        id: 'job-2',
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        document_storage_key: 'doc2.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:05:00.000Z',
        document_expires_at: '2026-10-21T10:05:00.000Z',
        created_at: '2026-10-20T10:05:00.000Z',
        updated_at: '2026-10-20T10:05:00.000Z'
      };

      const schedule = projectQueueSchedule(null, [job1, job2]);
      expect(schedule.scheduledQueue).toHaveLength(2);
      // Urgent job gets position 1, flexible gets position 2
      expect(schedule.scheduledQueue[0]!.id).toBe('job-2');
      expect(schedule.scheduledQueue[0]!.queue_position).toBe(1);
      expect(schedule.scheduledQueue[1]!.id).toBe('job-1');
      expect(schedule.scheduledQueue[1]!.queue_position).toBe(2);
    });
  });

  // ============================================================================
  // 3. Concurrent Enqueue & Claim Stress Testing
  // ============================================================================

  describe('Concurrency & Claim Stress', () => {
    it('handles concurrent enqueue of 50 mixed-tier jobs preserving two-tier FIFO discipline', async () => {
      const enqueuePromises: Promise<PrintJobRecord>[] = [];
      const totalJobs = 50;

      for (let i = 0; i < totalJobs; i++) {
        const tier = i % 2 === 0 ? 'urgent' : 'flexible';
        // Distribute submission times
        const enqueuedAt = new Date(Date.now() + i * 100).toISOString();

        enqueuePromises.push(
          jobsRepo.create({
            shop_id: shopId,
            customer_id: i % 2 === 0 ? CUSTOMER_1.id : CUSTOMER_2.id,
            document_storage_key: `key-${i}.pdf`,
            settings: {
              paper_size: 'A4',
              color_mode: 'bw',
              duplex: false,
              copies: 1,
              binding: 'none'
            },
            priority_tier: tier,
            price_total_paise: tier === 'urgent' ? 2700 : 200,
            price_breakdown: {
              base_pages_paise: 200,
              color_surcharge_paise: 0,
              duplex_discount_paise: 0,
              binding_fee_paise: 0,
              urgent_surcharge_paise: tier === 'urgent' ? 2500 : 0,
              subtotal_paise: tier === 'urgent' ? 2700 : 200,
              gst_paise: 36,
              total_paise: tier === 'urgent' ? 2736 : 236
            },
            status: 'queued',
            enqueued_at: enqueuedAt,
            document_expires_at: new Date(Date.now() + 86400000).toISOString()
          })
        );
      }

      await Promise.all(enqueuePromises);

      const queue = await queueService.getShopQueue(shopId, { callerRole: 'owner' });
      expect(queue.total_queued).toBe(50);
      expect(queue.urgent_count).toBe(25);
      expect(queue.flexible_count).toBe(25);

      // Verify invariant: first 25 items MUST be urgent; remaining 25 MUST be flexible
      for (let i = 0; i < 25; i++) {
        expect(queue.queue[i]!.priority_tier).toBe('urgent');
        expect(queue.queue[i]!.queue_position).toBe(i + 1);
      }
      for (let i = 25; i < 50; i++) {
        expect(queue.queue[i]!.priority_tier).toBe('flexible');
        expect(queue.queue[i]!.queue_position).toBe(i + 1);
      }

      // Verify FIFO within urgent
      for (let i = 0; i < 24; i++) {
        const t1 = new Date(queue.queue[i]!.enqueued_at).getTime();
        const t2 = new Date(queue.queue[i + 1]!.enqueued_at).getTime();
        expect(t1).toBeLessThanOrEqual(t2);
      }
    });

    it('atomically selects next eligible job without race condition or duplicate dispatch', async () => {
      // Create 1 urgent job and 2 flexible jobs
      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'flex1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
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
        enqueued_at: '2026-10-20T10:00:00.000Z',
        document_expires_at: '2026-10-21T10:00:00.000Z'
      });

      const urgentJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        document_storage_key: 'urgent1.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:10:00.000Z',
        document_expires_at: '2026-10-21T10:10:00.000Z'
      });

      // Fire 10 concurrent requests to getNextEligibleJob
      const claims = await Promise.all(
        Array.from({ length: 10 }).map(() => queueService.getNextEligibleJob(shopId))
      );

      // Every caller must deterministically see the urgent job as the next eligible job
      for (const res of claims) {
        expect(res).not.toBeNull();
        expect(res!.id).toBe(urgentJob.id);
        expect(res!.priority_tier).toBe('urgent');
      }
    });
  });

  // ============================================================================
  // 4. Urgent Cap & Starvation Fairness Guard
  // ============================================================================

  describe('Urgent Cap & Fairness Starvation Guard', () => {
    it('triggers hourly quota limit when urgent jobs exceed configured threshold', async () => {
      const now = Date.now();
      const shopJobs: PrintJobRecord[] = [];

      // Create 10 urgent jobs in the last 15 minutes (threshold = 10)
      for (let i = 0; i < 10; i++) {
        shopJobs.push({
          id: `urgent-${i}`,
          shop_id: shopId,
          customer_id: CUSTOMER_1.id,
          document_storage_key: `key-${i}.pdf`,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            duplex: false,
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'urgent',
          price_total_paise: 2700,
          price_breakdown: {
            base_pages_paise: 200,
            color_surcharge_paise: 0,
            duplex_discount_paise: 0,
            binding_fee_paise: 0,
            urgent_surcharge_paise: 2500,
            subtotal_paise: 2700,
            gst_paise: 486,
            total_paise: 3186
          },
          status: 'queued',
          enqueued_at: new Date(now - 10 * 60 * 1000).toISOString(),
          document_expires_at: new Date(now + 86400000).toISOString(),
          created_at: new Date(now - 10 * 60 * 1000).toISOString(),
          updated_at: new Date(now - 10 * 60 * 1000).toISOString()
        });
      }

      const status = evaluateUrgentCapAndFairness(
        shopId,
        shopJobs,
        {
          type: 'flat',
          amount: 2500,
          max_urgent_jobs_per_hour: 10
        },
        now
      );

      expect(status.is_urgent_available).toBe(false);
      expect(status.rejection_details?.cap_type).toBe('hourly');
      expect(status.hourly_usage).toBe(10);
      expect(status.hourly_remaining).toBe(0);
    });

    it('triggers fairness starvation guard when oldest flexible job waits over threshold', async () => {
      const now = Date.now();
      const shopJobs: PrintJobRecord[] = [];

      // A flexible job that has been waiting for 35 minutes (threshold = 30 mins / 1800s)
      shopJobs.push({
        id: 'starved-flexible-job',
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        document_storage_key: 'starved.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
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
        enqueued_at: new Date(now - 35 * 60 * 1000).toISOString(),
        document_expires_at: new Date(now + 86400000).toISOString(),
        created_at: new Date(now - 35 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 35 * 60 * 1000).toISOString()
      });

      const status = evaluateUrgentCapAndFairness(
        shopId,
        shopJobs,
        {
          type: 'flat',
          amount: 2500,
          fairness_guard_enabled: true,
          max_flexible_wait_threshold_seconds: 1800
        },
        now
      );

      expect(status.is_urgent_available).toBe(false);
      expect(status.rejection_details?.cap_type).toBe('fairness_guard');
      expect(status.fairness_guard_active).toBe(true);
      expect(status.rejection_details?.message).toContain('fairly');
    });
  });

  // ============================================================================
  // 5. HTTP Endpoints & Privacy Redaction Tests
  // ============================================================================

  describe('HTTP API Endpoints & Role Redaction', () => {
    beforeEach(async () => {
      // Seed 1 active printing job and 2 queued jobs
      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        printer_id: printer1Id,
        document_storage_key: 'active-print.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 2, binding: 'none' },
        priority_tier: 'flexible',
        price_total_paise: 400,
        price_breakdown: {
          base_pages_paise: 400,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 0,
          subtotal_paise: 400,
          gst_paise: 72,
          total_paise: 472
        },
        status: 'printing',
        enqueued_at: '2026-10-20T09:50:00.000Z',
        document_expires_at: '2026-10-21T09:50:00.000Z'
      });

      await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_2.id,
        printer_id: printer1Id,
        document_storage_key: 'cust2-urgent.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
        priority_tier: 'urgent',
        price_total_paise: 2700,
        price_breakdown: {
          base_pages_paise: 200,
          color_surcharge_paise: 0,
          duplex_discount_paise: 0,
          binding_fee_paise: 0,
          urgent_surcharge_paise: 2500,
          subtotal_paise: 2700,
          gst_paise: 486,
          total_paise: 3186
        },
        status: 'queued',
        enqueued_at: '2026-10-20T10:00:00.000Z',
        document_expires_at: '2026-10-21T10:00:00.000Z'
      });
    });

    it('GET /api/v1/shops/:shopId/queue returns full unredacted view to shop owner', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/queue`,
        headers: { authorization: 'Bearer token-owner' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.shop_id).toBe(shopId);
      expect(body.data.currently_printing).not.toBeNull();
      expect(body.data.currently_printing.customer_id).toBe(CUSTOMER_1.id);
      expect(body.data.currently_printing.document_storage_key).toBe('active-print.pdf');
      expect(body.data.queue).toHaveLength(1);
      expect(body.data.queue[0].customer_id).toBe(CUSTOMER_2.id);
      expect(body.data.queue[0].document_storage_key).toBe('cust2-urgent.pdf');
    });

    it('GET /api/v1/shops/:shopId/queue redacts other customers details when requested by customer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/queue`,
        headers: { authorization: 'Bearer token-cust-1' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.shop_id).toBe(shopId);

      // Caller is CUSTOMER_1: currently_printing belongs to CUSTOMER_1, so is_caller_job is true
      expect(body.data.currently_printing.is_caller_job).toBe(true);

      // The queued job belongs to CUSTOMER_2: should be redacted
      const otherJob = body.data.queue[0];
      expect(otherJob.is_caller_job).toBe(false);
      expect(otherJob.customer_id).toBeUndefined();
      expect(otherJob.document_storage_key).toBeUndefined();
      expect(otherJob.settings).toBeUndefined();
      expect(otherJob.price_total_paise).toBeUndefined();
      // Only position and estimated wait remain visible
      expect(otherJob.queue_position).toBe(1);
      expect(otherJob.estimated_wait_seconds).toBeGreaterThanOrEqual(0);
    });

    it('GET /api/v1/shops/:shopId/queue/next allows agent and owner, rejects customer with 403', async () => {
      // 1. Customer rejected
      const custRes = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/queue/next`,
        headers: { authorization: 'Bearer token-cust-1' }
      });
      expect(custRes.statusCode).toBe(403);

      // 2. Agent allowed
      const agentRes = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/queue/next`,
        headers: { authorization: 'Bearer token-agent' }
      });
      expect(agentRes.statusCode).toBe(200);
      const agentBody = JSON.parse(agentRes.body);
      expect(agentBody.data.job).not.toBeNull();
      expect(agentBody.data.job.priority_tier).toBe('urgent');

      // 3. Owner allowed
      const ownerRes = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/queue/next`,
        headers: { authorization: 'Bearer token-owner' }
      });
      expect(ownerRes.statusCode).toBe(200);
    });

    it('POST /api/v1/shops/:shopId/queue/eta returns projected wait time and position', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/queue/eta`,
        headers: { authorization: 'Bearer token-cust-1' },
        payload: {
          pages: 10,
          copies: 1,
          color_mode: 'bw',
          duplex: false,
          priority_tier: 'urgent'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.shop_id).toBe(shopId);
      expect(body.data.priority_tier).toBe('urgent');
      expect(body.data.projected_queue_position).toBeGreaterThan(0);
      expect(body.data.estimated_wait_seconds).toBeGreaterThan(0);
      expect(body.data.estimated_print_duration_seconds).toBeGreaterThan(0);
    });

    it('POST /api/v1/shops/:shopId/queue/eta validates positive page numbers', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/queue/eta`,
        headers: { authorization: 'Bearer token-cust-1' },
        payload: {
          pages: 0
        }
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_PAYLOAD');
    });

    it('GET /api/v1/shops/:shopId/queue/caps returns urgent cap and fairness metrics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopId}/queue/caps`,
        headers: { authorization: 'Bearer token-cust-1' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.shop_id).toBe(shopId);
      expect(body.data.is_urgent_available).toBe(true);
      expect(body.data.hourly_cap).toBe(10);
      expect(body.data.queue_cap).toBe(5);
    });

    it('POST /api/v1/shops/:shopId/queue/reassign moves job to alternate printer', async () => {
      const queuedJob = await jobsRepo.create({
        shop_id: shopId,
        customer_id: CUSTOMER_1.id,
        printer_id: printer1Id,
        document_storage_key: 'reassign.pdf',
        settings: { paper_size: 'A4', color_mode: 'bw', duplex: false, copies: 1, binding: 'none' },
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
        url: `/api/v1/shops/${shopId}/queue/reassign`,
        headers: { authorization: 'Bearer token-owner' },
        payload: {
          job_id: queuedJob.id,
          new_printer_id: printer2Id
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.job.printer_id).toBe(printer2Id);
    });

    it('POST /api/v1/shops/:shopId/queue/recalculate recomputes dynamic positions', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopId}/queue/recalculate`,
        headers: { authorization: 'Bearer token-owner' }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.shop_id).toBe(shopId);
      expect(body.data.queue).toBeDefined();
    });
  });
});
