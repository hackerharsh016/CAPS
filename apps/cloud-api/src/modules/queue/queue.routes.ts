import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { QueueService, QueueError } from './queue.service.js';

export interface QueuePluginOptions {
  queueService: QueueService;
}

const shopParamSchema = z.object({
  shopId: z.string().uuid()
});

const queueQuerySchema = z.object({
  caller_id: z.string().uuid().optional(),
  role: z.enum(['customer', 'owner', 'admin', 'agent']).optional()
});

const liveEtaBodySchema = z.object({
  pages: z.number().int().positive(),
  copies: z.number().int().positive().optional(),
  color_mode: z.enum(['bw', 'color']).optional(),
  duplex: z.boolean().optional(),
  binding: z.enum(['none', 'spiral', 'staple', 'lamination']).optional(),
  priority_tier: z.enum(['urgent', 'flexible']),
  printer_id: z.string().uuid().optional()
});

const surchargeBodySchema = z.object({
  base_price_paise: z.number().int().nonnegative(),
  priority_tier: z.enum(['urgent', 'flexible'])
});

const reassignBodySchema = z.object({
  job_id: z.string().uuid(),
  new_printer_id: z.string().uuid()
});

const configurePolicySchema = z.object({
  type: z.enum(['flat', 'percentage']).optional(),
  amount: z.number().int().nonnegative().optional(),
  max_urgent_jobs_per_hour: z.number().int().nonnegative().nullable().optional(),
  max_urgent_jobs_in_queue: z.number().int().nonnegative().nullable().optional(),
  fairness_guard_enabled: z.boolean().optional(),
  max_flexible_wait_threshold_seconds: z.number().int().nonnegative().nullable().optional()
});

export const queueRoutes: FastifyPluginAsync<QueuePluginOptions> = async (
  fastify,
  options
) => {
  const { queueService } = options;

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof QueueError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {})
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

  // 1. Get live shop queue with two-tier FIFO ordering and estimated wait times
  fastify.get(
    '/shops/:shopId/queue',
    async (
      request: FastifyRequest<{ Params: { shopId: string }; Querystring: Record<string, unknown> }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      const queryResult = queueQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters.',
            details: queryResult.error.errors
          }
        });
      }

      try {
        const queueView = await queueService.getShopQueue(paramsResult.data.shopId, {
          callerCustomerId: queryResult.data.caller_id,
          callerRole: queryResult.data.role
        });

        return reply.status(200).send({
          data: queueView
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 2. Query live projected queue position and waiting time for a prospective job
  fastify.post(
    '/shops/:shopId/queue/eta',
    async (
      request: FastifyRequest<{ Params: { shopId: string } }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      const bodyResult = liveEtaBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid ETA calculation payload.',
            details: bodyResult.error.errors
          }
        });
      }

      try {
        const etaResult = await queueService.getLiveEta({
          shop_id: paramsResult.data.shopId,
          ...bodyResult.data
        });

        return reply.status(200).send({
          data: etaResult
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 3. Calculate urgent surcharge and total price before order placement
  fastify.post(
    '/shops/:shopId/pricing/surcharge',
    async (
      request: FastifyRequest<{ Params: { shopId: string } }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      const bodyResult = surchargeBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid surcharge calculation payload.',
            details: bodyResult.error.errors
          }
        });
      }

      try {
        const surchargeResult = await queueService.calculateUrgentSurcharge(
          paramsResult.data.shopId,
          bodyResult.data.base_price_paise,
          bodyResult.data.priority_tier
        );

        return reply.status(200).send({
          data: surchargeResult
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 4. Reassign queued job to an alternate printer upon hardware fault/jam
  fastify.post(
    '/shops/:shopId/queue/reassign',
    async (
      request: FastifyRequest<{ Params: { shopId: string } }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      const bodyResult = reassignBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid printer reassignment payload.',
            details: bodyResult.error.errors
          }
        });
      }

      try {
        const result = await queueService.reassignPrinter({
          shop_id: paramsResult.data.shopId,
          job_id: bodyResult.data.job_id,
          new_printer_id: bodyResult.data.new_printer_id
        });

        return reply.status(200).send({
          data: result
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 5. Query urgent cap and fairness status for a shop
  fastify.get(
    '/shops/:shopId/urgent/status',
    async (
      request: FastifyRequest<{ Params: { shopId: string } }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      try {
        const status = await queueService.getUrgentCapStatus(paramsResult.data.shopId);
        return reply.status(200).send({
          data: status
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 6. Atomically validate urgent admission before checkout
  fastify.post(
    '/shops/:shopId/urgent/validate',
    async (
      request: FastifyRequest<{ Params: { shopId: string } }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      try {
        const admission = await queueService.reserveUrgentAdmission(paramsResult.data.shopId);
        return reply.status(200).send({
          data: admission
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 7. Configure shop urgent surcharge and fairness policy (Owner/Admin)
  fastify.put(
    '/shops/:shopId/urgent/policy',
    async (
      request: FastifyRequest<{ Params: { shopId: string } }>,
      reply: FastifyReply
    ) => {
      const paramsResult = shopParamSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid shopId parameter. Must be a valid UUID.',
            details: paramsResult.error.errors
          }
        });
      }

      const bodyResult = configurePolicySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid urgent policy configuration payload.',
            details: bodyResult.error.errors
          }
        });
      }

      try {
        const updatedShop = await queueService.configureUrgentPolicy(
          paramsResult.data.shopId,
          bodyResult.data
        );

        return reply.status(200).send({
          data: {
            shop_id: updatedShop.id,
            urgent_surcharge_config: updatedShop.urgent_surcharge_config
          }
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );
};
