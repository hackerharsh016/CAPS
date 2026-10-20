/**
 * Privacy & Document Retention Routes for CAPS.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { PrivacyRetentionService } from './privacy-retention.service.js';

export interface PrivacyCleanupPluginOptions {
  privacyService: PrivacyRetentionService;
}

const triggerCleanupSchema = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  as_of_time: z.string().datetime().optional()
});

const auditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional()
});

export const privacyCleanupRoutes: FastifyPluginAsync<PrivacyCleanupPluginOptions> = async (
  fastify,
  options
) => {
  const { privacyService } = options;

  // 1. Trigger document retention cleanup sweep
  fastify.post('/cleanup', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = triggerCleanupSchema.safeParse(request.body ?? {});
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid cleanup trigger payload.',
          details: parseResult.error.errors
        }
      });
    }

    try {
      const now = parseResult.data.as_of_time ? new Date(parseResult.data.as_of_time) : new Date();
      const limit = parseResult.data.limit ?? 100;

      const results = await privacyService.runFullSweep(now, limit);
      return reply.status(200).send({
        status: 'ok',
        data: results
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Cleanup sweep failed';
      return reply.status(500).send({
        error: {
          code: 'CLEANUP_SWEEP_FAILED',
          message
        }
      });
    }
  });

  // 2. Disclose privacy policy, retention parameters & spooler hardware caveats
  fastify.get('/cleanup/policy', async (_request: FastifyRequest, reply: FastifyReply) => {
    const policy = privacyService.getPrivacyPolicy();
    return reply.status(200).send({
      data: policy
    });
  });

  // 3. Fetch immutable audit logs of document destructions
  fastify.get('/cleanup/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = auditLogsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters.',
          details: parseResult.error.errors
        }
      });
    }

    const limit = parseResult.data.limit ?? 100;
    const logs = await privacyService.getAuditLogs(limit);

    return reply.status(200).send({
      data: logs
    });
  });
};
