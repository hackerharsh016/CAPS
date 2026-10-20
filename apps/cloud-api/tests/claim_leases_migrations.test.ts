import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('Exclusive Agent Claim Leases & Recovery SQL Migrations', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const migrationFile = path.join(
    migrationsDir,
    '20261019000009_create_claim_leases_and_recovery.sql'
  );

  it('migration file exists in supabase/migrations/', () => {
    expect(fs.existsSync(migrationFile)).toBe(true);
  });

  it('defines the claim_job_lease function with security definer and validation checks', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.claim_job_lease');
    expect(content).toContain('p_job_id UUID');
    expect(content).toContain('p_agent_device_id UUID');
    expect(content).toContain('p_printer_id UUID');
    expect(content).toContain('SECURITY DEFINER');
    expect(content).toContain("v_job.status = 'pending_payment'::public.job_status");
    expect(content).toContain('Job % is pending payment; unpaid jobs cannot be claimed');
    expect(content).toContain("v_job.status != 'approved'::public.job_status");
    expect(content).toContain('Agent device % is revoked and cannot claim jobs');
    expect(content).toContain('Agent device shop % does not match job shop %');
  });

  it('performs atomic insertion into job_attempts and updates print_jobs to claimed', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('INSERT INTO public.job_attempts');
    expect(content).toContain('lease_token');
    expect(content).toContain('lease_expires_at');
    expect(content).toContain("'leased'::public.attempt_status");
    expect(content).toContain('UPDATE public.print_jobs');
    expect(content).toContain("SET status = 'claimed'::public.job_status");
    expect(content).toContain('claimed_at =');
    expect(content).toContain('claimed_by_agent_id =');
  });

  it('defines reconcile_expired_job_leases for automatic retry and review routing', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.reconcile_expired_job_leases');
    expect(content).toContain('ja.lease_expires_at < timezone');
    expect(content).toContain('UPDATE public.job_attempts');
    expect(content).toContain("SET status = 'failed'::public.attempt_status");
    expect(content).toContain("error_code = 'LEASE_EXPIRED'");
    expect(content).toContain('v_attempts_count < 3');
    expect(content).toContain("v_target_status := 'approved'::public.job_status");
    expect(content).toContain("v_target_status := 'requires_review'::public.job_status");
  });
});
