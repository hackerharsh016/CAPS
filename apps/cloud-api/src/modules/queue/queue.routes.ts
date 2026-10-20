/**
 * Fastify route plugin for CAPS Queue Management endpoints.
 * Mounts priority queue views, next-eligible job RPC, live ETA projection,
 * and urgent cap status queries.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { QueueService } from './queue.service.js';

export interface QueueRoutesOptions {
  queueService: QueueService;
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

export const queueRoutes: FastifyPluginAsync<QueueRoutesOptions> = async (
  fastify,
  options
) => {
  const { queueService } = options;

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
};
