import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MockJobAttemptsRepository } from '../src/modules/attempts/attempts.repository.js';
import {
  MockJobEventsRepository,
  MockDocumentDeletionLogsRepository
} from '../src/modules/events/events.repository.js';
import type { CreateJobAttemptDto } from '../src/modules/attempts/attempts.types.js';
import type { CreateJobEventDto } from '../src/modules/events/events.types.js';

describe('Migration 004: Job Attempts, Events Ledger, and Privacy Schema DDL', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000004_create_attempts_events_privacy.sql'
  );
  const seedPath = path.join(repoRoot, 'supabase/seeds/demo_data.sql');

  it('migration 004 file exists and defines required tables and domain types', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Custom types
    expect(sql).toContain('CREATE TYPE public.attempt_status AS ENUM');
    expect(sql).toContain('CREATE TYPE public.actor_type AS ENUM');
    expect(sql).toContain('CREATE TYPE public.deleted_by_type AS ENUM');
    expect(sql).toContain('CREATE TYPE public.deletion_reason AS ENUM');

    // Tables
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.job_attempts');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.job_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.document_deletion_logs');
  });

  it('enforces idempotency key uniqueness, foreign keys, and active lease exclusivity', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Foreign keys
    expect(sql).toContain('REFERENCES public.print_jobs(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES public.printers(id) ON DELETE SET NULL');
    expect(sql).toContain('REFERENCES public.agent_devices(id) ON DELETE SET NULL');

    // Idempotency constraint
    expect(sql).toContain(
      'CONSTRAINT uq_job_attempts_idempotency UNIQUE (job_id, idempotency_key)'
    );

    // Active lease partial unique index
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_job_attempts_active_lease');
    expect(sql).toContain(
      "WHERE status IN ('leased'::public.attempt_status, 'downloading'::public.attempt_status, 'rendering'::public.attempt_status, 'submitted'::public.attempt_status, 'printing'::public.attempt_status)"
    );
  });

  it('enforces append-only immutability and privacy check constraints on job_events', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Sensitive data check constraint
    expect(sql).toContain('CONSTRAINT chk_job_events_no_sensitive_doc CHECK');
    expect(sql).toContain("metadata ? 'pdf_content'");
    expect(sql).toContain("metadata ? 'document_data'");
    expect(sql).toContain("metadata ? 'password'");

    // Ledger immutability trigger
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.prevent_modification_of_immutable_ledger'
    );
    expect(sql).toContain('CREATE TRIGGER trg_job_events_immutable');
    expect(sql).toContain('CREATE TRIGGER trg_document_deletion_logs_immutable');
  });

  it('defines privacy helper functions: get_expired_documents_for_cleanup and log_and_clear_document_storage', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_expired_documents_for_cleanup');
    expect(sql).toContain("document_expires_at <= timezone('utc'::text, now())");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.log_and_clear_document_storage');
    expect(sql).toContain("document_storage_key = '[PURGED]'");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.record_job_event');
  });

  it('enforces Row-Level Security (RLS) policies on attempts, events, and privacy logs', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // RLS enabled
    expect(sql).toContain('ALTER TABLE public.job_attempts ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.document_deletion_logs ENABLE ROW LEVEL SECURITY;');

    // Policies
    expect(sql).toContain('CREATE POLICY "job_attempts_select"');
    expect(sql).toContain('CREATE POLICY "job_attempts_insert"');
    expect(sql).toContain('CREATE POLICY "job_attempts_update"');
    expect(sql).toContain('CREATE POLICY "job_attempts_delete_admin_only"');
    expect(sql).toContain('CREATE POLICY "job_events_select"');
    expect(sql).toContain('CREATE POLICY "job_events_insert"');
    expect(sql).toContain('CREATE POLICY "document_deletion_logs_select"');
    expect(sql).toContain('CREATE POLICY "document_deletion_logs_insert_admin_only"');
  });

  it('demo seed data includes job attempts, events ledger records, and privacy deletion logs', () => {
    const sql = fs.readFileSync(seedPath, 'utf-8');

    expect(sql).toContain('77777777-7777-7777-7777-777777777773');
    expect(sql).toContain('idem_demo_attempt_completed_001');
    expect(sql).toContain('idem_demo_attempt_active_002');
    expect(sql).toContain('job_claimed_by_agent');
    expect(sql).toContain('print_job_completed');
    expect(sql).toContain('cccccccc-cccc-cccc-cccc-cccccccccccc');
    expect(sql).toContain('print_completed');
  });
});

