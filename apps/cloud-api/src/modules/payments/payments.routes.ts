import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PaymentsService, PaymentError } from './payments.service.js';

const createOrderSchema = z.object({
  print_job_id: z.string().uuid(),
  notes: z.record(z.string()).optional(),
  requested_amount_paise: z.number().int().positive().optional(),
  amount_paise: z.number().int().positive().optional(),
  currency: z.string().optional(),
  receipt: z.string().optional()
});

export interface PaymentsPluginOptions {
  paymentsService: PaymentsService;
}

export const paymentsRoutes: FastifyPluginAsync<PaymentsPluginOptions> = async (
  fastify,
  options
) => {
  const { paymentsService } = options;

  const handleCreateOrder = async (request: any, reply: any) => {
    const parseResult = createOrderSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid order creation request payload.',
          details: parseResult.error.errors
        }
      });
    }

    const requestedAmount =
      parseResult.data.requested_amount_paise ?? parseResult.data.amount_paise;

    try {
      const order = await paymentsService.createRazorpayOrder({
        print_job_id: parseResult.data.print_job_id,
        notes: parseResult.data.notes,
        requested_amount_paise: requestedAmount
      });
      return reply.status(201).send({
        data: order
      });
    } catch (err: unknown) {
      if (err instanceof PaymentError) {
        return reply.status(err.statusCode).send({
          error: {
            code: err.code,
            message: err.message
          }
        });
      }

      request.log.error(err);
      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create payment order.'
        }
      });
    }
  };

  fastify.post('/orders', handleCreateOrder);
  fastify.post('/razorpay/order', handleCreateOrder);
};
