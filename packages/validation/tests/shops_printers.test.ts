import { describe, it, expect } from 'vitest';
import { CreateShopSchema } from '../src/shops.schema.js';
import { RegisterPrinterSchema } from '../src/printers.schema.js';

describe('Shop & Printer Schemas Validation', () => {
  const validPricingConfig = {
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
      bw_double_paise: 500,
      color_single_paise: 1200,
      color_double_paise: 2000
    },
    binding_prices_paise: {
      none: 0,
      spiral: 4000,
      staple: 500,
      lamination: 2500
    },
    gst_percentage: 18
  };

  const validShopPayload = {
    owner_id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Sai Xerox Center',
    address: 'Shop 4, College Road, Near North Gate',
    geo_lat: 12.9716,
    geo_lng: 77.5946,
    pricing_config: validPricingConfig,
    urgent_surcharge_config: {
      type: 'flat',
      amount: 3000,
      max_urgent_jobs_per_hour: 5
    },
    auto_print_enabled: false
  };

  it('validates a correct shop creation payload', () => {
    const res = CreateShopSchema.safeParse(validShopPayload);
    expect(res.success).toBe(true);
  });

  it('rejects invalid latitude out of [-90, 90]', () => {
    const res = CreateShopSchema.safeParse({
      ...validShopPayload,
      geo_lat: 95.5
    });
    expect(res.success).toBe(false);
  });

  it('rejects invalid longitude out of [-180, 180]', () => {
    const res = CreateShopSchema.safeParse({
      ...validShopPayload,
      geo_lng: 200.0
    });
    expect(res.success).toBe(false);
  });

  it('validates printer registration schema with capabilities', () => {
    const validPrinter = {
      shop_id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Canon imageRUNNER 2525',
      role: 'bw',
      is_default: true,
      capabilities: {
        paper_sizes: ['A4', 'A3'],
        color_modes: ['bw'],
        duplex_supported: true,
        max_copies: 100
      }
    };
    expect(RegisterPrinterSchema.safeParse(validPrinter).success).toBe(true);

    // Rejects empty paper sizes array
    expect(
      RegisterPrinterSchema.safeParse({
        ...validPrinter,
        capabilities: { ...validPrinter.capabilities, paper_sizes: [] }
      }).success
    ).toBe(false);
  });
});
