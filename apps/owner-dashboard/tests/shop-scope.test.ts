import { describe, it, expect, beforeEach } from 'vitest';
import { ShopService } from '../src/features/shop-management/shop-service';
import { CrossShopAccessError, type Shop } from '../src/features/shop-management/types';

describe('Shop Management — Scoping & Tenant Isolation', () => {
  let shopService: ShopService;

  const mockShopA: Shop = {
    id: 'shop-uuid-aaa',
    owner_id: 'owner-uuid-1',
    name: 'Campus Print Corner',
    address: 'Gate 1, Campus',
    geo_lat: 28.6,
    geo_lng: 77.2,
    status: 'open',
    pricing_config: {
      A4: {
        bw_single_paise: 200,
        bw_double_paise: 300,
        color_single_paise: 1000,
        color_double_paise: 1800
      },
      A3: {
        bw_single_paise: 400,
        bw_double_paise: 600,
        color_single_paise: 2000,
        color_double_paise: 3600
      },
      Legal: {
        bw_single_paise: 250,
        bw_double_paise: 350,
        color_single_paise: 1200,
        color_double_paise: 2000
      },
      binding_prices_paise: {
        none: 0,
        spiral: 4000,
        staple: 500,
        lamination: 2000
      },
      gst_percentage: 18
    },
    urgent_surcharge_config: {
      type: 'flat',
      amount: 2000,
      max_urgent_jobs_per_hour: 5
    },
    auto_print_enabled: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const mockShopB: Shop = {
    ...mockShopA,
    id: 'shop-uuid-bbb',
    owner_id: 'owner-uuid-2',
    name: 'South City Digital Press'
  };

  beforeEach(() => {
    shopService = new ShopService();
  });

  it('fetches owner-scoped shops via API', async () => {
    const mockFetch: typeof fetch = async input => {
      const url = input.toString();
      expect(url).toContain('owner_id=eq.owner-uuid-1');
      return new Response(JSON.stringify([mockShopA]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const service = new ShopService({ customFetch: mockFetch });
    const shops = await service.fetchOwnerShops('owner-uuid-1', 'mock-token');

    expect(shops).toHaveLength(1);
    expect(shops[0]?.id).toBe('shop-uuid-aaa');
  });

  it('allows access to authorized shop without throwing', () => {
    expect(() => {
      shopService.validateShopAccess('owner-uuid-1', mockShopA.id, [mockShopA], false);
    }).not.toThrow();
  });

  it('strictly throws CrossShopAccessError when owner attempts access to another shop', () => {
    expect(() => {
      shopService.validateShopAccess('owner-uuid-1', mockShopB.id, [mockShopA], false);
    }).toThrow(CrossShopAccessError);

    try {
      shopService.validateShopAccess('owner-uuid-1', mockShopB.id, [mockShopA], false);
    } catch (err: unknown) {
      const crossErr = err as CrossShopAccessError;
      expect(crossErr.code).toBe('FORBIDDEN_CROSS_SHOP_ACCESS');
      expect(crossErr.targetShopId).toBe(mockShopB.id);
      expect(crossErr.ownerId).toBe('owner-uuid-1');
      expect(crossErr.status).toBe(403);
    }
  });

  it('allows admin access to any shop without throwing', () => {
    expect(() => {
      shopService.validateShopAccess('admin-uuid', mockShopB.id, [mockShopA], true);
    }).not.toThrow();
  });

  it('persists and retrieves active shop ID', () => {
    shopService.setActiveShopId('shop-uuid-aaa');
    expect(shopService.getActiveShopId()).toBe('shop-uuid-aaa');

    shopService.clearActiveShopId();
    expect(shopService.getActiveShopId()).toBeNull();
  });
});
