import { z } from 'zod';
import { ColorModeSchema, PaperSizeSchema } from './settings.schema.js';

export const PrinterRoleSchema = z.enum(['bw', 'color', 'large_format']);

export const PrinterStatusSchema = z.enum(['online', 'offline', 'error']);

export const PrinterCapabilitiesSchema = z
  .object({
    paper_sizes: z.array(PaperSizeSchema).min(1, 'At least one paper size must be supported'),
    color_modes: z.array(ColorModeSchema).min(1, 'At least one color mode must be supported'),
    duplex_supported: z.boolean(),
    max_copies: z.number().int().min(1).max(999)
  })
  .strict();

export const RegisterPrinterSchema = z
  .object({
    shop_id: z.string().uuid('Invalid shop_id UUID'),
    name: z.string().min(1, 'Printer name cannot be empty').max(100),
    role: PrinterRoleSchema,
    is_default: z.boolean().default(false),
    capabilities: PrinterCapabilitiesSchema
  })
  .strict('Unrecognized properties are forbidden in RegisterPrinter');

export const PrinterSchema = RegisterPrinterSchema.extend({
  id: z.string().uuid(),
  status: PrinterStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional()
}).strict();
