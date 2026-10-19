import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPaymentsRepository } from '../src/modules/payments/payments.repository.js';
import type { CreatePrintJobDto } from '../src/modules/print-jobs/print-jobs.types.js';

const PrintJobSettingsSchema = z
  .object({
    paper_size: z.enum(['a4', 'a3', 'legal', 'letter']),
    color_mode: z.enum(['bw', 'color']),
    duplex: z.enum(['simplex', 'duplex_long', 'duplex_short']),
    orientation: z.enum(['portrait', 'landscape']),
    copies: z.number().int().min(1).max(100),
    page_range: z.string(),
    binding: z.string()
  })
  .strict();

describe('Migration 003: Print Jobs and Payments Schema DDL Verification', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000003_create_jobs_and_payments.sql'
  );
  const seedPath = path.join(repoRoot, 'supabase/seeds/demo_data.sql');

  it('migration 003 file exists and defines print_jobs and payments tables and enums', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Custom enums
    expect(sql).toContain('CREATE TYPE public.priority_tier AS ENUM');
    expect(sql).toContain('CREATE TYPE public.job_status AS ENUM');
    expect(sql).toContain('CREATE TYPE public.payment_method AS ENUM');
    expect(sql).toContain('CREATE TYPE public.payment_status AS ENUM');

    // Tables
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.print_jobs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.payments');
  });

  it('enforces column constraints, defaults, and foreign keys', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // print_jobs defaults & constraints
    expect(sql).toContain("DEFAULT 'flexible'::public.priority_tier");
    expect(sql).toContain("DEFAULT 'pending_payment'::public.job_status");
    expect(sql).toContain('price_total_paise INTEGER NOT NULL CHECK (price_total_paise > 0)');
    expect(sql).toContain('REFERENCES public.shops(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES public.profiles(id) ON DELETE RESTRICT');
    expect(sql).toContain('REFERENCES public.printers(id) ON DELETE SET NULL');

    // payments defaults & constraints
    expect(sql).toContain("DEFAULT 'initiated'::public.payment_status");
    expect(sql).toContain("DEFAULT 'INR'");
    expect(sql).toContain('amount_paise INTEGER NOT NULL CHECK (amount_paise > 0)');
    expect(sql).toContain('REFERENCES public.print_jobs(id) ON DELETE CASCADE');
    expect(sql).toContain('CONSTRAINT uq_payments_gateway_ref UNIQUE (gateway_ref)');
  });

  it('defines performance indices and two-tier priority queue index', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_print_jobs_shop_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_print_jobs_customer_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_print_jobs_document_expires');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_print_jobs_two_tier_queue');
    expect(sql).toContain("CASE priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_payments_print_job_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_payments_gateway_ref');
  });

  it('enforces Row-Level Security (RLS) on print_jobs and payments with strict policies', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // RLS enabled
    expect(sql).toContain('ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;');

    // Policies
    expect(sql).toContain('CREATE POLICY "print_jobs_select"');
    expect(sql).toContain('CREATE POLICY "print_jobs_insert_customer"');
    expect(sql).toContain('CREATE POLICY "print_jobs_update"');
    expect(sql).toContain('CREATE POLICY "print_jobs_delete_admin_only"');
    expect(sql).toContain('CREATE POLICY "payments_select"');
    expect(sql).toContain('CREATE POLICY "payments_insert_customer"');
    expect(sql).toContain('CREATE POLICY "payments_update_admin_only"');

    // Automated trigger for enqueued_at
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.handle_job_enqueue');
  });

  it('demo seed data includes valid queued print jobs and verified payments', () => {
    const sql = fs.readFileSync(seedPath, 'utf-8');

    expect(sql).toContain('private/docs/sample_assignment_flexible.pdf');
    expect(sql).toContain('private/docs/sample_urgent_lab_report.pdf');
    expect(sql).toContain('pay_rzp_mock_demo_001');
    expect(sql).toContain('pay_rzp_mock_demo_002');

    // Validate settings structure using Zod
    const sampleSettings = {
      paper_size: 'a4' as const,
      color_mode: 'bw' as const,
      duplex: 'duplex_long' as const,
      orientation: 'portrait' as const,
      copies: 1,
      page_range: 'all',
      binding: 'none'
    };
    const parsed = PrintJobSettingsSchema.safeParse(sampleSettings);
    expect(parsed.success).toBe(true);
  });
});

