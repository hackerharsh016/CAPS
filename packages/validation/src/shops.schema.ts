import { z } from 'zod';
import { PricingConfigSchema, UrgentSurchargeConfigSchema } from './pricing.schema.js';

export const ShopStatusSchema = z.enum(['open', 'closed']);

export const CreateShopSchema = z
  .object({
    owner_id: z.string().uuid('Invalid owner_id UUID'),
    name: z.string().min(2, 'Shop name must be at least 2 characters').max(100),
    address: z.string().min(5, 'Address must be at least 5 characters'),
    geo_lat: z.number().min(-90).max(90),
    geo_lng: z.number().min(-180).max(180),
    pricing_config: PricingConfigSchema,
    urgent_surcharge_config: UrgentSurchargeConfigSchema,
    auto_print_enabled: z.boolean().default(false)
  })
  .strict('Unrecognized properties are forbidden in CreateShop');

export const ShopSchema = CreateShopSchema.extend({
  id: z.string().uuid(),
  status: ShopStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
}).strict();
