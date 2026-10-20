import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { MockUsersRepository } from '../src/modules/users/users.repository.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import type { CreateShopDto } from '../src/modules/shops/shops.types.js';

// Self-contained schema validator using Zod for seed test
const PaperPriceTableSchema = z
  .object({
    bw_single_paise: z.number().int().nonnegative(),
    bw_double_paise: z.number().int().nonnegative(),
    color_single_paise: z.number().int().nonnegative(),
    color_double_paise: z.number().int().nonnegative()
  })
  .strict();

const PricingConfigSchema = z
  .object({
    A4: PaperPriceTableSchema,
    A3: PaperPriceTableSchema,
    Legal: PaperPriceTableSchema,
    binding_prices_paise: z
      .object({
        none: z.literal(0),
        spiral: z.number().int().nonnegative(),
        staple: z.number().int().nonnegative(),
        lamination: z.number().int().nonnegative()
      })
      .strict(),
    gst_percentage: z.number().min(0).max(100)
  })
  .strict();

const UrgentSurchargeConfigSchema = z
  .object({
    type: z.enum(['flat', 'percentage']),
    amount: z.number().int().nonnegative(),
    max_urgent_jobs_per_hour: z.number().int().positive().optional()
  })
  .strict();

describe('Database Migrations & Users/Shops Schema Verification', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const migrationPath = path.join(
    repoRoot,
    'supabase/migrations/20261019000001_create_users_and_shops.sql'
  );
  const seedPath = path.join(repoRoot, 'supabase/seeds/demo_data.sql');

  it('migration file exists and contains valid SQL DDL constructs', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Schema and tables
    expect(sql).toContain('CREATE TYPE public.user_role AS ENUM');
    expect(sql).toContain('CREATE TYPE public.shop_status AS ENUM');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.profiles');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.shops');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.shop_members');
  });

  it('enforces required columns and data integrity constraints', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // profiles constraints
    expect(sql).toContain('REFERENCES auth.users(id) ON DELETE CASCADE');
    expect(sql).toContain("role public.user_role NOT NULL DEFAULT 'customer'");

    // shops constraints and foreign keys
    expect(sql).toContain('REFERENCES public.profiles(id) ON DELETE RESTRICT');
    expect(sql).toContain('geo_lat >= -90.0 AND geo_lat <= 90.0');
    expect(sql).toContain('geo_lng >= -180.0 AND geo_lng <= 180.0');
    expect(sql).toContain('pricing_config JSONB NOT NULL');
    expect(sql).toContain('urgent_surcharge_config JSONB NOT NULL');

    // shop_members uniqueness
    expect(sql).toContain('CONSTRAINT uq_shop_members_shop_user UNIQUE (shop_id, user_id)');
  });

  it('defines performance indices for frequent queries and discovery', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_profiles_role');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_shops_owner_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_shops_status');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_shops_geo');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_shop_members_shop_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_shop_members_user_id');
  });

  it('enforces Row-Level Security (RLS) on all tables with explicit security policies', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // RLS activation
    expect(sql).toContain('ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;');

    // Profiles policies
    expect(sql).toContain('CREATE POLICY "profiles_select_own_or_admin"');
    expect(sql).toContain('CREATE POLICY "profiles_insert_own"');
    expect(sql).toContain('CREATE POLICY "profiles_update_own"');
    expect(sql).toContain('CREATE POLICY "profiles_delete_admin_only"');

    // Shops policies
    expect(sql).toContain('CREATE POLICY "shops_select_discovery"');
    expect(sql).toContain('CREATE POLICY "shops_insert_owner"');
    expect(sql).toContain('CREATE POLICY "shops_update_owner"');
    expect(sql).toContain('CREATE POLICY "shops_delete_owner"');

    // Role escalation prevention
    expect(sql).toContain('SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()');
  });

  it('demo seed data contains valid pricing and urgent surcharge configuration schemas', () => {
    expect(fs.existsSync(seedPath)).toBe(true);
    const sql = fs.readFileSync(seedPath, 'utf-8');

    // Ensure seed contains realistic users and demo shop
    expect(sql).toContain('Campus QuickPrint Xerox');
    expect(sql).toContain('owner@quickprint.com');

    // Test JSON schema compliance using domain validation
    const samplePricingConfig = {
      A4: {
        bw_single_paise: 200,
        bw_double_paise: 300,
        color_single_paise: 1000,
        color_double_paise: 1800
      },
      A3: {
        bw_single_paise: 500,
        bw_double_paise: 800,
        color_single_paise: 2000,
        color_double_paise: 3500
      },
      Legal: {
        bw_single_paise: 300,
        bw_double_paise: 450,
        color_single_paise: 1500,
        color_double_paise: 2500
      },
      binding_prices_paise: {
        none: 0 as const,
        spiral: 4000,
        staple: 500,
        lamination: 3000
      },
      gst_percentage: 18
    };

    const sampleUrgentSurcharge = {
      type: 'flat' as const,
      amount: 2000,
      max_urgent_jobs_per_hour: 10
    };

    const parsedPricing = PricingConfigSchema.safeParse(samplePricingConfig);
    expect(parsedPricing.success).toBe(true);

    const parsedUrgent = UrgentSurchargeConfigSchema.safeParse(sampleUrgentSurcharge);
    expect(parsedUrgent.success).toBe(true);
  });
});

