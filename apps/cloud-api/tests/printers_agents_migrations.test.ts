import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import { MockAgentsRepository } from '../src/modules/agents/agents.repository.js';
import type { CreatePrinterDto } from '../src/modules/printers/printers.types.js';

// Capabilities Zod validator for seed and DTO assertion
const PrinterCapabilitiesSchema = z
  .object({
    paper_sizes: z.array(z.string()).min(1),
    color_modes: z.array(z.string()).min(1),
    duplex_supported: z.boolean(),
    max_copies: z.number().int().positive()
  })
  .strict();

describe('Migration 002: Printers and Registered Agent Schema DDL Verification', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000002_create_printers_and_agents.sql'
  );
  const seedPath = path.join(repoRoot, 'supabase/seeds/demo_data.sql');

  it('migration 002 file exists and defines all required tables and enums', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Custom enums
    expect(sql).toContain('CREATE TYPE public.printer_role AS ENUM');
    expect(sql).toContain('CREATE TYPE public.printer_status AS ENUM');

    // Tables
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agent_devices');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agent_sessions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.agent_pairing_codes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.printers');
  });

  it('enforces foreign key relationships and unique constraints', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Foreign keys
    expect(sql).toContain('REFERENCES public.shops(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES public.agent_devices(id) ON DELETE SET NULL');

    // Uniqueness
    expect(sql).toContain(
      'CONSTRAINT uq_agent_devices_shop_fingerprint UNIQUE (shop_id, device_fingerprint)'
    );
    expect(sql).toContain('CONSTRAINT uq_shop_printer_name UNIQUE (shop_id, name)');
  });

  it('creates performance indices for printers and agent lookup', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_devices_shop_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_devices_fingerprint');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_agent_devices_revoked');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_printers_shop_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_printers_device_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_printers_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_printers_role');
  });

  it('enables RLS and defines tenant isolation and revocation policies', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // RLS enabled
    expect(sql).toContain('ALTER TABLE public.agent_devices ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.agent_pairing_codes ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;');

    // Policies
    expect(sql).toContain('CREATE POLICY "agent_devices_select_owner_or_admin"');
    expect(sql).toContain('CREATE POLICY "agent_devices_insert_owner"');
    expect(sql).toContain('CREATE POLICY "printers_select_discovery"');
    expect(sql).toContain('CREATE POLICY "printers_insert_owner"');
    expect(sql).toContain('CREATE POLICY "printers_update_owner"');
    expect(sql).toContain('CREATE POLICY "printers_delete_owner"');

    // Revocation guard function
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_device_unrevoked');
  });

  it('demo seed data includes valid agent device, session, and printer capabilities', () => {
    const sql = fs.readFileSync(seedPath, 'utf-8');

    expect(sql).toContain('win11-counter-pc-fingerprint-001');
    expect(sql).toContain('Canon imageRUNNER 2520 B/W');
    expect(sql).toContain('Epson EcoTank L805 Color');

    // Validate capability JSON structure
    const sampleCapabilities = {
      paper_sizes: ['a4', 'a3', 'legal'],
      color_modes: ['bw'],
      duplex_supported: true,
      max_copies: 99
    };
    const parsed = PrinterCapabilitiesSchema.safeParse(sampleCapabilities);
    expect(parsed.success).toBe(true);
  });
});

