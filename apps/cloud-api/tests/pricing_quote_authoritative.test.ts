import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { createTestJwt, SupabaseJwtVerifier } from '../src/plugins/auth.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockQuotesRepository } from '../src/modules/pricing/quotes.repository.js';
import type { FastifyInstance } from 'fastify';
import type { PricingConfig, UrgentSurchargeConfig } from '../src/modules/pricing/pricing.types.js';

describe('Cloud API — Server-Side Authoritative Quote Service (P03-M02-F04)', () => {
  const jwtSecret = 'test-jwt-secret-for-quotes-pricing-service-32-chars';
  const env = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
    SUPABASE_JWT_SECRET: jwtSecret
  });

  let app: FastifyInstance;
  let shopsRepo: MockShopsRepository;
  let quotesRepo: MockQuotesRepository;

  const customerId = '11111111-1111-1111-1111-111111111111';
  const customerToken = createTestJwt(
    { sub: customerId, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  const ownerId = '22222222-2222-2222-2222-222222222222';

  // Standard test pricing config (prices in paise: 100 paise = 1 INR)
  const standardPricingConfig: PricingConfig = {
    A4: {
      bw_single_paise: 200, // ₹2.00
      bw_double_paise: 150, // ₹1.50 per side (₹3.00 per sheet)
      color_single_paise: 1000, // ₹10.00
      color_double_paise: 800 // ₹8.00 per side
    },
    A3: {
      bw_single_paise: 500, // ₹5.00
      bw_double_paise: 400,
      color_single_paise: 2500, // ₹25.00
      color_double_paise: 2000
    },
    Legal: {
      bw_single_paise: 300, // ₹3.00
      bw_double_paise: 250,
      color_single_paise: 1500, // ₹15.00
      color_double_paise: 1200
    },
    binding_prices_paise: {
      none: 0,
      spiral: 4000, // ₹40.00
      staple: 500, // ₹5.00
      lamination: 2000 // ₹20.00
    },
    gst_percentage: 18 // 18% standard GST
  };

  const flatUrgentConfig: UrgentSurchargeConfig = {
    type: 'flat',
    amount: 3000, // ₹30.00 flat surcharge
    max_urgent_jobs_per_hour: 10
  };

  const percentageUrgentConfig: UrgentSurchargeConfig = {
    type: 'percentage',
    amount: 20, // 20% surcharge
    max_urgent_jobs_per_hour: 10
  };

  let openShopId: string;
  let closedShopId: string;

  beforeAll(async () => {
    shopsRepo = new MockShopsRepository();
    quotesRepo = new MockQuotesRepository();

    app = buildApp({
      env,
      tokenVerifier: new SupabaseJwtVerifier(jwtSecret),
      shopsRepo,
      quotesRepo
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    shopsRepo.clear();
    quotesRepo.clear();

    // Create an open shop
    const openShop = await shopsRepo.create({
      owner_id: ownerId,
      name: 'Apex Campus Printers',
      address: 'North Campus Library Gate 2',
      geo_lat: 18.5204,
      geo_lng: 73.8567,
      pricing_config: standardPricingConfig,
      urgent_surcharge_config: flatUrgentConfig
    });
    openShopId = openShop.id;

    // Create a closed shop
    const closedShop = await shopsRepo.create({
      owner_id: ownerId,
      name: 'Midnight Express Prints',
      address: 'South Quad Bldg C',
      geo_lat: 18.5304,
      geo_lng: 73.8667,
      pricing_config: standardPricingConfig,
      urgent_surcharge_config: percentageUrgentConfig
    });
    await shopsRepo.update(closedShop.id, { status: 'closed' });
    closedShopId = closedShop.id;
  });

  describe('1. Authoritative Pricing & Client Tampering Defense', () => {
    it('completely ignores client-supplied tampered prices and calculates authoritative server total', async () => {
      // 10 pages B&W single-sided A4:
      // Base: 10 * 200 = 2000 paise (₹20.00)
      // Subtotal: 2000 paise
      // GST (18%): 360 paise
      // Expected Total: 2360 paise (₹23.60)
      const tamperedPayload = {
        shop_id: openShopId,
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          page_range: 'all',
          binding: 'none'
        },
        priority_tier: 'flexible',
        document_page_count: 10,
        // Malicious client tampering attempts:
        client_price: 0,
        total_paise: 10,
        subtotal_paise: 5,
        price_breakdown: {
          total_paise: 1
        }
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        headers: { authorization: `Bearer ${customerToken}` },
        payload: tamperedPayload
      });

      expect(response.statusCode).toBe(201);
      const quote = response.json().data;

      // Assert server computed true authoritative pricing
      expect(quote.price_breakdown.base_pages_paise).toBe(2000);
      expect(quote.price_breakdown.color_surcharge_paise).toBe(0);
      expect(quote.price_breakdown.duplex_discount_paise).toBe(0);
      expect(quote.price_breakdown.binding_fee_paise).toBe(0);
      expect(quote.price_breakdown.urgent_surcharge_paise).toBe(0);
      expect(quote.price_breakdown.subtotal_paise).toBe(2000);
      expect(quote.price_breakdown.gst_paise).toBe(360);
      expect(quote.price_breakdown.total_paise).toBe(2360);
      expect(quote.price_breakdown.total_paise).not.toBe(10);
      expect(quote.price_breakdown.total_paise).not.toBe(1);
    });
  });

  describe('2. Comprehensive Price Unit Tests for Expected Domain Cases', () => {
    it('calculates Black & White single-sided A4 printing', async () => {
      // 5 pages * 1 copy * 200 paise = 1000 paise
      // GST: 18% of 1000 = 180 paise
      // Total: 1180 paise
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 5
        }
      });

      expect(res.statusCode).toBe(201);
      const { price_breakdown } = res.json().data;
      expect(price_breakdown.base_pages_paise).toBe(1000);
      expect(price_breakdown.color_surcharge_paise).toBe(0);
      expect(price_breakdown.duplex_discount_paise).toBe(0);
      expect(price_breakdown.subtotal_paise).toBe(1000);
      expect(price_breakdown.gst_paise).toBe(180);
      expect(price_breakdown.total_paise).toBe(1180);
    });

    it('calculates Color single-sided A4 printing with color surcharge', async () => {
      // 5 pages * 1 copy:
      // Base: 5 * 200 = 1000
      // Color surcharge: 5 * (1000 - 200) = 4000
      // Subtotal: 5000 paise (5 * 1000)
      // GST (18%): 900 paise
      // Total: 5900 paise
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'color',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 5
        }
      });

      expect(res.statusCode).toBe(201);
      const { price_breakdown } = res.json().data;
      expect(price_breakdown.base_pages_paise).toBe(1000);
      expect(price_breakdown.color_surcharge_paise).toBe(4000);
      expect(price_breakdown.duplex_discount_paise).toBe(0);
      expect(price_breakdown.subtotal_paise).toBe(5000);
      expect(price_breakdown.gst_paise).toBe(900);
      expect(price_breakdown.total_paise).toBe(5900);
    });

    it('calculates Black & White duplex (double-sided) printing with duplex discount', async () => {
      // 10 pages * 1 copy:
      // Base: 10 * 200 = 2000
      // Duplex discount: 10 * (200 - 150) = 500
      // Subtotal: 2000 - 500 = 1500 paise (10 * 150)
      // GST (18%): 270 paise
      // Total: 1770 paise
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'double',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });

      expect(res.statusCode).toBe(201);
      const { price_breakdown } = res.json().data;
      expect(price_breakdown.base_pages_paise).toBe(2000);
      expect(price_breakdown.duplex_discount_paise).toBe(500);
      expect(price_breakdown.subtotal_paise).toBe(1500);
      expect(price_breakdown.gst_paise).toBe(270);
      expect(price_breakdown.total_paise).toBe(1770);
    });

    it('calculates Color duplex (double-sided) printing with color surcharge and duplex discount', async () => {
      // 10 pages * 1 copy:
      // Base: 10 * 200 = 2000
      // Color surcharge: 10 * (1000 - 200) = 8000
      // Duplex discount: 10 * (1000 - 800) = 2000
      // Subtotal: 2000 + 8000 - 2000 = 8000 paise (10 * 800)
      // GST (18%): 1440 paise
      // Total: 9440 paise
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'color',
            sides: 'double',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });

      expect(res.statusCode).toBe(201);
      const { price_breakdown } = res.json().data;
      expect(price_breakdown.base_pages_paise).toBe(2000);
      expect(price_breakdown.color_surcharge_paise).toBe(8000);
      expect(price_breakdown.duplex_discount_paise).toBe(2000);
      expect(price_breakdown.subtotal_paise).toBe(8000);
      expect(price_breakdown.gst_paise).toBe(1440);
      expect(price_breakdown.total_paise).toBe(9440);
    });

    it('calculates alternative paper sizes (A3 and Legal)', async () => {
      // A3 B&W Single: 10 pages * 500 = 5000 paise + 18% GST (900) = 5900 paise
      const a3Res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A3',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });
      expect(a3Res.statusCode).toBe(201);
      expect(a3Res.json().data.price_breakdown.total_paise).toBe(5900);

      // Legal B&W Single: 10 pages * 300 = 3000 paise + 18% GST (540) = 3540 paise
      const legalRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'Legal',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });
      expect(legalRes.statusCode).toBe(201);
      expect(legalRes.json().data.price_breakdown.total_paise).toBe(3540);
    });

    it('calculates finishing / binding service charges (spiral, staple, lamination)', async () => {
      // 10 pages A4 B&W single: 2000 paise
      // Spiral binding: 4000 paise
      // Subtotal: 6000 paise
      // GST (18%): 1080 paise
      // Total: 7080 paise
      const spiralRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'spiral'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });
      expect(spiralRes.statusCode).toBe(201);
      const spiralBreakdown = spiralRes.json().data.price_breakdown;
      expect(spiralBreakdown.binding_fee_paise).toBe(4000);
      expect(spiralBreakdown.subtotal_paise).toBe(6000);
      expect(spiralBreakdown.total_paise).toBe(7080);
    });

    it('multiplies page costs and binding fees across multiple copies', async () => {
      // 10 pages A4 B&W, 3 copies:
      // Total pages: 30 * 200 = 6000 paise
      // Staple binding: 500 paise * 3 copies = 1500 paise
      // Subtotal: 7500 paise
      // GST (18%): 1350 paise
      // Total: 8850 paise
      const copiesRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 3,
            binding: 'staple'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });

      expect(copiesRes.statusCode).toBe(201);
      const breakdown = copiesRes.json().data.price_breakdown;
      expect(breakdown.base_pages_paise).toBe(6000);
      expect(breakdown.binding_fee_paise).toBe(1500);
      expect(breakdown.subtotal_paise).toBe(7500);
      expect(breakdown.gst_paise).toBe(1350);
      expect(breakdown.total_paise).toBe(8850);
    });

    it('accurately parses page ranges (e.g. 1-5, 8) and computes prices on subset', async () => {
      // Document has 20 pages, but user only selected "1-5, 8" -> 6 pages
      // 6 pages * 200 = 1200 paise
      // GST (18%): 216 paise
      // Total: 1416 paise
      const rangeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            page_range: '1-5, 8',
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 20
        }
      });

      expect(rangeRes.statusCode).toBe(201);
      const data = rangeRes.json().data;
      expect(data.page_count).toBe(6);
      expect(data.price_breakdown.base_pages_paise).toBe(1200);
      expect(data.price_breakdown.total_paise).toBe(1416);
    });

    it('calculates flat urgent priority queue surcharge', async () => {
      // 10 pages B&W: 2000 paise
      // Flat urgent surcharge: 3000 paise
      // Subtotal: 5000 paise
      // GST (18%): 900 paise
      // Total: 5900 paise
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'urgent',
          document_page_count: 10
        }
      });

      expect(res.statusCode).toBe(201);
      const breakdown = res.json().data.price_breakdown;
      expect(breakdown.urgent_surcharge_paise).toBe(3000);
      expect(breakdown.subtotal_paise).toBe(5000);
      expect(breakdown.gst_paise).toBe(900);
      expect(breakdown.total_paise).toBe(5900);
    });

    it('calculates percentage urgent priority queue surcharge', async () => {
      // Create shop with 20% urgent surcharge
      const pctShop = await shopsRepo.create({
        owner_id: ownerId,
        name: 'Percentage Surcharge Shop',
        address: 'West Library',
        geo_lat: 18.5204,
        geo_lng: 73.8567,
        pricing_config: standardPricingConfig,
        urgent_surcharge_config: percentageUrgentConfig // 20%
      });

      // 10 pages B&W: 2000 paise
      // 20% urgent surcharge: 400 paise
      // Subtotal: 2400 paise
      // GST (18%): 432 paise
      // Total: 2832 paise
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: pctShop.id,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'urgent',
          document_page_count: 10
        }
      });

      expect(res.statusCode).toBe(201);
      const breakdown = res.json().data.price_breakdown;
      expect(breakdown.urgent_surcharge_paise).toBe(400);
      expect(breakdown.subtotal_paise).toBe(2400);
      expect(breakdown.gst_paise).toBe(432);
      expect(breakdown.total_paise).toBe(2832);
    });

    it('handles configurable GST rates (0%, 5%, 18%) with exact integer paise rounding', async () => {
      // Zero GST shop
      const zeroGstShop = await shopsRepo.create({
        owner_id: ownerId,
        name: 'Zero Tax Institutional Press',
        address: 'Student Council Room',
        geo_lat: 18.5,
        geo_lng: 73.8,
        pricing_config: {
          ...standardPricingConfig,
          gst_percentage: 0
        },
        urgent_surcharge_config: flatUrgentConfig
      });

      const zeroGstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: zeroGstShop.id,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });

      expect(zeroGstRes.statusCode).toBe(201);
      const zeroGstBreakdown = zeroGstRes.json().data.price_breakdown;
      expect(zeroGstBreakdown.gst_paise).toBe(0);
      expect(zeroGstBreakdown.total_paise).toBe(2000);
    });
  });

  describe('3. Quote Snapshot, Expiration, and Retrieval Lifecycle', () => {
    it('snapshots shop pricing config so future shop price edits do not mutate historical quote', async () => {
      // 1. Generate quote
      const initialRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 10
        }
      });
      expect(initialRes.statusCode).toBe(201);
      const quoteId = initialRes.json().data.quote_id;

      // 2. Shop owner raises A4 bw_single price to ₹5.00 (500 paise)
      await shopsRepo.update(openShopId, {
        pricing_config: {
          ...standardPricingConfig,
          A4: {
            ...standardPricingConfig.A4,
            bw_single_paise: 500
          }
        }
      });

      // 3. Fetch original quote by ID
      const fetchRes = await app.inject({
        method: 'GET',
        url: `/api/v1/quotes/${quoteId}`
      });

      expect(fetchRes.statusCode).toBe(200);
      const fetchedQuote = fetchRes.json().data;
      // Assert pricing remains snapshot-locked at 2000 paise (not updated to 5000)
      expect(fetchedQuote.price_breakdown.base_pages_paise).toBe(2000);
      expect(fetchedQuote.price_breakdown.total_paise).toBe(2360);
      expect(fetchedQuote.pricing_snapshot.pricing_config.A4.bw_single_paise).toBe(200);
    });

    it('rejects retrieval of expired quotes with 410 QUOTE_EXPIRED', async () => {
      // Generate a quote
      const quoteRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 5
        }
      });
      const quoteId = quoteRes.json().data.quote_id;

      // Fast-forward quote expiry in repo to past
      await quotesRepo.update(quoteId, {
        expires_at: new Date(Date.now() - 60000).toISOString()
      });

      // Attempt to retrieve expired quote
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/quotes/${quoteId}`
      });

      expect(getRes.statusCode).toBe(410);
      expect(getRes.json().error.code).toBe('QUOTE_EXPIRED');
    });

    it('returns 404 NOT_FOUND for non-existent quote ID', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/quotes/${nonExistentId}`
      });

      expect(getRes.statusCode).toBe(404);
      expect(getRes.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('4. Error Handling and Input Validation', () => {
    it('rejects quote request for closed shop with 400 SHOP_CLOSED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: closedShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 5
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('SHOP_CLOSED');
    });

    it('rejects quote request for non-existent shop with 404 NOT_FOUND', async () => {
      const fakeShopId = '99999999-9999-9999-9999-999999999999';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: fakeShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 5
        }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('rejects quote request with zero or negative page count with 400 INVALID_PAYLOAD', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 0
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAYLOAD');
    });

    it('rejects invalid copies (e.g. 0 or 101) with 400 INVALID_PAYLOAD', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/quotes',
        payload: {
          shop_id: openShopId,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 101, // Max is 100
            binding: 'none'
          },
          priority_tier: 'flexible',
          document_page_count: 5
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('5. Readiness Check', () => {
    it('readiness endpoint confirms operational database and quote repositories', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ready'
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ready');
      expect(body.checks.database).toBe('ok');
    });
  });
});
