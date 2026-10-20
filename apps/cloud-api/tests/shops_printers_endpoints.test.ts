import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { createTestJwt, SupabaseJwtVerifier } from '../src/plugins/auth.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockPrintersRepository } from '../src/modules/printers/printers.repository.js';
import type { FastifyInstance } from 'fastify';

describe('Cloud API — Shop and Printer Domain Endpoints (P03-M02-F02)', () => {
  const jwtSecret = 'test-jwt-secret-for-shops-and-printers-domain-32-chars';
  const env = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
    SUPABASE_JWT_SECRET: jwtSecret
  });

  let app: FastifyInstance;
  let shopsRepo: MockShopsRepository;
  let printersRepo: MockPrintersRepository;

  // Identity tokens
  const owner1Id = '11111111-1111-1111-1111-111111111111';
  const owner1Token = createTestJwt(
    { sub: owner1Id, role: 'shop_owner', app_metadata: { role: 'shop_owner' } },
    jwtSecret
  );

  const owner2Id = '22222222-2222-2222-2222-222222222222';
  const owner2Token = createTestJwt(
    { sub: owner2Id, role: 'shop_owner', app_metadata: { role: 'shop_owner' } },
    jwtSecret
  );

  const customerId = '33333333-3333-3333-3333-333333333333';
  const customerToken = createTestJwt(
    { sub: customerId, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  const adminId = '44444444-4444-4444-4444-444444444444';
  const adminToken = createTestJwt(
    { sub: adminId, role: 'admin', app_metadata: { role: 'admin' } },
    jwtSecret
  );

  const agentId = '55555555-5555-5555-5555-555555555555';
  const agentToken = createTestJwt(
    { sub: agentId, role: 'agent', app_metadata: { role: 'agent' } },
    jwtSecret
  );

  const samplePricing = {
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
      color_single_paise: 1200,
      color_double_paise: 2200
    },
    binding_prices_paise: {
      none: 0 as const,
      spiral: 3000,
      staple: 500,
      lamination: 2000
    },
    gst_percentage: 18
  };

  const sampleSurcharge = {
    type: 'flat' as const,
    amount: 5000,
    max_urgent_jobs_per_hour: 5
  };

  let seededShop1Id: string;
  let seededShop2Id: string;
  let seededPrinter1Id: string;

  beforeAll(async () => {
    shopsRepo = new MockShopsRepository();
    printersRepo = new MockPrintersRepository();

    app = buildApp({
      env,
      tokenVerifier: new SupabaseJwtVerifier(jwtSecret),
      shopsRepo,
      printersRepo
    });

    // Seed shop 1 for owner 1
    const s1 = await shopsRepo.create({
      owner_id: owner1Id,
      name: 'QuickPrint Express',
      address: '123 College Road, Campus North',
      geo_lat: 18.5204,
      geo_lng: 73.8567,
      pricing_config: samplePricing,
      urgent_surcharge_config: sampleSurcharge,
      auto_print_enabled: true
    });
    seededShop1Id = s1.id;

    // Seed shop 2 for owner 2
    const s2 = await shopsRepo.create({
      owner_id: owner2Id,
      name: 'Campus Xerox Hub',
      address: '456 University Avenue, West Gate',
      geo_lat: 18.5289,
      geo_lng: 73.8744,
      pricing_config: samplePricing,
      urgent_surcharge_config: sampleSurcharge,
      auto_print_enabled: false
    });
    seededShop2Id = s2.id;

    // Seed printer for shop 1
    const p1 = await printersRepo.create({
      shop_id: seededShop1Id,
      name: 'HP LaserJet Enterprise M608',
      role: 'bw',
      status: 'online',
      is_default: true,
      capabilities: {
        paper_sizes: ['a4', 'legal'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      }
    });
    seededPrinter1Id = p1.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Shop Discovery & Query Pagination (GET /api/v1/shops)', () => {
    it('allows public customer discovery with default pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shops'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
      expect(body.pagination.total).toBeGreaterThanOrEqual(2);
      expect(body.pagination.total_pages).toBeDefined();
    });

    it('respects query pagination parameters (limit and page)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shops?page=1&limit=1'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBe(1);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(1);
      expect(body.pagination.total_pages).toBeGreaterThanOrEqual(2);
    });

    it('filters shops by search term', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shops?search=QuickPrint'
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe('QuickPrint Express');
    });

    it('rejects invalid pagination input with 400 INVALID_PAYLOAD', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shops?page=-1'
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('Shop Details & Pricing Capabilities (GET /api/v1/shops/:id)', () => {
    it('returns public shop profile and authoritative pricing table', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${seededShop1Id}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.id).toBe(seededShop1Id);
      expect(body.data.name).toBe('QuickPrint Express');
      expect(body.data.pricing_config.A4.bw_single_paise).toBe(200);
      expect(body.data.urgent_surcharge_config.type).toBe('flat');
    });

    it('returns 404 NOT_FOUND for non-existent shop ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${nonExistentId}`
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('not found');
    });
  });

  describe('Shop Onboarding (POST /api/v1/shops)', () => {
    it('denies unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/shops',
        payload: {
          name: 'Unauthorized Shop',
          address: '789 Central Ave',
          geo_lat: 18.5,
          geo_lng: 73.8,
          pricing_config: samplePricing,
          urgent_surcharge_config: sampleSurcharge
        }
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    });

    it('denies customer role with 403 FORBIDDEN_ROLE', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/shops',
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          name: 'Customer Attempt Shop',
          address: '789 Central Ave',
          geo_lat: 18.5,
          geo_lng: 73.8,
          pricing_config: samplePricing,
          urgent_surcharge_config: sampleSurcharge
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ROLE');
    });

    it('successfully onboards new shop for shop_owner role', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/shops',
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: {
          name: 'Owner1 Second Shop',
          address: '888 Main Boulevard, Tech Park',
          geo_lat: 18.5412,
          geo_lng: 73.8291,
          pricing_config: samplePricing,
          urgent_surcharge_config: sampleSurcharge,
          auto_print_enabled: false
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.owner_id).toBe(owner1Id);
      expect(body.data.name).toBe('Owner1 Second Shop');
      expect(body.data.status).toBe('open');
    });

    it('rejects invalid shop onboarding payload with 400 INVALID_PAYLOAD', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/shops',
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: {
          name: 'S', // Too short (min 2)
          address: '123'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_PAYLOAD');
      expect(body.error.details).toBeDefined();
    });
  });

  describe('Shop Update & Tenant Isolation (PATCH /api/v1/shops/:id)', () => {
    it('denies customer role from updating any shop with 403 FORBIDDEN_ROLE', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { name: 'Customer Hacked Shop' }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ROLE');
    });

    it('denies another shop owner from updating a shop they do not own with 403 FORBIDDEN', async () => {
      // Owner 2 attempts to modify Shop 1 (owned by Owner 1)
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}`,
        headers: { authorization: `Bearer ${owner2Token}` },
        payload: { name: 'Malicious Name Takeover' }
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('do not own shop');
    });

    it('allows verified shop owner to update their own shop', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}`,
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: {
          name: 'QuickPrint Premier Station',
          auto_print_enabled: true
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.id).toBe(seededShop1Id);
      expect(body.data.name).toBe('QuickPrint Premier Station');
      expect(body.data.auto_print_enabled).toBe(true);
    });

    it('allows admin to update any shop across tenants', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'closed' }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('closed');
    });

    it('returns 404 NOT_FOUND when updating non-existent shop', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/shops/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: { name: 'Ghost Shop' }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('Printer Discovery & Capability Lookup (GET /api/v1/shops/:shop_id/printers)', () => {
    it('returns public list of printers with capabilities for a shop', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${seededShop1Id}/printers`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data[0].id).toBe(seededPrinter1Id);
      expect(body.data[0].capabilities.paper_sizes).toContain('a4');
      expect(body.data[0].capabilities.duplex_supported).toBe(true);
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 NOT_FOUND when querying printers for non-existent shop', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/shops/00000000-0000-0000-0000-000000000000/printers'
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('returns specific printer details by ID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.id).toBe(seededPrinter1Id);
      expect(body.data.name).toBe('HP LaserJet Enterprise M608');
      expect(body.data.role).toBe('bw');
    });

    it('returns 404 NOT_FOUND if printer belongs to another shop (cross-tenant scoping)', async () => {
      // Querying Printer 1 under Shop 2
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${seededShop2Id}/printers/${seededPrinter1Id}`
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('Printer Registration & Assignment (POST /api/v1/shops/:shop_id/printers)', () => {
    it('denies customer from registering printer with 403 FORBIDDEN_ROLE', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${seededShop1Id}/printers`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: {
          name: 'Rogue Customer Printer',
          role: 'color'
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ROLE');
    });

    it('denies another shop owner from assigning printer to a shop they do not own with 403 FORBIDDEN', async () => {
      // Owner 2 attempts to register printer in Shop 1
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${seededShop1Id}/printers`,
        headers: { authorization: `Bearer ${owner2Token}` },
        payload: {
          name: 'Canon Color ImageRunner C3226',
          role: 'color',
          is_default: true
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
      expect(response.json().error.message).toContain('do not own shop');
    });

    it('allows verified shop owner to assign and configure a printer', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${seededShop1Id}/printers`,
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: {
          name: 'Epson WorkForce Pro WF-C5790',
          role: 'color',
          status: 'online',
          is_default: true,
          capabilities: {
            paper_sizes: ['a4', 'a3', 'legal'],
            color_modes: ['bw', 'color'],
            duplex_supported: true,
            max_copies: 50
          }
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.id).toBeDefined();
      expect(body.data.shop_id).toBe(seededShop1Id);
      expect(body.data.name).toBe('Epson WorkForce Pro WF-C5790');
      expect(body.data.is_default).toBe(true);

      // Verify previous printer in same shop was un-defaulted
      const prevPrinter = await printersRepo.findById(seededPrinter1Id);
      expect(prevPrinter?.is_default).toBe(false);
    });

    it('rejects invalid printer registration payload with 400 INVALID_PAYLOAD', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${seededShop1Id}/printers`,
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: {
          name: '', // Empty name
          role: 'invalid_role'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('Printer Updates & Desktop Agent Sync (PATCH /api/v1/shops/:shop_id/printers/:printer_id)', () => {
    it('denies customer from updating printer with 403 FORBIDDEN_ROLE', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`,
        headers: { authorization: `Bearer ${customerToken}` },
        payload: { status: 'offline' }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN_ROLE');
    });

    it('denies another shop owner from updating printer with 403 FORBIDDEN', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`,
        headers: { authorization: `Bearer ${owner2Token}` },
        payload: { status: 'error' }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    });

    it('allows Desktop Agent to update printer status (e.g. online telemetry)', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`,
        headers: { authorization: `Bearer ${agentToken}` },
        payload: { status: 'online' }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('online');
    });

    it('allows verified shop owner to update printer capabilities', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`,
        headers: { authorization: `Bearer ${owner1Token}` },
        payload: {
          name: 'HP LaserJet Enterprise M608 (Duplex Enabled)'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.name).toBe('HP LaserJet Enterprise M608 (Duplex Enabled)');
    });
  });

  describe('Printer Deletion (DELETE /api/v1/shops/:shop_id/printers/:printer_id)', () => {
    it('denies customer or unauthorized owner from deleting printer with 403', async () => {
      const resCustomer = await app.inject({
        method: 'DELETE',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`,
        headers: { authorization: `Bearer ${customerToken}` }
      });
      expect(resCustomer.statusCode).toBe(403);

      const resOtherOwner = await app.inject({
        method: 'DELETE',
        url: `/api/v1/shops/${seededShop1Id}/printers/${seededPrinter1Id}`,
        headers: { authorization: `Bearer ${owner2Token}` }
      });
      expect(resOtherOwner.statusCode).toBe(403);
    });

    it('allows verified shop owner to delete their printer', async () => {
      // First create a temporary printer to delete
      const tempPrinter = await printersRepo.create({
        shop_id: seededShop1Id,
        name: 'Temporary Canon LBP2900',
        role: 'bw'
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/shops/${seededShop1Id}/printers/${tempPrinter.id}`,
        headers: { authorization: `Bearer ${owner1Token}` }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.deleted).toBe(true);

      // Verify printer is gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${seededShop1Id}/printers/${tempPrinter.id}`
      });
      expect(getRes.statusCode).toBe(404);
    });
  });
});
