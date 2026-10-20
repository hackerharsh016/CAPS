import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migrations: Document Retention & Privacy Audit Cleanup (P06-M04-F02)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000014_create_document_retention_and_audit_cleanup.sql'
  );

  it('migration file exists and contains valid SQL DDL constructs', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('ALTER TABLE public.document_deletion_logs');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_expired_jobs_for_cleanup');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_expired_documents_for_cleanup');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.log_and_purge_document');
  });

  it('extends document_deletion_logs to support standalone documents', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('ALTER COLUMN job_id DROP NOT NULL');
    expect(sql).toContain('ADD COLUMN document_id UUID REFERENCES public.documents(id)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_document_deletion_logs_doc_id');
  });

  it('declares stored procedure for sweeping expired print jobs with TTL and 30m terminal rules', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('FUNCTION public.get_expired_jobs_for_cleanup');
    expect(sql).toContain("document_storage_key != '[PURGED]'");
    expect(sql).toContain('document_expires_at <= timezone');
    expect(sql).toContain("'completed'::public.job_status");
    expect(sql).toContain("'failed'::public.job_status");
    expect(sql).toContain("'cancelled'::public.job_status");
    expect(sql).toContain('p_terminal_retention_minutes');
  });

  it('declares stored procedure for sweeping standalone document records', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('FUNCTION public.get_expired_documents_for_cleanup');
    expect(sql).toContain("status <> 'purged'::public.document_status");
    expect(sql).toContain('expires_at <= timezone');
  });

  it('declares atomic procedure for document purging with permanent deletion audit ledger', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('FUNCTION public.log_and_purge_document');
    expect(sql).toContain("status = 'purged'::public.document_status");
    expect(sql).toContain('INSERT INTO public.document_deletion_logs');
  });
});