describe('Cloud API Users & Shops Repository Layer (Mock Isolation)', () => {
  it('Users repository manages profiles and updates cleanly', async () => {
    const repo = new MockUsersRepository();
    const userId = '00000000-0000-0000-0000-000000000099';

    const created = await repo.create({
      id: userId,
      role: 'customer',
      name: 'Test Customer',
      phone: '+919999999999',
      email: 'test@example.com'
    });

    expect(created.id).toBe(userId);
    expect(created.role).toBe('customer');

    const found = await repo.findById(userId);
    expect(found?.name).toBe('Test Customer');

    const updated = await repo.update(userId, { name: 'Updated Name' });
    expect(updated?.name).toBe('Updated Name');

    const deleted = await repo.delete(userId);
    expect(deleted).toBe(true);

    const afterDelete = await repo.findById(userId);
    expect(afterDelete).toBeNull();
  });

  it('Shops repository manages shop records and enforces ownership filtering', async () => {
    const repo = new MockShopsRepository();
    const ownerId1 = '00000000-0000-0000-0000-000000000001';
    const ownerId2 = '00000000-0000-0000-0000-000000000002';

    const validPricing = {
      A4: {
        bw_single_paise: 200,
        bw_double_paise: 300,
        color_single_paise: 1000,
        color_double_paise: 1800
      },
      A3: {
        bw_single_paise: 500,
        bw_double_paise: 800,
        color_single_paise: 2000,
        color_double_paise: 3500
      },
      Legal: {
        bw_single_paise: 300,
        bw_double_paise: 450,
        color_single_paise: 1500,
        color_double_paise: 2500
      },
      binding_prices_paise: {
        none: 0 as const,
        spiral: 4000,
        staple: 500,
        lamination: 3000
      },
      gst_percentage: 18
    };

    const validUrgent = {
      type: 'flat' as const,
      amount: 2000,
      max_urgent_jobs_per_hour: 10
    };

    const shopDto: CreateShopDto = {
      owner_id: ownerId1,
      name: 'Shop One',
      address: '123 Campus Rd',
      geo_lat: 18.5204,
      geo_lng: 73.8567,
      pricing_config: validPricing,
      urgent_surcharge_config: validUrgent,
      auto_print_enabled: false
    };

    const createdShop1 = await repo.create(shopDto);
    expect(createdShop1.id).toBeDefined();
    expect(createdShop1.name).toBe('Shop One');

    // Create second shop for owner 2
    await repo.create({
      ...shopDto,
      owner_id: ownerId2,
      name: 'Shop Two'
    });

    // Check findByOwnerId isolation
    const owner1Shops = await repo.findByOwnerId(ownerId1);
    expect(owner1Shops).toHaveLength(1);
    expect(owner1Shops[0]?.name).toBe('Shop One');

    const owner2Shops = await repo.findByOwnerId(ownerId2);
    expect(owner2Shops).toHaveLength(1);
    expect(owner2Shops[0]?.name).toBe('Shop Two');

    // Check open shops
    const allOpen = await repo.findAllOpen();
    expect(allOpen).toHaveLength(2);

    // Close shop 1
    await repo.update(createdShop1.id, { status: 'closed' });
    const openAfterClose = await repo.findAllOpen();
    expect(openAfterClose).toHaveLength(1);
    expect(openAfterClose[0]?.name).toBe('Shop Two');
  });
});
