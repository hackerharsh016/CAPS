import { z } from 'zod';
import { PrintSettingsSchema } from './settings.schema.js';

export const PriceBreakdownSchema = z
  .object({
    base_pages_paise: z.number().int().nonnegative('base_pages_paise must be non-negative'),
    color_surcharge_paise: z
      .number()
      .int()
      .nonnegative('color_surcharge_paise must be non-negative'),
    duplex_discount_paise: z
      .number()
      .int()
      .nonnegative('duplex_discount_paise must be non-negative'),
    binding_fee_paise: z.number().int().nonnegative('binding_fee_paise must be non-negative'),
    urgent_surcharge_paise: z
      .number()
      .int()
      .nonnegative('urgent_surcharge_paise must be non-negative'),
    subtotal_paise: z.number().int().nonnegative('subtotal_paise must be non-negative'),
    gst_paise: z.number().int().nonnegative('gst_paise must be non-negative'),
    total_paise: z.number().int().positive('total_paise must be a positive integer')
  })
  .strict('Unrecognized properties are forbidden in PriceBreakdown');

export const PaperPriceTableSchema = z
  .object({
    bw_single_paise: z.number().int().nonnegative(),
    bw_double_paise: z.number().int().nonnegative(),
    color_single_paise: z.number().int().nonnegative(),
    color_double_paise: z.number().int().nonnegative()
  })
  .strict();

export const PricingConfigSchema = z
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

export const UrgentSurchargeConfigSchema = z
  .object({
    type: z.enum(['flat', 'percentage']),
    amount: z.number().int().nonnegative(),
    max_urgent_jobs_per_hour: z.number().int().positive().optional()
  })
  .strict();

export const QuoteRequestSchema = z
  .object({
    shop_id: z.string().uuid('Invalid shop_id UUID'),
    settings: PrintSettingsSchema,
    priority_tier: z.enum(['urgent', 'flexible']),
    document_page_count: z.number().int().min(1, 'Document must have at least 1 page')
  })
  .strict('Unrecognized properties are forbidden in QuoteRequest');

export const QuoteResponseSchema = z
  .object({
    quote_id: z.string().uuid('Invalid quote_id UUID'),
    shop_id: z.string().uuid('Invalid shop_id UUID'),
    settings: PrintSettingsSchema,
    priority_tier: z.enum(['urgent', 'flexible']),
    page_count: z.number().int().min(1),
    price_breakdown: PriceBreakdownSchema,
    estimated_wait_minutes: z.number().int().nonnegative(),
    expires_at: z.string().datetime()
  })
  .strict();
