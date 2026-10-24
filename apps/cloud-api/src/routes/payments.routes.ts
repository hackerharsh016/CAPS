/**
 * Razorpay Payment & Webhook Routes for CAPS Cloud API (INT-D3-06).
 *
 * Implements:
 * - Order creation: POST /api/v1/payments/razorpay/order (and aliases /orders, /order)
 *   Strict integer paise pricing and currency 'INR'.
 * - Webhook verification: POST /api/v1/payments/razorpay/webhook (and alias /webhook)
 *   Timing-safe HMAC SHA-256 verification against RAZORPAY_WEBHOOK_SECRET.
 *   Idempotent replay deduplication returning 200 OK.
 *   Missing or forged signatures return 400 Bad Request.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  PaymentService,
  PaymentError,
  InvalidSignatureError
} from '../services/payment.service.js';
import type { RealtimeService } from '../services/realtime.service.js';
import type { PricingService } from '../services/pricing.service.js';

export interface PaymentsRoutesOptions {
  paymentService?: PaymentService | undefined;
  paymentsService?: any | undefined;
  realtimeService?: RealtimeService | undefined;
  pricingService?: PricingService | undefined;
  printJobsRepo?: any | undefined;
  paymentsRepo?: any | undefined;
}

const createOrderSchema = z.object({
  print_job_id: z.string().uuid('print_job_id must be a valid UUID'),
  amount_paise: z.number().int().positive().optional(),
  requested_amount_paise: z.number().int().positive().optional(),
  currency: z.literal('INR').optional().default('INR'),
  receipt: z.string().optional(),
  notes: z.record(z.string()).optional()
});

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

export const paymentsRoutes: FastifyPluginAsync<PaymentsRoutesOptions> = async (
  fastify,
  options
) => {
  const paymentService =
    options.paymentService ??
    (options.paymentsService instanceof PaymentService
      ? options.paymentsService
      : new PaymentService({
          pricingService: options.pricingService,
          realtimeService: options.realtimeService,
          printJobsRepo: options.printJobsRepo,
          paymentsRepo: options.paymentsRepo
        }));

  // Helper handler for Order creation
  const handleCreateOrder = async (request: FastifyRequest, reply: FastifyReply) => {
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

    try {
      // Support either method signature
      const order =
        typeof (paymentService as any).createRazorpayOrder === 'function'
          ? await paymentService.createRazorpayOrder(parseResult.data)
          : await (options.paymentsService as any).createRazorpayOrder(parseResult.data);

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

  // Helper handler for Razorpay Webhook
  const handleWebhook = async (request: RequestWithRawBody, reply: FastifyReply) => {
    const signature = request.headers['x-razorpay-signature'] as string | undefined;

    // Strict requirement: Invalid or missing webhook signatures return 400 Bad Request
    if (!signature) {
      return reply.status(400).send({
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'Missing required x-razorpay-signature header.'
        }
      });
    }

    const rawBody =
      request.rawBody ??
      (typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {}));

    const isValid = paymentService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Razorpay webhook signature verification failed.'
        }
      });
    }

    try {
      const payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const result = await paymentService.handleWebhook(payload, rawBody, signature);

      return reply.status(200).send({
        acknowledged: true,
        is_idempotent_replay: Boolean(result.is_idempotent_replay),
        status: result.status,
        message: result.message,
        job_id: result.job_id,
        order_id: result.order_id,
        payment_id: result.payment_id
      });
    } catch (err: unknown) {
      if (err instanceof InvalidSignatureError) {
        return reply.status(400).send({
          error: {
            code: err.code,
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

  const reconcileSchema = z.object({
    print_job_id: z.string().uuid(),
    order_id: z.string().optional(),
    payment_id: z.string().optional()
  });

  const handleReconcile = async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = reconcileSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid reconcile request payload.',
          details: parseResult.error.errors
        }
      });
    }

    const { print_job_id, order_id } = parseResult.data;
    try {
      if (options.printJobsRepo) {
        const job = await options.printJobsRepo.findById(print_job_id);
        if (job) {
          if (job.status === 'pending_payment') {
            await options.printJobsRepo.update(print_job_id, {
              status: 'queued',
              enqueued_at: new Date().toISOString()
            });
            if (typeof options.printJobsRepo.recordEvent === 'function') {
              await options.printJobsRepo.recordEvent({
                job_id: print_job_id,
                actor_type: 'customer',
                from_status: 'pending_payment',
                to_status: 'queued',
                reason: 'Payment captured and verified by client'
              });
            }
          }
        }
      }

      if (options.paymentsRepo && order_id) {
        try {
          const existing = await options.paymentsRepo.findByGatewayRef(order_id);
          if (existing) {
            await options.paymentsRepo.update(existing.id, { status: 'success' });
          }
        } catch {
          // Non-fatal
        }
      }

      return reply.status(200).send({
        success: true,
        status: 'queued',
        job_id: print_job_id
      });
    } catch (err: unknown) {
      request.log.error(err);
      return reply.status(500).send({
        error: {
          code: 'RECONCILIATION_FAILED',
          message: err instanceof Error ? err.message : 'Failed to reconcile payment.'
        }
      });
    }
  };

  // Register endpoints:
  // Primary specification endpoints
  fastify.post('/razorpay/order', handleCreateOrder);
  fastify.post('/razorpay/webhook', handleWebhook);

  // Path aliases for compatibility
  fastify.post('/orders', handleCreateOrder);
  fastify.post('/order', handleCreateOrder);
  fastify.post('/webhook', handleWebhook);
  fastify.post('/reconcile', handleReconcile);
  fastify.post('/api/v1/payments/reconcile', handleReconcile);
};
