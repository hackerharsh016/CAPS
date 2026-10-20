import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { WebhookService, InvalidSignatureError } from './webhook.service.js';
import type { RazorpayWebhookPayload } from './payments.types.js';

export interface WebhookPluginOptions {
  webhookService: WebhookService;
}

const reconcileSchema = z.object({
  print_job_id: z.string().uuid().optional(),
  order_id: z.string().optional()
});

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

export const webhookRoutes: FastifyPluginAsync<WebhookPluginOptions> = async (fastify, options) => {
  const { webhookService } = options;

  // Webhook handler function supporting both /api/v1/webhooks/razorpay and /api/v1/payments/webhook
  const handleWebhookRequest = async (request: RequestWithRawBody, reply: FastifyReply) => {
    const signature = request.headers['x-razorpay-signature'] as string | undefined;
    const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});

    if (!signature) {
      return reply.status(400).send({
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'Missing required x-razorpay-signature header.'
        }
      });
    }

    try {
      const result = await webhookService.handleWebhook(
        request.body as RazorpayWebhookPayload,
        rawBody,
        signature
      );
      return reply.status(200).send({
        acknowledged: true,
        status: result.status,
        message: result.message
      });
    } catch (err: unknown) {
      if (err instanceof InvalidSignatureError) {
        return reply.status(401).send({
          error: {
            code: 'INVALID_SIGNATURE',
            message: err.message
          }
        });
      }

      request.log.error(err);
      return reply.status(500).send({
        error: {
          code: 'WEBHOOK_PROCESSING_FAILED',
          message: 'Failed to process webhook event.'
        }
      });
    }
  };

  // 1. Master plan specification endpoint: /api/v1/webhooks/razorpay
  fastify.post('/webhooks/razorpay', handleWebhookRequest);

  // 2. Feature-specific path alias: /api/v1/payments/webhook
  fastify.post('/payments/webhook', handleWebhookRequest);

  // 3. Client disconnect recovery: /api/v1/payments/reconcile
  fastify.post('/payments/reconcile', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = reconcileSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid reconcile request parameters.',
          details: parseResult.error.errors
        }
      });
    }

    try {
      const result = await webhookService.reconcilePayment(parseResult.data);
      return reply.status(200).send({
        data: result
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Payment reconciliation failed.';
      return reply.status(400).send({
        error: {
          code: 'RECONCILIATION_FAILED',
          message: errorMessage
        }
      });
    }
  });
};
