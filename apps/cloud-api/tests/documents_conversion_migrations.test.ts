import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migrations: Documents Storage & Trusted PDF Conversion (P06-M04-F01)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000013_create_documents_schema.sql'
  );

  it('migration file exists and contains valid DDL constructs', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE TYPE public.document_status AS ENUM');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.documents');
  });

  it('declares document_status enum with all required lifecycle states', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain("'upload_pending'");
    expect(sql).toContain("'converting'");
    expect(sql).toContain("'ready'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain("'purged'");
  });

  it('enforces MIME allowlist constraint for office and image formats', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CONSTRAINT chk_documents_allowed_mimes CHECK');
    expect(sql).toContain("'application/pdf'");
    expect(sql).toContain(
      "'application/vnd.openxmlformats-officedocument.wordprocessingml.document'"
    );
    expect(sql).toContain("'application/msword'");
    expect(sql).toContain(
      "'application/vnd.openxmlformats-officedocument.presentationml.presentation'"
    );
    expect(sql).toContain("'application/vnd.ms-powerpoint'");
    expect(sql).toContain("'image/jpeg'");
    expect(sql).toContain("'image/png'");
  });

  it('enforces maximum document size of 50 MB (52,428,800 bytes)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CONSTRAINT chk_documents_max_size CHECK');
    expect(sql).toContain('52428800');
  });

  it('creates query indexes for customer isolation and auto-purge sweeper', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_documents_customer_id ON public.documents(customer_id)'
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_documents_status ON public.documents(status)'
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON public.documents(expires_at)'
    );
  });

  it('configures updated_at trigger and enables Row Level Security (RLS)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE TRIGGER trg_documents_updated_at');
    expect(sql).toContain('ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY p_documents_select_customer ON public.documents');
    expect(sql).toContain('CREATE POLICY p_documents_insert_customer ON public.documents');
    expect(sql).toContain('CREATE POLICY p_documents_update_customer ON public.documents');
    expect(sql).toContain('CREATE POLICY p_documents_service_all ON public.documents');
  });
});