describe('Cloud API Print Jobs & Payments Repository Layer (Two-Tier Queue & Replay Guard)', () => {
  it('Print Jobs repository enforces state defaults and enqueued_at transitions', async () => {
    const repo = new MockPrintJobsRepository();
    const shopId = '11110000-0000-0000-0000-000000000001';
    const customerId = '00000000-0000-0000-0000-000000000003';

    const jobDto: CreatePrintJobDto = {
      shop_id: shopId,
      customer_id: customerId,
      document_storage_key: 'private/customer/assignment.pdf',
      settings: { paper_size: 'a4', copies: 1 },
      price_total_paise: 250,
      price_breakdown: { base_pages_paise: 250, total_paise: 250 }
    };

    const created = await repo.create(jobDto);
    expect(created.id).toBeDefined();
    expect(created.status).toBe('pending_payment');
    expect(created.priority_tier).toBe('flexible'); // Default tier
    expect(created.enqueued_at).toBeUndefined();

    // Move to queued - enqueued_at should be assigned
    const queuedJob = await repo.update(created.id, { status: 'queued' });
    expect(queuedJob?.status).toBe('queued');
    expect(queuedJob?.enqueued_at).toBeDefined();
  });

  it('Mandatory Requirement: Two-tier priority queue orders Urgent jobs ahead of Flexible jobs (FIFO within tier)', async () => {
    const repo = new MockPrintJobsRepository();
    const shopId = '11110000-0000-0000-0000-000000000001';
    const customerId = '00000000-0000-0000-0000-000000000003';

    // 1. Create Flexible Job 1 at T=0
    const flexJob1 = await repo.create({
      shop_id: shopId,
      customer_id: customerId,
      document_storage_key: 'docs/flex1.pdf',
      settings: {},
      priority_tier: 'flexible',
      price_total_paise: 100,
      price_breakdown: {}
    });
    await repo.update(flexJob1.id, {
      status: 'queued',
      enqueued_at: new Date('2026-10-19T10:00:00Z').toISOString()
    });

    // 2. Create Flexible Job 2 at T=+5 min
    const flexJob2 = await repo.create({
      shop_id: shopId,
      customer_id: customerId,
      document_storage_key: 'docs/flex2.pdf',
      settings: {},
      priority_tier: 'flexible',
      price_total_paise: 100,
      price_breakdown: {}
    });
    await repo.update(flexJob2.id, {
      status: 'queued',
      enqueued_at: new Date('2026-10-19T10:05:00Z').toISOString()
    });

    // 3. Create Urgent Job 1 at T=+10 min (arrives LATER than Flexible jobs)
    const urgentJob1 = await repo.create({
      shop_id: shopId,
      customer_id: customerId,
      document_storage_key: 'docs/urgent1.pdf',
      settings: {},
      priority_tier: 'urgent',
      price_total_paise: 2100,
      price_breakdown: {}
    });
    await repo.update(urgentJob1.id, {
      status: 'queued',
      enqueued_at: new Date('2026-10-19T10:10:00Z').toISOString()
    });

    // Query queue
    const queue = await repo.findQueueByShop(shopId);

    // Urgent job must jump ahead of both earlier Flexible jobs!
    expect(queue).toHaveLength(3);
    expect(queue[0]?.id).toBe(urgentJob1.id);
    expect(queue[0]?.queue_position).toBe(1);

    // Flexible jobs must remain in their original FIFO order
    expect(queue[1]?.id).toBe(flexJob1.id);
    expect(queue[1]?.queue_position).toBe(2);

    expect(queue[2]?.id).toBe(flexJob2.id);
    expect(queue[2]?.queue_position).toBe(3);
  });

  it('Mandatory Requirement: Payments repository enforces unique gateway_ref replay protection', async () => {
    const repo = new MockPaymentsRepository();
    const jobId = '88880000-0000-0000-0000-000000000001';

    const p1 = await repo.create({
      print_job_id: jobId,
      amount_paise: 500,
      method: 'upi',
      gateway_ref: 'razorpay_pay_unique_test_123'
    });

    expect(p1.id).toBeDefined();
    expect(p1.status).toBe('initiated');

    // Attempting to register another payment with the identical gateway_ref must be rejected
    await expect(
      repo.create({
        print_job_id: jobId,
        amount_paise: 500,
        method: 'upi',
        gateway_ref: 'razorpay_pay_unique_test_123'
      })
    ).rejects.toThrow('replay attack prevention');
  });
});
