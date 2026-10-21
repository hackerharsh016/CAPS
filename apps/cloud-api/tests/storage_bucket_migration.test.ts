import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migrations: Supabase Storage Bucket Provisioning (Migration 016)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000016_create_storage_bucket.sql'
  );

  it('migration 016 exists and contains storage bucket provisioning', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('INSERT INTO storage.buckets');
    expect(sql).toContain("'caps-private-documents'");
    expect(sql).toContain("'caps-documents'");
  });

  it('enforces privacy constraints on storage buckets (private, 50MB, allowed MIME types)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Must be private
    expect(sql).toContain('false, -- strictly private');
    // 50 MB
    expect(sql).toContain('52428800');
    // Allowlist MIME types
    expect(sql).toContain("'application/pdf'");
    expect(sql).toContain("'image/png'");
    expect(sql).toContain("'image/jpeg'");
  });

  it('configures RLS policies on storage.objects for service_role and authenticated users', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE POLICY p_storage_objects_service_role ON storage.objects');
    expect(sql).toContain('CREATE POLICY p_storage_objects_customer_upload ON storage.objects');
    expect(sql).toContain('CREATE POLICY p_storage_objects_customer_select ON storage.objects');
    expect(sql).toContain('CREATE POLICY p_storage_objects_customer_delete ON storage.objects');
    expect(sql).toContain('TO service_role');
    expect(sql).toContain('TO authenticated');
  });
});
