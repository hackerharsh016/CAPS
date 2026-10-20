import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Privacy Retention & Unresolved Job Migration 012', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    '../../supabase/migrations/20261019000012_create_privacy_cleanup_and_unresolved_rpc.sql'
  );

  const actualPath = fs.existsSync(migrationPath)
    ? migrationPath
    : path.resolve(
        process.cwd(),
        'supabase/migrations/20261019000012_create_privacy_cleanup_and_unresolved_rpc.sql'
      );

  it('should exist and be readable', () => {
    expect(fs.existsSync(actualPath)).toBe(true);
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('should create performance index on print_jobs document_expires_at', () => {
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content).toContain('CREATE INDEX IF NOT EXISTS idx_print_jobs_document_expiry');
    expect(content).toContain('ON public.print_jobs (document_expires_at)');
  });

  it('should create privacy retention query function get_expired_privacy_jobs', () => {
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content).toContain('FUNCTION public.get_expired_privacy_jobs');
    expect(content).toContain('document_storage_key');
    expect(content).toContain('document_deletion_logs');
    expect(content).toContain('completed');
    expect(content).toContain('cancelled');
  });

  it('should create atomic resolve_unresolved_job RPC for requires_review reconciliation', () => {
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content).toContain('FUNCTION public.resolve_unresolved_job');
    expect(content).toContain('requires_review');
    expect(content).toContain('UNRESOLVED_JOB_RESOLVED');
    expect(content).toContain('retry');
    expect(content).toContain('cancel');
    expect(content).toContain('mark_completed');
  });
});
