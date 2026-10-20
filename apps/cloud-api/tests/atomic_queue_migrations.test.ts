import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('Atomic Priority Queue SQL Migrations', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const migrationFile = path.join(
    migrationsDir,
    '20261019000008_create_atomic_priority_queue.sql'
  );

  it('migration file exists in supabase/migrations/', () => {
    expect(fs.existsSync(migrationFile)).toBe(true);
  });

  it('defines the enforce_enqueued_at_immutability function and trigger', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.enforce_enqueued_at_immutability()');
    expect(content).toContain('OLD.enqueued_at IS NOT NULL');
    expect(content).toContain('NEW.enqueued_at IS DISTINCT FROM OLD.enqueued_at');
    expect(content).toContain('enqueued_at is immutable and cannot be updated once set');
    expect(content).toContain('DROP TRIGGER IF EXISTS trg_prevent_enqueued_at_update ON public.print_jobs');
    expect(content).toContain('BEFORE UPDATE ON public.print_jobs');
    expect(content).toContain('FOR EACH ROW');
    expect(content).toContain('EXECUTE FUNCTION public.enforce_enqueued_at_immutability()');
  });

  it('creates the composite partial index for high-throughput two-tier priority ordering', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE INDEX IF NOT EXISTS idx_print_jobs_priority_queue_order');
    expect(content).toContain('ON public.print_jobs');
    expect(content).toContain("(CASE priority_tier WHEN 'urgent' THEN 0 ELSE 1 END)");
    expect(content).toContain('enqueued_at ASC');
    expect(content).toContain('id ASC');
    expect(content).toContain("WHERE status IN ('queued', 'approved')");
  });

  it('defines get_next_eligible_job atomic RPC with FOR UPDATE SKIP LOCKED', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_next_eligible_job');
    expect(content).toContain('p_shop_id UUID');
    expect(content).toContain('p_printer_id UUID DEFAULT NULL');
    expect(content).toContain('SECURITY DEFINER');
    expect(content).toContain('LIMIT 1');
    expect(content).toContain('FOR UPDATE SKIP LOCKED');
    expect(content).toContain("(CASE pj.priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END)");
    expect(content).toContain('pj.enqueued_at ASC');
    expect(content).toContain('pj.id ASC');
  });

  it('defines get_shop_priority_queue with non-preemption and dynamic ROW_NUMBER positioning', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.get_shop_priority_queue');
    expect(content).toContain('ROW_NUMBER() OVER');
    expect(content).toContain('PARTITION BY pj.shop_id');
    expect(content).toContain(
      "CASE WHEN pj.status IN ('printing'::public.job_status, 'claimed'::public.job_status, 'downloading'::public.job_status, 'submitted'::public.job_status) THEN 0"
    );
    expect(content).toContain('is_currently_executing');
  });
});
