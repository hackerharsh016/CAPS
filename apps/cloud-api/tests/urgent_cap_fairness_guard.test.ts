import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildApp } from '../src/app.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import { QueueService, QueueError } from '../src/modules/queue/queue.service.js';
import { evaluateUrgentCapAndFairness } from '../src/modules/queue/queue.calculator.js';
import type { Shop } from '../src/modules/shops/shops.types.js';
import type { PrintJob } from '../src/modules/print-jobs/print-jobs.types.js';

describe('Configurable Urgent Cap & Fairness Guard (P06-M02-F02)', () => {
  let shopsRepo: MockShopsRepository;
  let printJobsRepo: MockPrintJobsRepository;
  let printersRepo: MockPrintersRepository;
  let queueService: QueueService;
  let shop: Shop;

  beforeEach(async () => {
    shopsRepo = new MockShopsRepository();
    printJobsRepo = new MockPrintJobsRepository();
    printersRepo = new MockPrintersRepository();
    queueService = new QueueService(printJobsRepo, shopsRepo, printersRepo);

    // Create test shop with 3 urgent jobs/hour limit and 2 concurrent urgent queue limit
    shop = await shopsRepo.create({
      owner_id: crypto.randomUUID(),
      name: 'North Campus Cyber Hub',
      address: 'University Road',
      geo_lat: 28.7,
      geo_lng: 77.2,
      pricing_config: {
        A4: { bw_single_paise: 200, bw_double_paise: 300, color_single_paise: 1000, color_double_paise: 1500 },
        A3: { bw_single_paise: 500, bw_double_paise: 800, color_single_paise: 2000, color_double_paise: 3000 },
        Legal: { bw_single_paise: 300, bw_double_paise: 450, color_single_paise: 1200, color_double_paise: 1800 },
        binding_prices_paise: { none: 0, spiral: 3000, staple: 500, lamination: 2000 },
        gst_percentage: 18
      },
      urgent_surcharge_config: {
        type: 'flat',
        amount: 1500,
        max_urgent_jobs_per_hour: 3,
        max_urgent_jobs_in_queue: 2,
        fairness_guard_enabled: true,
        max_flexible_wait_threshold_seconds: 1800 // 30 minutes
      }
    });
  });

  describe('1. Hourly Urgent Cap Enforcement', () => {
    it('permits submissions up to the hourly limit and cleanly rejects subsequent requests', async () => {
      const now = Date.now();

      // Submit 3 urgent jobs within the hour
      for (let i = 0; i < 3; i++) {
        const job = await printJobsRepo.create({
          shop_id: shop.id,
          customer_id: crypto.randomUUID(),
          document_storage_key: `key-${i}`,
          settings: { pages: 5, copies: 1 },
          priority_tier: 'urgent',
          price_total_paise: 2000,
          price_breakdown: {}
        });
        await printJobsRepo.update(job.id, {
          status: 'queued',
          enqueued_at: new Date(now - (3 - i) * 60000).toISOString()
        });
      }

      // 4th urgent admission attempt should be rejected
      const status = await queueService.getUrgentCapStatus(shop.id, now);
      expect(status.is_urgent_available).toBe(false);
      expect(status.hourly_usage).toBe(3);
      expect(status.hourly_remaining).toBe(0);
      expect(status.rejection_details?.cap_type).toBe('hourly');
      expect(status.rejection_details?.fallback_tier).toBe('flexible');

      // Attempting reservation throws 429
      await expect(queueService.reserveUrgentAdmission(shop.id, now)).rejects.toThrow(
        /Shop urgent order cap of 3 jobs\/hour has been reached/
      );
    });

    it('surcharge calculation and ETA endpoints reflect cap exhaustion with transparent fallback', async () => {
      const now = Date.now();

      // Exhaust cap
      for (let i = 0; i < 3; i++) {
        const job = await printJobsRepo.create({
          shop_id: shop.id,
          customer_id: crypto.randomUUID(),
          document_storage_key: `key-${i}`,
          settings: { pages: 5, copies: 1 },
          priority_tier: 'urgent',
          price_total_paise: 2000,
          price_breakdown: {}
        });
        await printJobsRepo.update(job.id, {
          status: 'queued',
          enqueued_at: new Date(now - 10000).toISOString()
        });
      }

      // Surcharge calculation signals cap exhaustion
      const surcharge = await queueService.calculateUrgentSurcharge(shop.id, 5000, 'urgent', now);
      expect(surcharge.urgent_available).toBe(false);
      expect(surcharge.cap_status?.is_urgent_available).toBe(false);

      // ETA query signals cap exhaustion with transparent fallback details
      const eta = await queueService.getLiveEta({
        shop_id: shop.id,
        pages: 10,
        copies: 1,
        priority_tier: 'urgent'
      }, now);
      expect(eta.urgent_available).toBe(false);
      expect(eta.cap_rejection?.fallback_tier).toBe('flexible');
      expect(eta.cap_rejection?.cap_type).toBe('hourly');
    });
  });

  describe('2. Boundary-Time Rolling Window Precision', () => {
    it('accurately expires jobs that cross the 60-minute window boundary', () => {
      const now = 1700000000000; // Reference timestamp
      const ONE_HOUR = 3600 * 1000;

      // Job 1: Enqueued at now - 3601s (OUTSIDE window by 1 second)
      const jobOld: PrintJob = {
        id: 'job-old',
        shop_id: shop.id,
        customer_id: 'cust-1',
        document_storage_key: 'k',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {},
        status: 'completed',
        enqueued_at: new Date(now - ONE_HOUR - 1000).toISOString(),
        created_at: new Date(now - ONE_HOUR - 1000).toISOString(),
        document_expires_at: new Date().toISOString()
      };

      // Job 2: Enqueued at now - 3599s (INSIDE window by 1 second)
      const jobBoundary: PrintJob = {
        id: 'job-boundary',
        shop_id: shop.id,
        customer_id: 'cust-2',
        document_storage_key: 'k',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {},
        status: 'completed',
        enqueued_at: new Date(now - ONE_HOUR + 1000).toISOString(),
        created_at: new Date(now - ONE_HOUR + 1000).toISOString(),
        document_expires_at: new Date().toISOString()
      };

      // Job 3: Enqueued at now - 1800s (INSIDE window)
      const jobRecent: PrintJob = {
        id: 'job-recent',
        shop_id: shop.id,
        customer_id: 'cust-3',
        document_storage_key: 'k',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {},
        status: 'completed',
        enqueued_at: new Date(now - 1800000).toISOString(),
        created_at: new Date(now - 1800000).toISOString(),
        document_expires_at: new Date().toISOString()
      };

      // Evaluation at `now`:
      // jobOld (outside), jobBoundary (inside), jobRecent (inside) -> 2 jobs inside
      const status1 = evaluateUrgentCapAndFairness(
        shop.id,
        [jobOld, jobBoundary, jobRecent],
        shop.urgent_surcharge_config,
        now
      );
      expect(status1.hourly_usage).toBe(2);
      expect(status1.is_urgent_available).toBe(true); // Limit is 3, usage is 2 -> AVAILABLE

      // Add a 3rd inside-window job
      const jobNew: PrintJob = {
        id: 'job-new',
        shop_id: shop.id,
        customer_id: 'cust-4',
        document_storage_key: 'k',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {},
        status: 'queued',
        enqueued_at: new Date(now).toISOString(),
        created_at: new Date(now).toISOString(),
        document_expires_at: new Date().toISOString()
      };

      const status2 = evaluateUrgentCapAndFairness(
        shop.id,
        [jobOld, jobBoundary, jobRecent, jobNew],
        shop.urgent_surcharge_config,
        now
      );
      expect(status2.hourly_usage).toBe(3);
      expect(status2.is_urgent_available).toBe(false); // Cap hit!
      // Earliest inside-window job is jobBoundary at (now - ONE_HOUR + 1000)
      // It resets at (now - ONE_HOUR + 1000 + ONE_HOUR) = (now + 1000ms)
      expect(status2.retry_after_seconds).toBe(1);

      // Advance time by 2000ms: jobBoundary rolls out of the window!
      const status3 = evaluateUrgentCapAndFairness(
        shop.id,
        [jobOld, jobBoundary, jobRecent, jobNew],
        shop.urgent_surcharge_config,
        now + 2000
      );
      expect(status3.hourly_usage).toBe(2);
      expect(status3.is_urgent_available).toBe(true); // Slot opened up!
    });
  });

  describe('3. Queue Depth Limit (max_urgent_jobs_in_queue)', () => {
    it('rejects urgent jobs when concurrent queued urgent depth is reached', async () => {
      const now = Date.now();

      // Shop has max_urgent_jobs_in_queue = 2
      // Add 2 queued urgent jobs
      const j1 = await printJobsRepo.create({
        shop_id: shop.id,
        customer_id: crypto.randomUUID(),
        document_storage_key: 'k1',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {}
      });
      await printJobsRepo.update(j1.id, { status: 'queued', enqueued_at: new Date(now).toISOString() });

      const j2 = await printJobsRepo.create({
        shop_id: shop.id,
        customer_id: crypto.randomUUID(),
        document_storage_key: 'k2',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {}
      });
      await printJobsRepo.update(j2.id, { status: 'queued', enqueued_at: new Date(now).toISOString() });

      // Hourly usage is 2 (below 3), but queue depth is 2 (equals max_urgent_jobs_in_queue)
      const status = await queueService.getUrgentCapStatus(shop.id, now);
      expect(status.is_urgent_available).toBe(false);
      expect(status.current_urgent_queued).toBe(2);
      expect(status.queue_cap).toBe(2);
      expect(status.rejection_details?.cap_type).toBe('queue_depth');

      // Once job 1 transitions to printing, queue depth drops to 1 and slot opens
      await printJobsRepo.update(j1.id, { status: 'printing' });
      const statusAfterPrint = await queueService.getUrgentCapStatus(shop.id, now);
      expect(statusAfterPrint.current_urgent_queued).toBe(1);
      expect(statusAfterPrint.is_urgent_available).toBe(true);
    });
  });

  describe('4. Fairness & Starvation Guard', () => {
    it('pauses urgent admissions if a flexible order has been starved beyond threshold', async () => {
      const now = Date.now();

      // Flexible job has been waiting for 35 minutes (2100 seconds > 1800s threshold)
      const flexJob = await printJobsRepo.create({
        shop_id: shop.id,
        customer_id: crypto.randomUUID(),
        document_storage_key: 'k-flex',
        settings: {},
        priority_tier: 'flexible',
        price_total_paise: 500,
        price_breakdown: {}
      });
      await printJobsRepo.update(flexJob.id, {
        status: 'queued',
        enqueued_at: new Date(now - 35 * 60000).toISOString()
      });

      const status = await queueService.getUrgentCapStatus(shop.id, now);
      expect(status.is_urgent_available).toBe(false);
      expect(status.fairness_guard_active).toBe(true);
      expect(status.rejection_details?.cap_type).toBe('fairness_guard');
      expect(status.rejection_details?.message).toContain('pending flexible orders');

      // If flexible job was only queued for 10 minutes (600s < 1800s), urgent remains available
      await printJobsRepo.update(flexJob.id, {
        enqueued_at: new Date(now - 10 * 60000).toISOString()
      });
      const statusNormal = await queueService.getUrgentCapStatus(shop.id, now);
      expect(statusNormal.is_urgent_available).toBe(true);
    });
  });

  describe('5. Concurrent Urgent Submissions & Race Condition Safety', () => {
    it('safely handles concurrent simultaneous urgent reservations without exceeding limit', async () => {
      const now = Date.now();

      // Pre-seed 2 urgent completed jobs within hour (limit is 3, so exactly 1 slot remains)
      for (let i = 0; i < 2; i++) {
        const j = await printJobsRepo.create({
          shop_id: shop.id,
          customer_id: crypto.randomUUID(),
          document_storage_key: `seed-${i}`,
          settings: {},
          priority_tier: 'urgent',
          price_total_paise: 1000,
          price_breakdown: {}
        });
        await printJobsRepo.update(j.id, { status: 'completed', enqueued_at: new Date(now - 10000).toISOString() });
      }

      // Fire 10 concurrent requests at the exact same millisecond
      const results = await Promise.allSettled(
        Array.from({ length: 10 }).map(() =>
          queueService.reserveUrgentAdmission(shop.id, now)
        )
      );

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      // Exactly 1 request captures the remaining slot
      expect(fulfilled).toHaveLength(1);
      // All 9 competing requests are safely rejected with 429
      expect(rejected).toHaveLength(9);

      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          expect(rej.reason).toBeInstanceOf(QueueError);
          expect((rej.reason as QueueError).statusCode).toBe(429);
        }
      }
    });
  });

  describe('6. Policy Configuration Updates', () => {
    it('allows shop owner to update urgent cap, queue depth, and fairness threshold', async () => {
      const updated = await queueService.configureUrgentPolicy(shop.id, {
        max_urgent_jobs_per_hour: 10,
        max_urgent_jobs_in_queue: 5,
        fairness_guard_enabled: false
      });

      expect(updated.urgent_surcharge_config.max_urgent_jobs_per_hour).toBe(10);
      expect(updated.urgent_surcharge_config.max_urgent_jobs_in_queue).toBe(5);
      expect(updated.urgent_surcharge_config.fairness_guard_enabled).toBe(false);

      const status = await queueService.getUrgentCapStatus(shop.id);
      expect(status.hourly_cap).toBe(10);
      expect(status.queue_cap).toBe(5);
      expect(status.fairness_guard_active).toBe(false);
    });

    it('rejects negative configuration values with 400 validation error', async () => {
      await expect(
        queueService.configureUrgentPolicy(shop.id, {
          max_urgent_jobs_per_hour: -1
        })
      ).rejects.toThrow('Max urgent jobs per hour must be non-negative');
    });
  });

  describe('7. HTTP API Endpoints for Urgent Cap & Policy', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp({
        shopsRepo,
        printJobsRepo,
        printersRepo,
        queueService
      });
    });

    it('GET /api/v1/shops/:shopId/urgent/status returns 200 with serialized cap status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shop.id}/urgent/status`
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.shop_id).toBe(shop.id);
      expect(body.data.hourly_cap).toBe(3);
      expect(body.data.queue_cap).toBe(2);
      expect(body.data.is_urgent_available).toBe(true);
    });

    it('POST /api/v1/shops/:shopId/urgent/validate reserves admission or returns 429 when cap is hit', async () => {
      // 1. Success reservation
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shop.id}/urgent/validate`
      });
      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.body);
      expect(body1.data.reservation_id).toBeDefined();

      // Exhaust limit
      const now = Date.now();
      for (let i = 0; i < 3; i++) {
        const j = await printJobsRepo.create({
          shop_id: shop.id,
          customer_id: crypto.randomUUID(),
          document_storage_key: `k-${i}`,
          settings: {},
          priority_tier: 'urgent',
          price_total_paise: 1000,
          price_breakdown: {}
        });
        await printJobsRepo.update(j.id, { status: 'queued', enqueued_at: new Date(now).toISOString() });
      }

      // 2. Cap hit -> 429 rejection
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shop.id}/urgent/validate`
      });
      expect(res2.statusCode).toBe(429);
      const body2 = JSON.parse(res2.body);
      expect(body2.error.code).toBe('URGENT_CAP_EXCEEDED');
      expect(body2.error.details.fallback_tier).toBe('flexible');
    });

    it('PUT /api/v1/shops/:shopId/urgent/policy updates policy settings', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/shops/${shop.id}/urgent/policy`,
        payload: {
          max_urgent_jobs_per_hour: 8,
          max_urgent_jobs_in_queue: 4,
          fairness_guard_enabled: true
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.urgent_surcharge_config.max_urgent_jobs_per_hour).toBe(8);
      expect(body.data.urgent_surcharge_config.max_urgent_jobs_in_queue).toBe(4);
    });
  });

  describe('8. Database Migration Verification', () => {
    it('migration file exists and defines check_urgent_cap_and_fairness function', () => {
      const repoRoot = path.resolve(__dirname, '../../..');
      const migrationFile = path.join(
        repoRoot,
        'supabase/migrations/20261019000006_create_urgent_cap_and_fairness.sql'
      );

      expect(fs.existsSync(migrationFile)).toBe(true);
      const sql = fs.readFileSync(migrationFile, 'utf-8');

      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.check_urgent_cap_and_fairness');
      expect(sql).toContain('URGENT_CAP_EXCEEDED');
      expect(sql).toContain('URGENT_QUEUE_LIMIT_REACHED');
      expect(sql).toContain('FAIRNESS_GUARD_TRIGGERED');
    });
  });
});
