import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('Agent Pairing & Codes SQL Migrations', () => {
  const migrationsDir = path.resolve(__dirname, '../../../supabase/migrations');
  const migrationFile = path.join(
    migrationsDir,
    '20261019000010_create_agent_pairing_and_codes.sql'
  );

  it('migration file exists in supabase/migrations/', () => {
    expect(fs.existsSync(migrationFile)).toBe(true);
  });

  it('defines the agent_pairing_codes table with single-use flag and expiration', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE TABLE IF NOT EXISTS public.agent_pairing_codes');
    expect(content).toContain('shop_id UUID NOT NULL REFERENCES public.shops(id)');
    expect(content).toContain('code TEXT NOT NULL UNIQUE');
    expect(content).toContain('expires_at TIMESTAMPTZ NOT NULL');
    expect(content).toContain('is_used BOOLEAN NOT NULL DEFAULT false');
    expect(content).toContain('used_at TIMESTAMPTZ');
    expect(content).toContain('used_by_device_id UUID');
  });

  it('defines the generate_agent_pairing_code function with short-lived TTL', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.generate_agent_pairing_code');
    expect(content).toContain('p_shop_id UUID');
    expect(content).toContain('p_created_by UUID');
    expect(content).toContain('p_ttl_seconds INTEGER DEFAULT 600');
    expect(content).toContain('SECURITY DEFINER');
    expect(content).toContain("v_code := 'CP-'");
  });

  it('defines consume_agent_pairing_code to bind device credentials without leaking master secrets', () => {
    const content = fs.readFileSync(migrationFile, 'utf-8');

    expect(content).toContain('CREATE OR REPLACE FUNCTION public.consume_agent_pairing_code');
    expect(content).toContain('p_code TEXT');
    expect(content).toContain('p_device_fingerprint TEXT');
    expect(content).toContain('p_auth_token_hash TEXT');
    expect(content).toContain('SECURITY DEFINER');
    expect(content).toContain('v_pairing.is_used');
    expect(content).toContain('Pairing code % has already been consumed');
    expect(content).toContain('v_pairing.expires_at < v_now');
    expect(content).toContain('Pairing code % has expired');
    expect(content).toContain('INSERT INTO public.agent_devices');
    expect(content).toContain('SET is_used = true');
  });
});
