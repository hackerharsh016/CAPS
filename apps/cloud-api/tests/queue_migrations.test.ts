import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migrations & Two-Tier Priority Queue Ordering (P06-M02-F01)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000005_create_queue_priority_and_eta.sql'
  );

  it('migration file exists and defines queue functions', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_shop_queue');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.recalculate_shop_queue_positions');
  });

  it('enforces non-preemption of currently executing jobs', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Currently executing jobs (printing, claimed, downloading) receive rank 0
    expect(sql).toContain(
      "pj.status IN ('printing'::public.job_status, 'claimed'::public.job_status, 'downloading'::public.job_status)"
    );
    expect(sql).toContain('is_currently_executing');
  });

  it('enforces two-tier priority queue ordering (Urgent FIFO ahead of Flexible FIFO)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Urgent tier rank 0 before Flexible tier rank 1
    expect(sql).toContain(
      "(CASE pj.priority_tier WHEN 'urgent'::public.priority_tier THEN 0 ELSE 1 END)"
    );
    expect(sql).toContain('pj.enqueued_at ASC');
    expect(sql).toContain('pj.id ASC');
  });

  it('recalculates queue positions dynamically for active queued jobs', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('recalculate_shop_queue_positions');
    expect(sql).toContain("pj.status = 'queued'::public.job_status");
    expect(sql).toContain('ROW_NUMBER() OVER');
  });
});
