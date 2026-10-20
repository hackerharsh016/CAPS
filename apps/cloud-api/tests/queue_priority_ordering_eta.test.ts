import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import { QueueService } from '../src/modules/queue/queue.service.js';
import {
  calculatePrintDurationSeconds,
  sortQueueTwoTier
} from '../src/modules/queue/queue.calculator.js';
import type { Shop } from '../src/modules/shops/shops.types.js';
import type { PrintJob, PriorityTier } from '../src/modules/print-jobs/print-jobs.types.js';
import type { Printer } from '../src/modules/printers/printers.types.js';
import type { CustomerRedactedQueueJob } from '../src/modules/queue/queue.types.js';

describe('Priority Queue, Urgent Surcharge & Live ETA (P06-M02-F01)', () => {
  let shopsRepo: MockShopsRepository;
  let printJobsRepo: MockPrintJobsRepository;
  let printersRepo: MockPrintersRepository;
  let queueService: QueueService;
  let shopFlat: Shop;
  let shopPct: Shop;
  let printerA: Printer;
  let printerB: Printer;

  beforeEach(async () => {
    shopsRepo = new MockShopsRepository();
    printJobsRepo = new MockPrintJobsRepository();
    printersRepo = new MockPrintersRepository();
    queueService = new QueueService(printJobsRepo, shopsRepo, printersRepo);

    // Shop with Flat ₹15 (1500 paise) urgent surcharge
    shopFlat = await shopsRepo.create({
      owner_id: crypto.randomUUID(),
      name: 'QuickPrint Campus Express',
      address: 'North Campus Gate 3',
      geo_lat: 28.6139,
      geo_lng: 77.209,
      pricing_config: {
        A4: {
          bw_single_paise: 200,
          bw_double_paise: 300,
          color_single_paise: 1000,
          color_double_paise: 1500
        },
        A3: {
          bw_single_paise: 500,
          bw_double_paise: 800,
          color_single_paise: 2000,
          color_double_paise: 3000
        },
        Legal: {
          bw_single_paise: 300,
          bw_double_paise: 450,
          color_single_paise: 1200,
          color_double_paise: 1800
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
        amount: 1500,
        max_urgent_jobs_per_hour: 20
      }
    });

    // Shop with 25% urgent surcharge
    shopPct = await shopsRepo.create({
      owner_id: crypto.randomUUID(),
      name: 'Metro Cyber Print',
      address: 'Station Road',
      geo_lat: 28.62,
      geo_lng: 77.21,
      pricing_config: shopFlat.pricing_config,
      urgent_surcharge_config: {
        type: 'percentage',
        amount: 25,
        max_urgent_jobs_per_hour: 15
      }
    });

    // Register active printers for shopFlat
    printerA = await printersRepo.create({
      shop_id: shopFlat.id,
      name: 'HP LaserJet Pro M404n (Main)',
      role: 'bw',
      status: 'online',
      is_default: true
    });

    printerB = await printersRepo.create({
      shop_id: shopFlat.id,
      name: 'Canon imageRUNNER 2206 (Backup)',
      role: 'bw',
      status: 'online',
      is_default: false
    });
  });

  describe('1. Urgent Surcharge Calculation', () => {
    it('applies flat surcharge correctly to urgent jobs and 0 to flexible jobs', async () => {
      // Base: ₹100 (10000 paise)
      const resUrgent = await queueService.calculateUrgentSurcharge(
        shopFlat.id,
        10000,
        'urgent'
      );
      expect(resUrgent.priority_tier).toBe('urgent');
      expect(resUrgent.base_price_paise).toBe(10000);
      expect(resUrgent.urgent_surcharge_paise).toBe(1500);
      expect(resUrgent.total_price_paise).toBe(11500);
      expect(resUrgent.surcharge_type).toBe('flat');

      const resFlex = await queueService.calculateUrgentSurcharge(
        shopFlat.id,
        10000,
        'flexible'
      );
      expect(resFlex.priority_tier).toBe('flexible');
      expect(resFlex.base_price_paise).toBe(10000);
      expect(resFlex.urgent_surcharge_paise).toBe(0);
      expect(resFlex.total_price_paise).toBe(10000);
      expect(resFlex.surcharge_type).toBe('none');
    });

    it('applies percentage surcharge correctly to urgent jobs', async () => {
      // Base: ₹200 (20000 paise) at 25% -> surcharge ₹50 (5000 paise)
      const res = await queueService.calculateUrgentSurcharge(
        shopPct.id,
        20000,
        'urgent'
      );
      expect(res.urgent_surcharge_paise).toBe(5000);
      expect(res.total_price_paise).toBe(25000);
      expect(res.surcharge_type).toBe('percentage');
      expect(res.surcharge_rate).toBe(25);
    });

    it('rejects invalid inputs with appropriate validation errors', async () => {
      await expect(
        queueService.calculateUrgentSurcharge(shopFlat.id, -500, 'urgent')
      ).rejects.toThrow('Base price in paise must be non-negative');

      await expect(
        queueService.calculateUrgentSurcharge(shopFlat.id, 5000, 'invalid' as PriorityTier)
      ).rejects.toThrow("Priority tier must be 'urgent' or 'flexible'");

      await expect(
        queueService.calculateUrgentSurcharge(crypto.randomUUID(), 5000, 'urgent')
      ).rejects.toThrow('not found');
    });
  });

  describe('2. Throughput & Print Duration Calculator', () => {
    it('accurately computes duration considering duplex, color, and binding', () => {
      // 10 pages, 1 copy, bw simplex -> 15s warmup + (10 * 2.0s) = 35s
      const d1 = calculatePrintDurationSeconds({
        pages: 10,
        copies: 1,
        color_mode: 'bw',
        duplex: false
      });
      expect(d1).toBe(35);

      // 10 pages, 2 copies, bw duplex -> 15s warmup + (20 * 3.0s) = 75s
      const d2 = calculatePrintDurationSeconds({
        pages: 10,
        copies: 2,
        color_mode: 'bw',
        duplex: true
      });
      expect(d2).toBe(75);

      // 5 pages, 1 copy, color simplex, spiral binding -> 15s + (5 * 4.0s) + 120s = 155s
      const d3 = calculatePrintDurationSeconds({
        pages: 5,
        copies: 1,
        color_mode: 'color',
        duplex: false,
        binding: 'spiral'
      });
      expect(d3).toBe(155);
    });
  });

  describe('3. Two-Tier Queue Ordering Discipline & Non-Preemption', () => {
    it('guarantees non-preemption: currently printing job is never preempted by new urgent arrivals', async () => {
      const now = Date.now();
      const customerId = crypto.randomUUID();

      // Job 0: Currently printing
      const jobPrinting = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/customer1/thesis.pdf',
        settings: { pages: 30, copies: 1, color_mode: 'bw', duplex: true },
        priority_tier: 'flexible',
        price_total_paise: 6000,
        price_breakdown: {}
      });
      await printJobsRepo.update(jobPrinting.id, {
        status: 'printing',
        enqueued_at: new Date(now - 10000).toISOString()
      });

      // Job 1: Flexible queued at T-5m
      const jobFlex1 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/customer2/notes.pdf',
        settings: { pages: 10, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'flexible',
        price_total_paise: 2000,
        price_breakdown: {}
      });
      await printJobsRepo.update(jobFlex1.id, {
        status: 'queued',
        enqueued_at: new Date(now - 300000).toISOString()
      });

      // Job 2: Urgent queued arriving NOW at T-0
      const jobUrgent = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/customer3/boarding_pass.pdf',
        settings: { pages: 2, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'urgent',
        price_total_paise: 1900,
        price_breakdown: {}
      });
      await printJobsRepo.update(jobUrgent.id, {
        status: 'queued',
        enqueued_at: new Date(now).toISOString()
      });

      const queueView = await queueService.getShopQueue(shopFlat.id, { callerRole: 'owner' });

      // Non-preemption check:
      // jobPrinting must remain in currently_printing, NOT preempted!
      expect(queueView.currently_printing).not.toBeNull();
      expect(queueView.currently_printing?.id).toBe(jobPrinting.id);
      expect(queueView.currently_printing?.status).toBe('printing');

      // Queued list check:
      // jobUrgent must be position 1 (ahead of jobFlex1)
      // jobFlex1 must be position 2
      expect(queueView.queue).toHaveLength(2);
      expect(queueView.queue[0]?.id).toBe(jobUrgent.id);
      expect(queueView.queue[0]?.queue_position).toBe(1);
      expect(queueView.queue[0]?.priority_tier).toBe('urgent');

      expect(queueView.queue[1]?.id).toBe(jobFlex1.id);
      expect(queueView.queue[1]?.queue_position).toBe(2);
      expect(queueView.queue[1]?.priority_tier).toBe('flexible');
    });

    it('required test evidence: Urgent after ongoing print and preexisting urgent, ahead of flexible', async () => {
      const now = Date.now();
      const customerId = crypto.randomUUID();

      // 1. Ongoing print job
      const ongoingJob = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/ongoing.pdf',
        settings: { pages: 20, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'flexible',
        price_total_paise: 4000,
        price_breakdown: {}
      });
      await printJobsRepo.update(ongoingJob.id, {
        status: 'printing',
        enqueued_at: new Date(now - 15000).toISOString()
      });

      // 2. Preexisting urgent job (Enqueued at 10:00)
      const preexistingUrgent = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/urgent1.pdf',
        settings: { pages: 5, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'urgent',
        price_total_paise: 2500,
        price_breakdown: {}
      });
      await printJobsRepo.update(preexistingUrgent.id, {
        status: 'queued',
        enqueued_at: new Date(now - 60000).toISOString()
      });

      // 3. Preexisting flexible job (Enqueued at 09:55 - earlier than urgent!)
      const preexistingFlexible = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/flex1.pdf',
        settings: { pages: 15, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'flexible',
        price_total_paise: 3000,
        price_breakdown: {}
      });
      await printJobsRepo.update(preexistingFlexible.id, {
        status: 'queued',
        enqueued_at: new Date(now - 120000).toISOString()
      });

      // 4. Newly arriving urgent job (Enqueued at 10:05)
      const newUrgent = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'docs/urgent2.pdf',
        settings: { pages: 4, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'urgent',
        price_total_paise: 2300,
        price_breakdown: {}
      });
      await printJobsRepo.update(newUrgent.id, {
        status: 'queued',
        enqueued_at: new Date(now).toISOString()
      });

      const queueView = await queueService.getShopQueue(shopFlat.id, { callerRole: 'owner' });

      // Invariant Verification:
      // 1. Ongoing print is active
      expect(queueView.currently_printing?.id).toBe(ongoingJob.id);

      // 2. Queue order must strictly be:
      // Position 1: preexistingUrgent (Urgent, enqueued T-60s)
      // Position 2: newUrgent (Urgent, enqueued T-0s) - FIFO within urgent!
      // Position 3: preexistingFlexible (Flexible) - Jumped by newUrgent!
      expect(queueView.queue).toHaveLength(3);
      expect(queueView.queue[0]?.id).toBe(preexistingUrgent.id);
      expect(queueView.queue[0]?.queue_position).toBe(1);

      expect(queueView.queue[1]?.id).toBe(newUrgent.id);
      expect(queueView.queue[1]?.queue_position).toBe(2);

      expect(queueView.queue[2]?.id).toBe(preexistingFlexible.id);
      expect(queueView.queue[2]?.queue_position).toBe(3);
    });

    it('FIFO is strictly preserved inside each tier', () => {
      const now = Date.now();
      const jobs: PrintJob[] = [
        {
          id: 'flex-late',
          shop_id: 'shop-1',
          customer_id: 'cust-1',
          document_storage_key: 'k',
          settings: {},
          priority_tier: 'flexible',
          price_total_paise: 100,
          price_breakdown: {},
          status: 'queued',
          enqueued_at: new Date(now + 20000).toISOString(),
          created_at: new Date(now + 20000).toISOString(),
          document_expires_at: new Date(now + 86400000).toISOString()
        },
        {
          id: 'urgent-late',
          shop_id: 'shop-1',
          customer_id: 'cust-2',
          document_storage_key: 'k',
          settings: {},
          priority_tier: 'urgent',
          price_total_paise: 100,
          price_breakdown: {},
          status: 'queued',
          enqueued_at: new Date(now + 10000).toISOString(),
          created_at: new Date(now + 10000).toISOString(),
          document_expires_at: new Date(now + 86400000).toISOString()
        },
        {
          id: 'flex-early',
          shop_id: 'shop-1',
          customer_id: 'cust-3',
          document_storage_key: 'k',
          settings: {},
          priority_tier: 'flexible',
          price_total_paise: 100,
          price_breakdown: {},
          status: 'queued',
          enqueued_at: new Date(now).toISOString(),
          created_at: new Date(now).toISOString(),
          document_expires_at: new Date(now + 86400000).toISOString()
        },
        {
          id: 'urgent-early',
          shop_id: 'shop-1',
          customer_id: 'cust-4',
          document_storage_key: 'k',
          settings: {},
          priority_tier: 'urgent',
          price_total_paise: 100,
          price_breakdown: {},
          status: 'queued',
          enqueued_at: new Date(now - 5000).toISOString(),
          created_at: new Date(now - 5000).toISOString(),
          document_expires_at: new Date(now + 86400000).toISOString()
        }
      ];

      const sorted = sortQueueTwoTier(jobs);
      expect(sorted.map(j => j.id)).toEqual([
        'urgent-early',
        'urgent-late',
        'flex-early',
        'flex-late'
      ]);
    });
  });

  describe('4. Live ETA & Recalculated Projected Queue', () => {
    it('dynamically recalculates cumulative wait times and ETAs', async () => {
      const now = Date.now();
      const customerId = crypto.randomUUID();

      // Setup 2 queued jobs
      // Job 1: 10 pages bw simplex -> 15s + 20s = 35s
      const j1 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        document_storage_key: 'k1',
        settings: { pages: 10, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'urgent',
        price_total_paise: 3500,
        price_breakdown: {}
      });
      await printJobsRepo.update(j1.id, {
        status: 'queued',
        enqueued_at: new Date(now).toISOString()
      });

      // Job 2: 20 pages bw simplex -> 15s + 40s = 55s
      const j2 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        document_storage_key: 'k2',
        settings: { pages: 20, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'flexible',
        price_total_paise: 4000,
        price_breakdown: {}
      });
      await printJobsRepo.update(j2.id, {
        status: 'queued',
        enqueued_at: new Date(now).toISOString()
      });

      const queueView = await queueService.getShopQueue(shopFlat.id, { callerRole: 'owner' });

      expect(queueView.queue).toHaveLength(2);
      // Job 1 is first: wait time 0s, print duration 35s
      expect(queueView.queue[0]?.id).toBe(j1.id);
      expect(queueView.queue[0]?.estimated_wait_seconds).toBe(0);
      expect(queueView.queue[0]?.estimated_print_duration_seconds).toBe(35);

      // Job 2 is second: wait time 35s, print duration 55s
      expect(queueView.queue[1]?.id).toBe(j2.id);
      expect(queueView.queue[1]?.estimated_wait_seconds).toBe(35);
      expect(queueView.queue[1]?.estimated_print_duration_seconds).toBe(55);

      expect(queueView.total_estimated_wait_seconds).toBe(90);
    });

    it('computes live ETA projection for prospective jobs', async () => {
      const now = Date.now();
      const customerId = crypto.randomUUID();

      // 1 urgent job already queued (35s duration)
      const j1 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        document_storage_key: 'k1',
        settings: { pages: 10, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'urgent',
        price_total_paise: 3500,
        price_breakdown: {}
      });
      await printJobsRepo.update(j1.id, {
        status: 'queued',
        enqueued_at: new Date(now).toISOString()
      });

      // 1 flexible job already queued (55s duration)
      const j2 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        document_storage_key: 'k2',
        settings: { pages: 20, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'flexible',
        price_total_paise: 4000,
        price_breakdown: {}
      });
      await printJobsRepo.update(j2.id, {
        status: 'queued',
        enqueued_at: new Date(now).toISOString()
      });

      // Query ETA for a prospective URGENT job (5 pages -> 15 + 10 = 25s)
      const etaUrgent = await queueService.getLiveEta({
        shop_id: shopFlat.id,
        pages: 5,
        copies: 1,
        color_mode: 'bw',
        duplex: false,
        priority_tier: 'urgent'
      });
      // Prospective urgent job goes behind 1 existing urgent job (35s wait), ahead of flexible job!
      expect(etaUrgent.projected_queue_position).toBe(2);
      expect(etaUrgent.estimated_wait_seconds).toBe(35);
      expect(etaUrgent.estimated_print_duration_seconds).toBe(25);
      expect(etaUrgent.ahead_urgent_jobs).toBe(1);
      expect(etaUrgent.ahead_flexible_jobs).toBe(0);

      // Query ETA for a prospective FLEXIBLE job (5 pages -> 25s)
      const etaFlex = await queueService.getLiveEta({
        shop_id: shopFlat.id,
        pages: 5,
        copies: 1,
        color_mode: 'bw',
        duplex: false,
        priority_tier: 'flexible'
      });
      // Prospective flexible job goes behind both urgent (35s) AND flexible (55s) -> 90s wait, position 3!
      expect(etaFlex.projected_queue_position).toBe(3);
      expect(etaFlex.estimated_wait_seconds).toBe(90);
      expect(etaFlex.ahead_urgent_jobs).toBe(1);
      expect(etaFlex.ahead_flexible_jobs).toBe(1);
    });
  });

  describe('5. Customer Privacy & Metadata Redaction', () => {
    it('redacts sensitive document and customer details for other customers but preserves caller details', async () => {
      const callerCustomerId = crypto.randomUUID();
      const otherCustomerId = crypto.randomUUID();

      // Job 1 belongs to other customer
      const j1 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: otherCustomerId,
        document_storage_key: 'private/contracts/secret.pdf',
        settings: { pages: 50, copies: 3, color_mode: 'color', duplex: true },
        priority_tier: 'urgent',
        price_total_paise: 25000,
        price_breakdown: { itemized: true }
      });
      await printJobsRepo.update(j1.id, {
        status: 'queued',
        enqueued_at: new Date().toISOString()
      });

      // Job 2 belongs to calling customer
      const j2 = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: callerCustomerId,
        document_storage_key: 'private/caller/syllabus.pdf',
        settings: { pages: 5, copies: 1, color_mode: 'bw', duplex: false },
        priority_tier: 'flexible',
        price_total_paise: 1000,
        price_breakdown: {}
      });
      await printJobsRepo.update(j2.id, {
        status: 'queued',
        enqueued_at: new Date().toISOString()
      });

      const queueView = await queueService.getShopQueue(shopFlat.id, {
        callerCustomerId,
        callerRole: 'customer'
      });

      expect(queueView.queue).toHaveLength(2);

      // Job 1 (Other customer): redacted!
      const q1 = queueView.queue[0] as CustomerRedactedQueueJob;
      expect(q1.id).toBe(j1.id);
      expect(q1.is_caller_job).toBe(false);
      expect((q1 as unknown as Record<string, unknown>)['customer_id']).toBeUndefined();
      expect(q1.pages).toBeUndefined();
      expect(q1.price_total_paise).toBeUndefined();
      expect(q1.queue_position).toBe(1);
      expect(q1.estimated_wait_seconds).toBeDefined();

      // Job 2 (Caller): visible!
      const q2 = queueView.queue[1] as CustomerRedactedQueueJob;
      expect(q2.id).toBe(j2.id);
      expect(q2.is_caller_job).toBe(true);
      expect(q2.pages).toBe(5);
      expect(q2.price_total_paise).toBe(1000);
      expect(q2.queue_position).toBe(2);
    });
  });

  describe('6. Printer Hardware Jam / Reassignment', () => {
    it('reassigns queued job to online backup printer and recalculates queue', async () => {
      const customerId = crypto.randomUUID();
      const job = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: customerId,
        printer_id: printerA.id,
        document_storage_key: 'k',
        settings: { pages: 5, copies: 1 },
        priority_tier: 'urgent',
        price_total_paise: 2000,
        price_breakdown: {}
      });
      await printJobsRepo.update(job.id, {
        status: 'queued',
        enqueued_at: new Date().toISOString()
      });

      const { job: reassignedJob, queue } = await queueService.reassignPrinter({
        shop_id: shopFlat.id,
        job_id: job.id,
        new_printer_id: printerB.id
      });

      expect(reassignedJob.printer_id).toBe(printerB.id);
      expect(queue.queue[0]?.printer_id).toBe(printerB.id);
    });

    it('rejects reassignment to an offline printer with 409 conflict', async () => {
      // Mark printerB as offline
      await printersRepo.update(printerB.id, { status: 'offline' });

      const job = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: crypto.randomUUID(),
        printer_id: printerA.id,
        document_storage_key: 'k',
        settings: {},
        priority_tier: 'urgent',
        price_total_paise: 1000,
        price_breakdown: {}
      });

      await expect(
        queueService.reassignPrinter({
          shop_id: shopFlat.id,
          job_id: job.id,
          new_printer_id: printerB.id
        })
      ).rejects.toThrow("Cannot assign job to printer with status 'offline'");
    });
  });

  describe('7. Stress & Fairness Test: 120 Interleaved Jobs', () => {
    it('preserves strict tier priority and intra-tier FIFO across 120 interleaved submissions', () => {
      const now = Date.now();
      const generatedJobs: PrintJob[] = [];

      for (let i = 0; i < 120; i++) {
        const tier: PriorityTier = i % 3 === 0 ? 'urgent' : 'flexible';
        // Interleaved enqueued timestamps spanning 2 hours
        const enqueuedTime = new Date(now + i * 60000).toISOString();

        generatedJobs.push({
          id: `job-${String(i).padStart(3, '0')}`,
          shop_id: 'shop-stress',
          customer_id: `cust-${i}`,
          document_storage_key: `key-${i}`,
          settings: { pages: (i % 20) + 1, copies: 1 },
          priority_tier: tier,
          price_total_paise: 500,
          price_breakdown: {},
          status: 'queued',
          enqueued_at: enqueuedTime,
          created_at: enqueuedTime,
          document_expires_at: new Date(now + 86400000).toISOString()
        });
      }

      // Shuffle randomly to simulate concurrent arriving order
      const shuffled = [...generatedJobs].sort(() => Math.random() - 0.5);
      const sorted = sortQueueTwoTier(shuffled);

      expect(sorted).toHaveLength(120);

      // Verify: all urgent jobs come before all flexible jobs
      const urgentJobs = sorted.filter(j => j.priority_tier === 'urgent');
      const flexibleJobs = sorted.filter(j => j.priority_tier === 'flexible');

      expect(urgentJobs).toHaveLength(40);
      expect(flexibleJobs).toHaveLength(80);

      // First 40 elements must be urgent
      for (let i = 0; i < 40; i++) {
        expect(sorted[i]?.priority_tier).toBe('urgent');
      }

      // Remaining 80 elements must be flexible
      for (let i = 40; i < 120; i++) {
        expect(sorted[i]?.priority_tier).toBe('flexible');
      }

      // Within urgent tier: timestamps must strictly increase
      for (let i = 1; i < urgentJobs.length; i++) {
        const prevJob = urgentJobs[i - 1];
        const currJob = urgentJobs[i];
        if (prevJob?.enqueued_at && currJob?.enqueued_at) {
          const prevTime = new Date(prevJob.enqueued_at).getTime();
          const currTime = new Date(currJob.enqueued_at).getTime();
          expect(currTime).toBeGreaterThanOrEqual(prevTime);
        }
      }

      // Within flexible tier: timestamps must strictly increase
      for (let i = 1; i < flexibleJobs.length; i++) {
        const prevJob = flexibleJobs[i - 1];
        const currJob = flexibleJobs[i];
        if (prevJob?.enqueued_at && currJob?.enqueued_at) {
          const prevTime = new Date(prevJob.enqueued_at).getTime();
          const currTime = new Date(currJob.enqueued_at).getTime();
          expect(currTime).toBeGreaterThanOrEqual(prevTime);
        }
      }
    });
  });

  describe('8. Fastify HTTP Endpoints', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp({
        shopsRepo,
        printJobsRepo,
        printersRepo,
        queueService
      });
    });

    it('GET /api/v1/shops/:shopId/queue returns 200 with serialized queue', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopFlat.id}/queue`
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toBeDefined();
      expect(body.data.shop_id).toBe(shopFlat.id);
      expect(body.data.queue).toBeInstanceOf(Array);
      expect(body.data.active_printers_count).toBe(2);
    });

    it('POST /api/v1/shops/:shopId/queue/eta returns 200 with live projection', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopFlat.id}/queue/eta`,
        payload: {
          pages: 10,
          copies: 1,
          color_mode: 'bw',
          duplex: false,
          priority_tier: 'urgent'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.projected_queue_position).toBe(1);
      expect(body.data.estimated_print_duration_seconds).toBe(35);
      expect(body.data.projected_completion_time).toBeDefined();
    });

    it('POST /api/v1/shops/:shopId/pricing/surcharge returns 200 with itemized surcharge', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopFlat.id}/pricing/surcharge`,
        payload: {
          base_price_paise: 5000,
          priority_tier: 'urgent'
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.urgent_surcharge_paise).toBe(1500);
      expect(body.data.total_price_paise).toBe(6500);
    });

    it('POST /api/v1/shops/:shopId/queue/reassign updates printer assignment', async () => {
      const job = await printJobsRepo.create({
        shop_id: shopFlat.id,
        customer_id: crypto.randomUUID(),
        printer_id: printerA.id,
        document_storage_key: 'k',
        settings: {},
        priority_tier: 'flexible',
        price_total_paise: 500,
        price_breakdown: {}
      });
      await printJobsRepo.update(job.id, {
        status: 'queued',
        enqueued_at: new Date().toISOString()
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopFlat.id}/queue/reassign`,
        payload: {
          job_id: job.id,
          new_printer_id: printerB.id
        }
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.job.printer_id).toBe(printerB.id);
    });

    it('returns 400 validation error for invalid parameters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopFlat.id}/queue/eta`,
        payload: {
          pages: -5,
          priority_tier: 'urgent'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when shop does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${crypto.randomUUID()}/queue`
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SHOP_NOT_FOUND');
    });
  });
});
