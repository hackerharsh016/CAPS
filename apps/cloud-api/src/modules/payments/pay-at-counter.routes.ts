import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PayAtCounterService, PayAtCounterError } from './pay-at-counter.service.js';

export interface PayAtCounterPluginOptions {
  payAtCounterService: PayAtCounterService;
}

const selectSchema = z.object({
  print_job_id: z.string().uuid()
});

const confirmSchema = z.object({
  print_job_id: z.string().uuid(),
  operator_id: z.string().min(1),
  received_amount_paise: z.number().int().positive().optional(),
  receipt_number: z.string().optional(),
  notes: z.string().optional()
});

const configureShopSchema = z.object({
  owner_id: z.string().min(1),
  enabled: z.boolean()
});

export const payAtCounterRoutes: FastifyPluginAsync<PayAtCounterPluginOptions> = async (
  fastify,
  options
) => {
  const { payAtCounterService } = options;

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof PayAtCounterError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message
        }
      });
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message
      }
    });
  }

  // 1. Customer selects Pay-at-Counter for an unpaid print job
  fastify.post('/payments/counter/select', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = selectSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid select pay-at-counter payload.',
          details: parseResult.error.errors
        }
      });
    }

    try {
      const result = await payAtCounterService.selectPayAtCounter(parseResult.data);
      return reply.status(200).send({
        data: result
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 2. Shop owner/operator authorizes and confirms cash settlement at the physical counter
  fastify.post(
    '/payments/counter/confirm',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = confirmSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid cash confirmation payload.',
            details: parseResult.error.errors
          }
        });
      }

      try {
        const result = await payAtCounterService.confirmCashSettlement(parseResult.data);
        return reply.status(200).send({
          data: result
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 3. Shop owner configures pay-at-counter policy (opt-in / opt-out)
  fastify.post(
    '/shops/:shop_id/pay-at-counter',
    async (request: FastifyRequest<{ Params: { shop_id: string } }>, reply: FastifyReply) => {
      const { shop_id } = request.params;
      const parseResult = configureShopSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shop configuration payload.',
            details: parseResult.error.errors
          }
        });
      }

      try {
        const updatedShop = await payAtCounterService.configureShopPayAtCounter(
          shop_id,
          parseResult.data.owner_id,
          parseResult.data.enabled
        );
        return reply.status(200).send({
          data: updatedShop
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 4. Shop owner fetches payment reconciliation & financial report (cash vs gateway)
  fastify.get(
    '/shops/:shop_id/reports/payments',
    async (
      request: FastifyRequest<{
        Params: { shop_id: string };
        Querystring: { user_id?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { shop_id } = request.params;
      const requestingUserId = request.query.user_id ?? (request.headers['x-user-id'] as string);

      if (!requestingUserId) {
        return reply.status(401).send({
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Missing user authentication ID.'
          }
        });
      }

      try {
        const report = await payAtCounterService.getShopPaymentReport(shop_id, requestingUserId);
        return reply.status(200).send({
          data: report
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );
};
