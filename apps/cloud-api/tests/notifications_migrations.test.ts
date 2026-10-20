import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Database Migrations: Notifications Schema Verification (P06-M03-F01)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000007_create_notifications_schema.sql'
  );

  it('migration file exists and contains valid SQL DDL constructs', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.user_fcm_tokens');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.notification_outbox');
  });

  it('enforces deduplication unique constraints and event type domain validation', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('dedupe_key TEXT NOT NULL UNIQUE');
    expect(sql).toContain(
      "event_type IN ('job_queued', 'job_printing', 'job_ready', 'job_failed', 'job_cancelled')"
    );
    expect(sql).toContain(
      "status IN ('pending', 'delivered', 'failed', 'duplicate_skipped', 'revoked')"
    );
  });

  it('enforces token registration uniqueness and performance indices', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain(
      'CONSTRAINT uq_user_fcm_tokens_user_device UNIQUE (user_id, device_token)'
    );
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_user_fcm_tokens_user_active');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_id');
  });

  it('activates Row-Level Security (RLS) on notification tables', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('ALTER TABLE public.user_fcm_tokens ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY user_fcm_tokens_owner_select');
    expect(sql).toContain('CREATE POLICY notification_outbox_owner_select');
  });
});
