import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Realtime Signals & Reconciliation Migration 011', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    '../../supabase/migrations/20261019000011_create_realtime_events_and_reconciliation.sql'
  );

  // Fallback if running directly inside apps/cloud-api
  const actualPath = fs.existsSync(migrationPath)
    ? migrationPath
    : path.resolve(
        process.cwd(),
        'supabase/migrations/20261019000011_create_realtime_events_and_reconciliation.sql'
      );

  it('should exist and be readable', () => {
    expect(fs.existsSync(actualPath)).toBe(true);
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('should define public.queue_signals table with tenant isolation and immutability', () => {
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.queue_signals');
    expect(content).toContain('id BIGSERIAL PRIMARY KEY');
    expect(content).toContain('shop_id UUID NOT NULL REFERENCES public.shops(id)');
    expect(content).toContain('channel TEXT NOT NULL');
    expect(content).toContain('event_type TEXT NOT NULL');
    expect(content).toContain('payload JSONB NOT NULL DEFAULT');
    expect(content).toContain('prevent_queue_signals_mutation');
  });

  it('should create delta synchronization function get_missed_queue_signals', () => {
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content).toContain('FUNCTION public.get_missed_queue_signals');
    expect(content).toContain('p_shop_id UUID');
    expect(content).toContain('p_after_id BIGINT');
    expect(content).toContain('ORDER BY qs.id ASC');
  });

  it('should enforce zero sensitive document leakage check constraints and RLS', () => {
    const content = fs.readFileSync(actualPath, 'utf8');
    expect(content).toContain('chk_queue_signals_no_raw_doc');
    expect(content).toContain('service_role_key');
    expect(content).toContain('raw_document');
    expect(content).toContain('ENABLE ROW LEVEL SECURITY');
    expect(content).toContain('CREATE POLICY p_queue_signals_select_owner');
    expect(content).toContain('CREATE POLICY p_queue_signals_select_customer');
  });
});
