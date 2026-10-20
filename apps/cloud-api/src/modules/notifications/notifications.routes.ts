import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { NotificationsService, NotificationError } from './notifications.service.js';

export interface NotificationsPluginOptions {
  notificationsService: NotificationsService;
}

const registerTokenSchema = z.object({
  user_id: z.string().uuid(),
  device_token: z.string().min(1),
  device_type: z.enum(['web', 'android', 'ios']).optional()
});

const unregisterTokenSchema = z.object({
  user_id: z.string().uuid(),
  device_token: z.string().min(1)
});

const historyQuerySchema = z.object({
  user_id: z.string().uuid()
});

const dispatchSchema = z.object({
  job_id: z.string().uuid(),
  event_type: z.enum(['job_queued', 'job_printing', 'job_ready', 'job_failed', 'job_cancelled']),
  failure_reason: z.string().optional(),
  pickup_code: z.string().optional(),
  queue_position: z.number().int().positive().optional(),
  estimated_wait_seconds: z.number().int().nonnegative().optional()
});

export const notificationsRoutes: FastifyPluginAsync<NotificationsPluginOptions> = async (
  fastify,
  options
) => {
  const { notificationsService } = options;

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof NotificationError) {
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

  // 1. Register client FCM device token
  fastify.post('/notifications/tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = registerTokenSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid FCM token registration payload.',
          details: parseResult.error.errors
        }
      });
    }

    try {
      const token = await notificationsService.registerToken(
        parseResult.data.user_id,
        parseResult.data.device_token,
        parseResult.data.device_type
      );
      return reply.status(200).send({
        data: token
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 2. Unregister / remove client FCM device token
  fastify.delete('/notifications/tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = unregisterTokenSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid token unregistration payload.',
          details: parseResult.error.errors
        }
      });
    }

    try {
      const removed = await notificationsService.unregisterToken(
        parseResult.data.user_id,
        parseResult.data.device_token
      );
      return reply.status(200).send({
        data: { removed }
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 3. Query user notification history
  fastify.get(
    '/notifications/history',
    async (
      request: FastifyRequest<{ Querystring: Record<string, unknown> }>,
      reply: FastifyReply
    ) => {
      const queryResult = historyQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid history query parameters. user_id must be a UUID.',
            details: queryResult.error.errors
          }
        });
      }

      try {
        const history = await notificationsService.getHistory(queryResult.data.user_id);
        return reply.status(200).send({
          data: history
        });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 4. Trigger lifecycle notification dispatch (or test webhook/admin)
  fastify.post('/notifications/dispatch', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = dispatchSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid notification dispatch payload.',
          details: parseResult.error.errors
        }
      });
    }

    try {
      const result = await notificationsService.dispatchJobLifecycleNotification(
        parseResult.data.job_id,
        parseResult.data.event_type,
        {
          failure_reason: parseResult.data.failure_reason,
          pickup_code: parseResult.data.pickup_code,
          queue_position: parseResult.data.queue_position,
          estimated_wait_seconds: parseResult.data.estimated_wait_seconds
        }
      );
      return reply.status(200).send({
        data: result
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });
};
