import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migrations: Queue Priority & ETA Stored Procedures (P06-M02-F01)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000005_create_queue_priority_and_eta.sql'
  );

  it('migration file exists and contains valid SQL DDL constructs', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_shop_queue(p_shop_id UUID)');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.recalculate_shop_queue_positions(p_shop_id UUID)'
    );
  });

  it('enforces non-preemption of currently executing jobs', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Currently executing jobs (printing, claimed, downloading, submitted) receive rank 0
    expect(sql).toContain(
      "pj.status IN ('printing'::public.job_status, 'claimed'::public.job_status, 'downloading'::public.job_status, 'submitted'::public.job_status)"
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

  it('provides an atomic procedure for recalculating queue positions', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('UPDATE public.print_jobs target');
    expect(sql).toContain('SET queue_position = ranked_jobs.new_pos');
  });
});