describe('Job Attempts Repository Domain & Concurrency Logic', () => {
  it('creates an attempt and enforces duplicate attempt prevention with idempotency_key', async () => {
    const repo = new MockJobAttemptsRepository();
    const jobId = '11111111-2222-3333-4444-555555555555';

    const input: CreateJobAttemptDto = {
      job_id: jobId,
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      idempotency_key: 'claim-token-abc-001',
      status: 'leased'
    };

    const attempt = await repo.create(input);
    expect(attempt.id).toBeDefined();
    expect(attempt.job_id).toBe(jobId);
    expect(attempt.idempotency_key).toBe('claim-token-abc-001');
    expect(attempt.status).toBe('leased');

    // Duplicate attempt insertion with same idempotency key must throw
    await expect(repo.create(input)).rejects.toThrow(/Duplicate attempt detected/);
  });

  it('enforces single active lease exclusivity per job', async () => {
    const repo = new MockJobAttemptsRepository();
    const jobId = '22222222-3333-4444-5555-666666666666';

    // First attempt in active 'leased' status
    await repo.create({
      job_id: jobId,
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      idempotency_key: 'claim-token-1',
      status: 'leased'
    });

    // Second attempt for same job while first is still active must be rejected
    await expect(
      repo.create({
        job_id: jobId,
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
        idempotency_key: 'claim-token-2',
        status: 'downloading'
      })
    ).rejects.toThrow(/Active attempt already exists/);
  });

  it('allows a new attempt once the previous attempt has completed or failed', async () => {
    const repo = new MockJobAttemptsRepository();
    const jobId = '33333333-4444-5555-6666-777777777777';

    const firstAttempt = await repo.create({
      job_id: jobId,
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      idempotency_key: 'claim-token-attempt-1',
      status: 'leased'
    });

    // Transition first attempt to failed
    await repo.update(firstAttempt.id, {
      status: 'failed',
      error_code: 'PAPER_JAM',
      error_message: 'Paper jam in tray 1'
    });

    // Now a second attempt for the same job is permitted
    const secondAttempt = await repo.create({
      job_id: jobId,
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      idempotency_key: 'claim-token-attempt-2',
      status: 'leased'
    });

    expect(secondAttempt.id).not.toBe(firstAttempt.id);
    expect(secondAttempt.status).toBe('leased');
  });
});

describe('Job Events & Privacy Ledger Domain Logic', () => {
  it('appends events and rejects metadata containing raw document binary or credentials', async () => {
    const repo = new MockJobEventsRepository();
    const jobId = '44444444-5555-6666-7777-888888888888';

    // Valid event
    const validDto: CreateJobEventDto = {
      job_id: jobId,
      actor_type: 'agent',
      to_status: 'printing',
      event_name: 'spool_started',
      metadata: { spooler_job_id: 42, estimated_pages: 5 }
    };

    const event = await repo.create(validDto);
    expect(event.id).toBe(1);
    expect(event.metadata).toEqual({ spooler_job_id: 42, estimated_pages: 5 });

    // Privacy violation: attempt to store raw PDF bytes in audit event
    const sensitiveDto: CreateJobEventDto = {
      job_id: jobId,
      actor_type: 'agent',
      to_status: 'printing',
      event_name: 'doc_cached',
      metadata: { pdf_content: 'JVBERi0xLjQKJeLjz9MK...', filename: 'invoice.pdf' }
    };

    await expect(repo.create(sensitiveDto)).rejects.toThrow(
      /Privacy violation: event metadata contains sensitive key/
    );

    // Privacy violation: attempt to store password
    const passwordDto: CreateJobEventDto = {
      job_id: jobId,
      actor_type: 'customer',
      to_status: 'queued',
      event_name: 'auth_attempt',
      metadata: { password: 'secret_cleartext' }
    };

    await expect(repo.create(passwordDto)).rejects.toThrow(
      /Privacy violation: event metadata contains sensitive key/
    );
  });

  it('records document deletion audit log with deletion reason and origin', async () => {
    const deletionRepo = new MockDocumentDeletionLogsRepository();
    const jobId = '55555555-6666-7777-8888-999999999999';

    const log = await deletionRepo.create({
      job_id: jobId,
      document_storage_key: 'private/customer-doc.pdf',
      deleted_by: 'agent_post_spool',
      reason: 'print_completed'
    });

    expect(log.id).toBeDefined();
    expect(log.job_id).toBe(jobId);
    expect(log.deleted_by).toBe('agent_post_spool');
    expect(log.reason).toBe('print_completed');

    const retrieved = await deletionRepo.findByJobId(jobId);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.document_storage_key).toBe('private/customer-doc.pdf');
  });
});
