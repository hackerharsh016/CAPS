import { z } from 'zod';

export const PaymentMethodSchema = z.enum(['upi', 'card', 'wallet', 'pay_at_counter']);

export const PaymentStatusSchema = z.enum(['initiated', 'success', 'failed', 'refunded']);

export const CreatePaymentOrderSchema = z
  .object({
    print_job_id: z.string().uuid('Invalid print_job_id UUID'),
    amount_paise: z.number().int().positive('Payment amount must be greater than zero'),
    currency: z.literal('INR').default('INR'),
    method: PaymentMethodSchema
  })
  .strict('Unrecognized properties are forbidden in CreatePaymentOrder');

export const PaymentRecordSchema = CreatePaymentOrderSchema.extend({
  id: z.string().uuid(),
  gateway_ref: z.string().optional(),
  status: PaymentStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional()
}).strict();
