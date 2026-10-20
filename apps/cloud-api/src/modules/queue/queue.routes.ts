/**
 * Fastify route plugin for CAPS Queue Management endpoints.
 * Mounts priority queue views, next-eligible job RPC, live ETA projection,
 * and urgent cap status queries.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { QueueService } from './queue.service.js';
import type { RealtimeSignalsService } from './realtime-signals.service.js';

export interface QueueRoutesOptions {
  queueService: QueueService;
  realtimeSignalsService?: RealtimeSignalsService | undefined;
}

const liveEtaSchema = z.object({
  pages: z.number().int().positive('Page count must be greater than zero'),
  copies: z.number().int().positive().optional(),
  color_mode: z.enum(['bw', 'color']).optional(),
  duplex: z.boolean().optional(),
  binding: z.enum(['none', 'spiral', 'staple', 'lamination']).optional(),
  priority_tier: z.enum(['urgent', 'flexible']).optional(),
  printer_id: z.string().optional()
});

const reassignPrinterSchema = z.object({
  job_id: z.string().min(1, 'Missing required field "job_id"'),
  new_printer_id: z.string().min(1, 'Missing required field "new_printer_id"')
});

const surchargeBodySchema = z.object({
  base_price_paise: z.number().int().nonnegative(),
  priority_tier: z.enum(['urgent', 'flexible'])
});

const configurePolicySchema = z.object({
  type: z.enum(['flat', 'percentage']).optional(),
  amount: z.number().int().nonnegative().optional(),
  max_urgent_jobs_per_hour: z.number().int().nonnegative().nullable().optional(),
  max_urgent_jobs_in_queue: z.number().int().nonnegative().nullable().optional(),
  fairness_guard_enabled: z.boolean().optional(),
  max_flexible_wait_threshold_seconds: z.number().int().nonnegative().nullable().optional()
});

const reconcileSchema = z.object({
  device_id: z.string().min(1, 'Missing required field "device_id"'),
  last_event_id: z.number().int().nonnegative().optional(),
  since_timestamp: z.string().optional(),
  in_flight_attempt_id: z.string().optional(),
  in_flight_lease_token: z.string().optional()
});

export const queueRoutes: FastifyPluginAsync<QueueRoutesOptions> = async (
  fastify,
  options
) => {
  const { queueService, realtimeSignalsService } = options;

  /**
   * GET /api/v1/shops/:shopId/queue
   * Retrieves the current two-tier priority queue for a shop.
   * Redacts customer details if called by customer role.
   */
  fastify.get(
    '/:shopId/queue',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const callerRole = request.user?.role;
      const callerCustomerId = request.user?.id;

      const queue = await queueService.getShopQueue(shopId, {
        callerRole,
        callerCustomerId
      });

      return reply.status(200).send({
        data: queue
      });
    }
  );

  /**
   * GET /api/v1/shops/:shopId/queue/next
   * Secure atomic RPC: Retrieves the next highest-priority eligible print job.
   * Authorized strictly for shop owners, agent daemons, and system admins.
   */
  fastify.get(
    '/:shopId/queue/next',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const { printer_id } = (request.query as { printer_id?: string }) || {};

      const job = await queueService.getNextEligibleJob(shopId, printer_id);

      return reply.status(200).send({
        data: {
          job
        }
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/queue/recalculate
   * Forces dynamic recomputation and database persistence of queue_position fields.
   */
  fastify.post(
    '/:shopId/queue/recalculate',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const queue = await queueService.recalculateQueue(shopId);

      return reply.status(200).send({
        data: queue
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/queue/eta
   * Computes live estimated wait time, print duration, and projected start/completion.
   */
  fastify.post(
    '/:shopId/queue/eta',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const parsed = liveEtaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid ETA request payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const body = parsed.data;
      const priorityTier = body.priority_tier || 'flexible';

      const eta = await queueService.getLiveEta({
        shop_id: shopId,
        pages: body.pages,
        copies: body.copies,
        color_mode: body.color_mode,
        duplex: body.duplex,
        binding: body.binding,
        priority_tier: priorityTier,
        printer_id: body.printer_id
      });

      return reply.status(200).send({
        data: eta
      });
    }
  );

  /**
   * GET /api/v1/shops/:shopId/queue/caps
   * Returns current hourly quota consumption, queue depth, and fairness guard status.
   */
  fastify.get(
    '/:shopId/queue/caps',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const status = await queueService.getUrgentCapStatus(shopId);

      return reply.status(200).send({
        data: status
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/queue/reassign
   * Reassigns a queued job to an alternate active printer within the shop.
   */
  fastify.post(
    '/:shopId/queue/reassign',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const parsed = reassignPrinterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid printer reassignment payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const result = await queueService.reassignPrinter({
        shop_id: shopId,
        job_id: parsed.data.job_id,
        new_printer_id: parsed.data.new_printer_id
      });

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/agents/reconcile
   * Missed-Event Reconciliation and Active Lease Recovery.
   * Ensures no lost jobs after network partition, socket drop, or agent daemon restart.
   */
  const handleReconcile = async (request: FastifyRequest, reply: FastifyReply) => {
    const { shopId } = request.params as { shopId: string };
    const parsed = reconcileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid agent reconciliation payload.',
          request_id: request.requestId || 'unknown-request',
          details: parsed.error.errors
        }
      });
    }

    if (!realtimeSignalsService) {
      return reply.status(503).send({
        error: {
          code: 'REALTIME_SERVICE_UNAVAILABLE',
          message: 'Realtime reconciliation service is not configured.',
          request_id: request.requestId || 'unknown-request'
        }
      });
    }

    const result = await realtimeSignalsService.reconcileAgent(shopId, parsed.data);
    return reply.status(200).send({
      data: result
    });
  };

  fastify.post('/:shopId/agents/reconcile', handleReconcile);
  fastify.post('/:shopId/queue/reconcile', handleReconcile);

  /**
   * GET /api/v1/shops/:shopId/queue/events
   * Polling / Delta cursor query for missed signals.
   */
  fastify.get(
    '/:shopId/queue/events',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const { after_id, limit } = (request.query as { after_id?: string; limit?: string }) || {};

      if (!realtimeSignalsService) {
        return reply.status(503).send({
          error: {
            code: 'REALTIME_SERVICE_UNAVAILABLE',
            message: 'Realtime events service is not configured.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const parsedAfterId = after_id ? parseInt(after_id, 10) : 0;
      const parsedLimit = limit ? parseInt(limit, 10) : 100;

      const result = await realtimeSignalsService.getMissedEvents(
        shopId,
        isNaN(parsedAfterId) ? 0 : parsedAfterId,
        isNaN(parsedLimit) ? 100 : parsedLimit
      );

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * GET /api/v1/shops/:shopId/queue/live
   * Refreshes dynamic queue positions and returns live ETA summary.
   * Redacts customer details if caller is customer.
   */
  fastify.get(
    '/:shopId/queue/live',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const callerRole = request.user?.role;
      const callerCustomerId = request.user?.id;

      const queue = await queueService.getShopQueue(shopId, {
        callerRole,
        callerCustomerId
      });

      return reply.status(200).send({
        data: queue
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/pricing/surcharge
   * Calculate urgent surcharge and total price before order placement.
   */
  fastify.post(
    '/:shopId/pricing/surcharge',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
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

      const surchargeResult = await queueService.calculateUrgentSurcharge(
        shopId,
        bodyResult.data.base_price_paise,
        bodyResult.data.priority_tier
      );

      return reply.status(200).send({
        data: surchargeResult
      });
    }
  );

  /**
   * GET /api/v1/shops/:shopId/urgent/status
   * Query urgent cap and fairness status for a shop.
   */
  fastify.get(
    '/:shopId/urgent/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const status = await queueService.getUrgentCapStatus(shopId);
      return reply.status(200).send({
        data: status
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/urgent/validate
   * Atomically validate urgent admission before checkout.
   */
  fastify.post(
    '/:shopId/urgent/validate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const admission = await queueService.reserveUrgentAdmission(shopId);
      return reply.status(200).send({
        data: admission
      });
    }
  );

  /**
   * PUT /api/v1/shops/:shopId/urgent/policy
   * Configure shop urgent surcharge and fairness policy (Owner/Admin).
   */
  fastify.put(
    '/:shopId/urgent/policy',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
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

      const updatedShop = await queueService.configureUrgentPolicy(
        shopId,
        bodyResult.data
      );

      return reply.status(200).send({
        data: {
          shop_id: updatedShop.id,
          urgent_surcharge_config: updatedShop.urgent_surcharge_config
        }
      });
    }
  );
};