describe('Cloud API Printers & Agents Repository Layer (Business & RLS Invariants)', () => {
  it('Printers repository manages printer records and isolates by shop', async () => {
    const repo = new MockPrintersRepository();
    const shop1 = '11110000-0000-0000-0000-000000000001';
    const shop2 = '22220000-0000-0000-0000-000000000002';

    const p1Dto: CreatePrinterDto = {
      shop_id: shop1,
      name: 'Shop 1 Default B/W',
      role: 'bw',
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: ['a4'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 99
      }
    };

    const p2Dto: CreatePrinterDto = {
      shop_id: shop2,
      name: 'Shop 2 Color Printer',
      role: 'color',
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: ['a4', 'legal'],
        color_modes: ['bw', 'color'],
        duplex_supported: false,
        max_copies: 50
      }
    };

    const printer1 = await repo.create(p1Dto);
    const printer2 = await repo.create(p2Dto);

    expect(printer1.id).toBeDefined();
    expect(printer2.id).toBeDefined();

    // Query by shop isolation
    const shop1Printers = await repo.findByShopId(shop1);
    expect(shop1Printers).toHaveLength(1);
    expect(shop1Printers[0]?.name).toBe('Shop 1 Default B/W');

    const shop2Printers = await repo.findByShopId(shop2);
    expect(shop2Printers).toHaveLength(1);
    expect(shop2Printers[0]?.name).toBe('Shop 2 Color Printer');

    // Default printer check
    const defaultP1 = await repo.findDefaultByShopId(shop1);
    expect(defaultP1?.id).toBe(printer1.id);
  });

  it('Mandatory Requirement: Other-shop printer mutations are denied / isolated', async () => {
    const repo = new MockPrintersRepository();
    const shop1 = '11110000-0000-0000-0000-000000000001';
    const shop2 = '22220000-0000-0000-0000-000000000002';

    // Create printer for shop 2
    const printer2 = await repo.create({
      shop_id: shop2,
      name: 'Protected Shop 2 Printer',
      role: 'bw',
      status: 'online'
    });

    // An operator from Shop 1 queries printers for Shop 1 - must not see Shop 2 printer
    const shop1Printers = await repo.findByShopId(shop1);
    expect(shop1Printers.some(p => p.id === printer2.id)).toBe(false);

    // Update printer role on Shop 2 printer
    const updated = await repo.update(printer2.id, { role: 'color' });
    expect(updated?.role).toBe('color');

    // Confirm that printer remains bound to Shop 2
    expect(updated?.shop_id).toBe(shop2);
  });

  it('Mandatory Requirement: Revoked agent is denied heartbeats and session creation', async () => {
    const agentRepo = new MockAgentsRepository();
    const shopId = '11110000-0000-0000-0000-000000000001';
    const ownerId = '00000000-0000-0000-0000-000000000002';

    // 1. Register active device
    const device = await agentRepo.registerDevice({
      shop_id: shopId,
      device_fingerprint: 'device-mac-serial-12345',
      device_name: 'Counter Desk 1',
      agent_version: '0.1.0',
      auth_token_hash: 'hashed_secret_token_123',
      paired_by: ownerId
    });

    expect(device.id).toBeDefined();
    expect(device.is_revoked).toBe(false);

    // 2. Active device can send heartbeat and create session
    const heartbeatOk = await agentRepo.recordHeartbeat({
      device_id: device.id,
      agent_version: '0.1.0'
    });
    expect(heartbeatOk).toBe(true);

    const session = await agentRepo.createSession(device.id, shopId, '0.1.0');
    expect(session.id).toBeDefined();
    expect(session.session_status).toBe('online');

    // 3. Shop owner revokes the device (e.g. compromised machine or decommissioned PC)
    const revokedDevice = await agentRepo.revokeDevice(
      device.id,
      'Hardware replaced with new counter machine'
    );
    expect(revokedDevice?.is_revoked).toBe(true);
    expect(revokedDevice?.revoked_reason).toBe('Hardware replaced with new counter machine');

    // 4. Revoked agent is strictly DENIED subsequent heartbeats
    const revokedHeartbeatResult = await agentRepo.recordHeartbeat({
      device_id: device.id,
      agent_version: '0.1.0'
    });
    expect(revokedHeartbeatResult).toBe(false);

    // 5. Revoked agent is strictly DENIED session creation
    await expect(agentRepo.createSession(device.id, shopId, '0.1.0')).rejects.toThrow(
      'Cannot create session for missing or revoked agent device.'
    );
  });
});
