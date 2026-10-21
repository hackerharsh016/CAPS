import { describe, it, expect, beforeEach } from 'vitest';
import { PricingService } from '../src/features/pricing-management/pricing-service';
import { ShopService } from '../src/features/shop-management/shop-service';
import { CrossShopAccessError, type Shop } from '../src/features/shop-management/types';

describe('PricingService — API Updates & Tenant Isolation', () => {
  let shopService: ShopService;
  let pricingService: PricingService;

  const mockShopA: Shop = {
    id: '00000000-0000-0000-0000-000000000001',
    owner_id: 'owner-uuid-1',
    name: 'Campus Xerox',
    address: '12 University Road',
    geo_lat: 28.7,
    geo_lng: 77.1,
    status: 'open',
    pricing_config: {
      A4: { bw_single_paise: 200, bw_double_paise: 300, color_single_paise: 1000, color_double_paise: 1800 },
      A3: { bw_single_paise: 400, bw_double_paise: 600, color_single_paise: 2000, color_double_paise: 3600 },
      Legal: { bw_single_paise: 250, bw_double_paise: 350, color_single_paise: 1200, color_double_paise: 2000 },
      binding_prices_paise: { none: 0, spiral: 4000, staple: 500, lamination: 2000 },
      gst_percentage: 18
    },
    urgent_surcharge_config: {
      type: 'flat',
      amount: 2000,
      max_urgent_jobs_per_hour: 5
    },
    auto_print_enabled: false,
    pay_at_counter_enabled: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mockShopB: Shop = {
    ...mockShopA,
    id: '00000000-0000-0000-0000-000000000002',
    owner_id: 'owner-uuid-2',
    name: 'Other Shop'
  };

  beforeEach(() => {
    shopService = new ShopService();
    pricingService = new PricingService(shopService);
  });

  it('updates pricing configuration and operational toggles successfully (happy path)', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = input.toString();
      expect(url).toContain(`/rest/v1/shops?id=eq.${mockShopA.id}`);
      expect(init?.method).toBe('PATCH');

      const body = JSON.parse(init?.body as string) as Partial<Shop>;
      const updatedShop: Shop = {
        ...mockShopA,
        ...body,
        updated_at: new Date().toISOString()
      };

      return new Response(JSON.stringify([updatedShop]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const customShopService = new ShopService({ customFetch: mockFetch });
    const service = new PricingService(customShopService);

    const updatedPricing = {
      ...mockShopA.pricing_config,
      A4: { ...mockShopA.pricing_config.A4, bw_single_paise: 250 }
    };

    const result = await service.updatePricingAndSettings({
      shopId: mockShopA.id,
      ownerId: 'owner-uuid-1',
      authorizedShops: [mockShopA],
      pricingConfig: updatedPricing,
      payAtCounterEnabled: true,
      autoPrintEnabled: true,
      accessToken: 'test-token'
    });

    expect(result.pricing_config.A4.bw_single_paise).toBe(250);
    expect(result.pay_at_counter_enabled).toBe(true);
    expect(result.auto_print_enabled).toBe(true);
  });

  it('strictly rejects unauthorized other-shop edit attempts (cross-shop security)', async () => {
    await expect(
      pricingService.updatePricingAndSettings({
        shopId: mockShopB.id, // targeting other shop!
        ownerId: 'owner-uuid-1',
        authorizedShops: [mockShopA], // user only owns shopA
        payAtCounterEnabled: true
      })
    ).rejects.toThrow(CrossShopAccessError);
  });

  it('permits system administrator to edit any shop configuration', async () => {
    const mockFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as Partial<Shop>;
      return new Response(JSON.stringify([{ ...mockShopB, ...body }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const customShopService = new ShopService({ customFetch: mockFetch });
    const service = new PricingService(customShopService);

    const result = await service.updatePricingAndSettings({
      shopId: mockShopB.id,
      ownerId: 'admin-uuid',
      authorizedShops: [mockShopA],
      payAtCounterEnabled: true,
      isAdmin: true
    });

    expect(result.pay_at_counter_enabled).toBe(true);
  });

  it('fails validation without hitting network if pricing contains negative value', async () => {
    const invalidPricing = {
      ...mockShopA.pricing_config,
      A4: { ...mockShopA.pricing_config.A4, bw_single_paise: -10 }
    };

    await expect(
      pricingService.updatePricingAndSettings({
        shopId: mockShopA.id,
        ownerId: 'owner-uuid-1',
        authorizedShops: [mockShopA],
        pricingConfig: invalidPricing
      })
    ).rejects.toThrow(/Validation Error/);
  });

  it('handles server failure response with clear error message', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({ message: 'Database transaction aborted: RLS policy violated' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const customShopService = new ShopService({
      customFetch: mockFetch,
      supabaseUrl: 'https://remote-project.supabase.co'
    });
    const service = new PricingService(customShopService);

    await expect(
      service.updatePricingAndSettings({
        shopId: mockShopA.id,
        ownerId: 'owner-uuid-1',
        authorizedShops: [mockShopA],
        payAtCounterEnabled: true
      })
    ).rejects.toThrow(/RLS policy violated/);
  });
});
