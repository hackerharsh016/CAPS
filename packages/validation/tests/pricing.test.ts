import { describe, it, expect } from 'vitest';
import { PriceBreakdownSchema, QuoteRequestSchema } from '../src/pricing.schema.js';

describe('Pricing Schemas Validation', () => {
  const validBreakdown = {
    base_pages_paise: 2000,
    color_surcharge_paise: 0,
    duplex_discount_paise: 200,
    binding_fee_paise: 4000,
    urgent_surcharge_paise: 3000,
    subtotal_paise: 8800,
    gst_paise: 1584,
    total_paise: 10384
  };

  it('accepts valid price breakdown with positive total paise', () => {
    const res = PriceBreakdownSchema.safeParse(validBreakdown);
    expect(res.success).toBe(true);
  });

  it('rejects negative amounts in price breakdown', () => {
    const res = PriceBreakdownSchema.safeParse({
      ...validBreakdown,
      base_pages_paise: -100
    });
    expect(res.success).toBe(false);
  });

  it('rejects non-integer floating point paise amounts', () => {
    const res = PriceBreakdownSchema.safeParse({
      ...validBreakdown,
      total_paise: 103.84
    });
    expect(res.success).toBe(false);
  });

  it('rejects unknown properties in PriceBreakdown', () => {
    const res = PriceBreakdownSchema.safeParse({
      ...validBreakdown,
      hidden_fee_paise: 500
    });
    expect(res.success).toBe(false);
  });

  it('validates QuoteRequest schema correctly', () => {
    const validQuoteReq = {
      shop_id: '123e4567-e89b-12d3-a456-426614174000',
      settings: {
        paper_size: 'A4',
        color_mode: 'color',
        sides: 'single',
        orientation: 'portrait',
        copies: 1,
        page_range: 'all',
        binding: 'none'
      },
      priority_tier: 'urgent',
      document_page_count: 15
    };
    expect(QuoteRequestSchema.safeParse(validQuoteReq).success).toBe(true);

    // Reject 0 pages
    expect(QuoteRequestSchema.safeParse({ ...validQuoteReq, document_page_count: 0 }).success).toBe(
      false
    );
  });
});
