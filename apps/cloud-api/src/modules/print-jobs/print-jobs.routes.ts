import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrintJobsService } from './print-jobs.service.js';
import type { JobStatus } from './print-jobs.types.js';

export interface PrintJobsPluginOptions {
  printJobsService: PrintJobsService;
}

const printSettingsSchema = z.object({
  paper_size: z.enum(['A4', 'A3', 'Legal']),
  color_mode: z.enum(['bw', 'color']),
  sides: z.enum(['single', 'double']),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  copies: z.number().int().min(1).max(100).default(1),
  page_range: z.string().default('all'),
  binding: z.enum(['none', 'spiral', 'staple', 'lamination']).default('none')
});

const createPrintJobSchema = z.object({
  shop_id: z.string().min(1, 'shop_id is required'),
  shopId: z.string().optional(),
  quote_id: z.string().optional(),
  quoteId: z.string().optional(),
  document_id: z.string().optional(),
  documentId: z.string().optional(),
  document_storage_key: z.string().optional(),
  documentStorageKey: z.string().optional(),
  document_page_count: z.number().int().positive().optional(),
  documentPageCount: z.number().int().positive().optional(),
  page_count: z.number().int().positive().optional(),
  printer_id: z.string().optional(),
  printerId: z.string().optional(),
  settings: printSettingsSchema.optional(),
  priority_tier: z.enum(['urgent', 'flexible']).optional(),
  priorityTier: z.enum(['urgent', 'flexible']).optional()
});

const transitionStatusSchema = z.object({
  status: z.enum([
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
  ]),
  reason: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const cancelJobSchema = z.object({
  reason: z.string().optional()
});

const listJobsQuerySchema = z.object({
  shop_id: z.string().optional(),
  status: z
    .enum([
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
    ])
    .optional(),
  priority_tier: z.enum(['urgent', 'flexible']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().nonnegative().optional()
});

export const printJobsRoutes: FastifyPluginAsync<PrintJobsPluginOptions> = async (
  fastify,
  options
) => {
  const { printJobsService } = options;

  // 1. POST /api/v1/print-jobs (Create draft/order with quote or settings & idempotency)
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createPrintJobSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid print job creation payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const idempotencyKey =
        typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined;

      const shopId = parsed.data.shop_id || parsed.data.shopId;
      if (!shopId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'shop_id is required.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const input = {
        shop_id: shopId,
        quote_id: parsed.data.quote_id || parsed.data.quoteId,
        document_id: parsed.data.document_id || parsed.data.documentId,
        document_storage_key: parsed.data.document_storage_key || parsed.data.documentStorageKey,
        document_page_count:
          parsed.data.document_page_count ||
          parsed.data.documentPageCount ||
          parsed.data.page_count,
        printer_id: parsed.data.printer_id || parsed.data.printerId,
        settings: parsed.data.settings,
        priority_tier: parsed.data.priority_tier || parsed.data.priorityTier
      };

      const { job, isIdempotentReplay } = await printJobsService.createPrintJob(
        request.user!,
        input,
        idempotencyKey
      );

      const statusCode = isIdempotentReplay ? 200 : 201;
      return reply.status(statusCode).send({
        data: job,
        is_idempotent_replay: isIdempotentReplay
      });
    }
  );

  // 2. GET /api/v1/print-jobs (List role-scoped jobs)
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queryParsed = listJobsQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid query parameters.',
            request_id: request.requestId || 'unknown-request',
            details: queryParsed.error.errors
          }
        });
      }

      const result = await printJobsService.listPrintJobs(request.user!, {
        shop_id: queryParsed.data.shop_id,
        status: queryParsed.data.status as JobStatus | undefined,
        priority_tier: queryParsed.data.priority_tier,
        limit: queryParsed.data.limit,
        offset: queryParsed.data.offset
      });

      return reply.status(200).send({
        data: result.jobs,
        total: result.total
      });
    }
  );

  // 3. GET /api/v1/print-jobs/:id (Role-scoped single job read)
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const job = await printJobsService.getPrintJobById(request.user!, id);

      return reply.status(200).send({
        data: job
      });
    }
  );

  // 4. POST /api/v1/print-jobs/:id/approve (Owner approval per ADR 0004)
  fastify.post(
    '/:id/approve',
    { preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const job = await printJobsService.approvePrintJob(request.user!, id);

      return reply.status(200).send({
        data: job
      });
    }
  );

  // 5. POST /api/v1/print-jobs/:id/cancel (Customer / Owner cancellation)
  fastify.post(
    '/:id/cancel',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const bodyParsed = cancelJobSchema.safeParse(request.body ?? {});
      const reason = bodyParsed.success ? bodyParsed.data.reason : undefined;

      const job = await printJobsService.cancelPrintJob(request.user!, id, reason);

      return reply.status(200).send({
        data: job
      });
    }
  );

  // 6. PATCH /api/v1/print-jobs/:id/status (State machine transitions)
  fastify.patch(
    '/:id/status',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const bodyParsed = transitionStatusSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid state transition payload.',
            request_id: request.requestId || 'unknown-request',
            details: bodyParsed.error.errors
          }
        });
      }

      const job = await printJobsService.transitionJobStatus(
        request.user!,
        id,
        bodyParsed.data.status,
        bodyParsed.data.reason,
        bodyParsed.data.metadata
      );

      return reply.status(200).send({
        data: job
      });
    }
  );
};
