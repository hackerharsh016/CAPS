import { z } from 'zod';
import { PriceBreakdownSchema } from './pricing.schema.js';
import { PrintSettingsSchema } from './settings.schema.js';

export const PriorityTierSchema = z.enum(['urgent', 'flexible'], {
  errorMap: () => ({ message: "Priority tier must be either 'urgent' or 'flexible'" })
});

export const JobStatusSchema = z.enum([
  'pending_payment',
  'queued',
  'approved',
  'claimed',
  'downloading',
  'printing',
  'completed',
  'failed',
  'cancelled',
  'requires_review'
]);

export const CreatePrintJobSchema = z
  .object({
    shop_id: z.string().uuid('Invalid shop_id UUID'),
    customer_id: z.string().uuid('Invalid customer_id UUID'),
    printer_id: z.string().uuid('Invalid printer_id UUID').optional(),
    document_storage_key: z.string().min(1, 'document_storage_key is required'),
    settings: PrintSettingsSchema,
    priority_tier: PriorityTierSchema
  })
  .strict('Unrecognized properties are forbidden in CreatePrintJob');

export const PrintJobSchema = z
  .object({
    id: z.string().uuid(),
    shop_id: z.string().uuid(),
    customer_id: z.string().uuid(),
    printer_id: z.string().uuid().optional(),
    document_storage_key: z.string().min(1),
    settings: PrintSettingsSchema,
    priority_tier: PriorityTierSchema,
    price_total_paise: z.number().int().positive(),
    price_breakdown: PriceBreakdownSchema,
    status: JobStatusSchema,
    queue_position: z.number().int().positive().optional(),
    enqueued_at: z.string().datetime().optional(),
    document_expires_at: z.string().datetime(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime()
  })
  .strict();
