import { describe, it, expect } from 'vitest';
import { paiseToRupees, rupeesToPaise } from '../src/features/pricing-management/types';
import type { Shop } from '../src/features/shop-management/types';
import { validatePricingConfig } from '../src/features/pricing-management/validation';

describe('Pricing Form Utilities & Conversion', () => {
  it('converts paise to rupees accurately', () => {
    expect(paiseToRupees(200)).toBe(2);
    expect(paiseToRupees(250)).toBe(2.5);
    expect(paiseToRupees(1800)).toBe(18);
    expect(paiseToRupees(0)).toBe(0);
  });

  it('converts rupees to paise accurately without floating point drift', () => {
    expect(rupeesToPaise(2)).toBe(200);
    expect(rupeesToPaise(2.5)).toBe(250);
    expect(rupeesToPaise(18.75)).toBe(1875);
    expect(rupeesToPaise(0)).toBe(0);
  });

  it('detects dirty state when values are modified', () => {
    const originalShop: Shop = {
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

    const cloned = JSON.parse(JSON.stringify(originalShop)) as Shop;
    // Unchanged -> not dirty
    expect(JSON.stringify(cloned.pricing_config) === JSON.stringify(originalShop.pricing_config)).toBe(true);

    // Modified -> dirty
    cloned.pricing_config.A4.bw_single_paise = 250;
    expect(JSON.stringify(cloned.pricing_config) !== JSON.stringify(originalShop.pricing_config)).toBe(true);

    // Rollback to original -> clean
    cloned.pricing_config.A4.bw_single_paise = 200;
    expect(JSON.stringify(cloned.pricing_config) === JSON.stringify(originalShop.pricing_config)).toBe(true);
  });

  it('prevents saving invalid draft state and returns field error', () => {
    const invalidConfig = {
      A4: { bw_single_paise: -100, bw_double_paise: 300, color_single_paise: 1000, color_double_paise: 1800 },
      A3: { bw_single_paise: 400, bw_double_paise: 600, color_single_paise: 2000, color_double_paise: 3600 },
      Legal: { bw_single_paise: 250, bw_double_paise: 350, color_single_paise: 1200, color_double_paise: 2000 },
      binding_prices_paise: { none: 0 as const, spiral: 4000, staple: 500, lamination: 2000 },
      gst_percentage: 18
    };

    const validation = validatePricingConfig(invalidConfig);
    expect(validation.isValid).toBe(false);
    expect(validation.errors['A4.bw_single']).toBeDefined();
  });
});
