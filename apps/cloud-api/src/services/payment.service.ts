/**
 * Razorpay Payment Service for CAPS Cloud API (INT-D3-06).
 *
 * Implements:
 * - Razorpay order creation strictly in integer paise with currency 'INR'.
 * - Timing-safe HMAC SHA-256 webhook signature verification against RAZORPAY_WEBHOOK_SECRET.
 * - Idempotent payment processing with duplicate replay protection.
 * - Transition of print jobs to 'SUBMITTED' and payment status to 'CAPTURED'.
 * - Realtime broadcast trigger across 'caps:shop:<shopId>' and 'caps:job:<jobId>'.
 */

import crypto from 'node:crypto';
import type { IRazorpayClient } from '../modules/payments/razorpay.service.js';
import { createRazorpayClient } from '../modules/payments/razorpay.service.js';
import type { RazorpayOrderResponse } from '../modules/payments/payments.types.js';
import type { PricingService } from './pricing.service.js';
import type { RealtimeService } from './realtime.service.js';

export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'PAYMENT_ERROR'
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export class InvalidSignatureError extends PaymentError {
  constructor(message = 'Invalid Razorpay webhook signature.') {
    super(message, 400, 'INVALID_SIGNATURE');
    this.name = 'InvalidSignatureError';
  }
}

export class PaymentNotFoundError extends PaymentError {
  constructor(message = 'Resource not found.') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'PaymentNotFoundError';
  }
}

export class AmountTamperingError extends PaymentError {
  constructor(message = 'Amount tampering detected. Submitted amount does not match authoritative quote.') {
    super(message, 400, 'AMOUNT_TAMPERING_DETECTED');
    this.name = 'AmountTamperingError';
  }
}

export class InvalidJobStateError extends PaymentError {
  constructor(message = 'Job is not in a payable state.') {
    super(message, 400, 'INVALID_JOB_STATE');
    this.name = 'InvalidJobStateError';
  }
}

export interface PaymentOrderInput {
  print_job_id: string;
  amount_paise?: number | undefined;
  requested_amount_paise?: number | undefined;
  currency?: 'INR' | undefined;
  receipt?: string | undefined;
  notes?: Record<string, string> | undefined;
}

export interface PaymentOrderResult {
  order_id: string;
  amount_paise: number;
  currency: 'INR';
  key_id: string;
  receipt: string;
  print_job_id: string;
  status: string;
}

export interface WebhookProcessResult {
  acknowledged: boolean;
  is_idempotent_replay: boolean;
  status: 'processed' | 'already_processed' | 'ignored_out_of_order' | 'failed';
  message: string;
  job_id?: string | undefined;
  order_id?: string | undefined;
  payment_id?: string | undefined;
  event_id?: string | undefined;
}

export interface PaymentServiceOptions {
  razorpayKeyId?: string | undefined;
  razorpayKeySecret?: string | undefined;
  webhookSecret?: string | undefined;
  razorpayClient?: IRazorpayClient | undefined;
  pricingService?: PricingService | undefined;
  printJobsRepo?: any | undefined;
  paymentsRepo?: any | undefined;
  realtimeService?: RealtimeService | undefined;
  supabaseClient?: any | undefined;
}

export class PaymentService {
  private readonly razorpayClient: IRazorpayClient;
  private readonly webhookSecret: string;
  private readonly pricingService?: PricingService | undefined;
  private readonly printJobsRepo?: any | undefined;
  private readonly paymentsRepo?: any | undefined;
  private readonly realtimeService?: RealtimeService | undefined;
  private readonly supabaseClient?: any | undefined;
  private readonly processedEventIds = new Set<string>();
  private readonly successfulOrderIds = new Set<string>();
  private readonly successfulJobIds = new Set<string>();

  constructor(options: PaymentServiceOptions = {}) {
    const keyId = options.razorpayKeyId ?? process.env['RAZORPAY_KEY_ID'];
    const keySecret = options.razorpayKeySecret ?? process.env['RAZORPAY_KEY_SECRET'];

    this.razorpayClient =
      options.razorpayClient ??
      createRazorpayClient({
        keyId,
        keySecret,
        useMock: !keyId || !keySecret || process.env['NODE_ENV'] === 'test'
      });

    this.webhookSecret =
      options.webhookSecret ??
      process.env['RAZORPAY_WEBHOOK_SECRET'] ??
      'mock_webhook_secret_for_testing';

    this.pricingService = options.pricingService;
    this.printJobsRepo = options.printJobsRepo;
    this.paymentsRepo = options.paymentsRepo;
    this.realtimeService = options.realtimeService;
    this.supabaseClient = options.supabaseClient;
  }

  public getKeyId(): string {
    return this.razorpayClient.getKeyId();
  }

  /**
   * Verifies Razorpay HMAC SHA-256 signature against raw webhook body.
   * Constant-time comparison protects against timing attacks.
   */
  public verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!signature || !this.webhookSecret || !rawBody) {
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody, 'utf-8')
        .digest('hex');

      if (expectedSignature.length !== signature.length) {
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf-8'),
        Buffer.from(signature, 'utf-8')
      );
    } catch {
      return false;
    }
  }

  /**
   * Creates a Razorpay Order strictly in integer paise with currency 'INR'.
   * Authoritative price verification protects against client-side tampering.
   */
  public async createRazorpayOrder(input: PaymentOrderInput): Promise<PaymentOrderResult> {
    const jobId = input.print_job_id;
    if (!jobId) {
      throw new PaymentError('print_job_id is required.', 400, 'VALIDATION_ERROR');
    }

    let authoritativeAmountPaise = input.amount_paise ?? input.requested_amount_paise;

    // Check print job if repository is available
    if (this.printJobsRepo) {
      const job = await this.printJobsRepo.findById(jobId);
      if (!job) {
        throw new PaymentNotFoundError(`Print job '${jobId}' not found.`);
      }

      const payableStatuses = ['pending_payment', 'pending', 'quote_accepted'];
      if (!payableStatuses.includes(job.status)) {
        throw new InvalidJobStateError(
          `Cannot create payment order for job '${job.id}' in status '${job.status}'.`
        );
      }

      const expectedAmount = job.price_total_paise ?? job.priceTotalPaise ?? job.total_price_paise;
      if (typeof expectedAmount === 'number' && expectedAmount > 0) {
        // Enforce anti-tampering check
        if (
          input.requested_amount_paise !== undefined &&
          input.requested_amount_paise !== expectedAmount
        ) {
          throw new AmountTamperingError(
            `Amount tampering detected: Client submitted amount (${input.requested_amount_paise} paise) does not match authoritative price (${expectedAmount} paise).`
          );
        }
        authoritativeAmountPaise = expectedAmount;
      }
    }

    if (!authoritativeAmountPaise || authoritativeAmountPaise <= 0 || !Number.isInteger(authoritativeAmountPaise)) {
      throw new PaymentError(
        'Order amount must be a positive integer in paise.',
        400,
        'INVALID_AMOUNT'
      );
    }

    const receipt = input.receipt ?? `rcpt_${jobId.replace(/-/g, '').slice(0, 16)}`;

    const razorpayOrder: RazorpayOrderResponse = await this.razorpayClient.createOrder({
      amount_paise: authoritativeAmountPaise,
      currency: 'INR',
      receipt,
      notes: {
        ...(input.notes ?? {}),
        print_job_id: jobId
      }
    });

    // Record initiated payment in payments repository if provided
    if (this.paymentsRepo) {
      try {
        await this.paymentsRepo.create({
          print_job_id: jobId,
          amount_paise: razorpayOrder.amount,
          currency: 'INR',
          method: 'upi',
          gateway_ref: razorpayOrder.id,
          status: 'initiated'
        });
      } catch {
        // If payment already exists or table insert fails, ignore non-fatal recording
      }
    }

    return {
      order_id: razorpayOrder.id,
      amount_paise: razorpayOrder.amount,
      currency: 'INR',
      key_id: this.razorpayClient.getKeyId(),
      receipt: razorpayOrder.receipt,
      print_job_id: jobId,
      status: 'initiated'
    };
  }

  /**
   * Idempotently processes an authentic Razorpay webhook event.
   * Duplicate webhook deliveries return 200 OK without errors or double transitions.
   */
  public async handleWebhook(
    payload: any,
    rawBody: string,
    signature?: string | undefined
  ): Promise<WebhookProcessResult> {
    // 1. Signature validation
    if (!signature) {
      throw new InvalidSignatureError('Missing required x-razorpay-signature header.');
    }

    const isValid = this.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      throw new InvalidSignatureError('Razorpay webhook HMAC signature verification failed.');
    }

    const event = payload?.event;
    const paymentEntity = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;

    const paymentId: string | undefined = paymentEntity?.id;
    const orderId: string | undefined = paymentEntity?.order_id ?? orderEntity?.id;
    const amount: number = paymentEntity?.amount ?? orderEntity?.amount ?? 0;
    const method: string = paymentEntity?.method ?? 'upi';

    // Form unique event ID
    const eventId: string =
      payload?.event_id ??
      payload?.id ??
      (paymentId ? `evt_${paymentId}_${event}` : undefined) ??
      (orderId ? `evt_${orderId}_${event}` : `evt_manual_${Date.now()}`);

    // Associated Job ID lookup
    let jobId: string | undefined =
      paymentEntity?.notes?.print_job_id ??
      orderEntity?.notes?.print_job_id ??
      payload?.payload?.payment?.entity?.notes?.job_id;

    let shopId: string | undefined =
      paymentEntity?.notes?.shop_id ??
      orderEntity?.notes?.shop_id;

    if (!jobId && orderId && this.paymentsRepo) {
      const paymentRecord = await this.paymentsRepo.findByGatewayRef(orderId);
      if (paymentRecord) {
        jobId = paymentRecord.print_job_id;
      }
    }

    // 2. Replay check (In-memory & DB check)
    if (this.processedEventIds.has(eventId)) {
      return {
        acknowledged: true,
        is_idempotent_replay: true,
        status: 'already_processed',
        message: 'Webhook event already processed. Duplicate safely deduplicated.',
        event_id: eventId,
        order_id: orderId,
        payment_id: paymentId,
        job_id: jobId
      };
    }

    // 3. Stored Procedure / PricingService idempotent record
    if (this.pricingService) {
      try {
        const rpcResult = await this.pricingService.recordPaymentEventIdempotent({
          eventId,
          paymentId,
          jobId: jobId ?? '',
          amountPaise: amount,
          paymentMethod: method,
          status: event === 'payment.captured' || event === 'order.paid' ? 'captured' : 'failed',
          metadata: { event, order_id: orderId }
        });

        if (rpcResult.is_idempotent_replay) {
          this.processedEventIds.add(eventId);
          return {
            acknowledged: true,
            is_idempotent_replay: true,
            status: 'already_processed',
            message: 'Webhook event was already recorded in database. Safely deduplicated.',
            event_id: eventId,
            order_id: orderId,
            payment_id: paymentId,
            job_id: jobId
          };
        }
      } catch {
        // Fall back to direct repository handling
      }
    }

    // Direct Supabase table check if available
    if (this.supabaseClient && typeof this.supabaseClient.from === 'function') {
      try {
        const { data: existingEvent } = await this.supabaseClient
          .from('payment_events')
          .select('event_id')
          .eq('event_id', eventId)
          .maybeSingle();

        if (existingEvent) {
          this.processedEventIds.add(eventId);
          return {
            acknowledged: true,
            is_idempotent_replay: true,
            status: 'already_processed',
            message: 'Payment event already exists in payment_events table.',
            event_id: eventId,
            order_id: orderId,
            payment_id: paymentId,
            job_id: jobId
          };
        }
      } catch {
        // Continue processing
      }
    }

    // 4. Handle Out-of-Order failed event
    if (event === 'payment.failed') {
      let isAlreadySuccessful =
        (orderId && this.successfulOrderIds.has(orderId)) ||
        (jobId && this.successfulJobIds.has(jobId));

      if (!isAlreadySuccessful && this.paymentsRepo && orderId) {
        const existingPayment = await this.paymentsRepo.findByGatewayRef(orderId);
        if (existingPayment?.status === 'success') {
          isAlreadySuccessful = true;
        }
      }

      if (!isAlreadySuccessful && this.printJobsRepo && jobId) {
        const existingJob = await this.printJobsRepo.findById(jobId);
        if (existingJob?.status === 'SUBMITTED' || existingJob?.status === 'QUEUED') {
          isAlreadySuccessful = true;
        }
      }

      if (isAlreadySuccessful) {
        this.processedEventIds.add(eventId);
        return {
          acknowledged: true,
          is_idempotent_replay: true,
          status: 'ignored_out_of_order',
          message: 'Out-of-order payment.failed event safely ignored since payment is already successful.',
          order_id: orderId,
          payment_id: paymentId,
          job_id: jobId
        };
      }

      this.processedEventIds.add(eventId);
      return {
        acknowledged: true,
        is_idempotent_replay: false,
        status: 'processed',
        message: 'Payment failure acknowledged.',
        order_id: orderId,
        payment_id: paymentId
      };
    }

    // 5. Handle Payment Captured / Order Paid
    if (event === 'payment.captured' || event === 'order.paid') {
      if (orderId) {
        this.successfulOrderIds.add(orderId);
      }
      if (jobId) {
        this.successfulJobIds.add(jobId);
      }

      // Update payment record in repository if available
      if (this.paymentsRepo && orderId) {
        const paymentRecord = await this.paymentsRepo.findByGatewayRef(orderId);
        if (paymentRecord) {
          if (paymentRecord.status === 'success') {
            this.processedEventIds.add(eventId);
            return {
              acknowledged: true,
              is_idempotent_replay: true,
              status: 'already_processed',
              message: 'Payment already marked as successful. Duplicate safely deduplicated.',
              job_id: paymentRecord.print_job_id,
              order_id: orderId,
              payment_id: paymentId
            };
          }
          if (typeof this.paymentsRepo.update === 'function') {
            await this.paymentsRepo.update(paymentRecord.id, { status: 'success' });
          } else if (typeof (this.paymentsRepo as any).updateStatus === 'function') {
            await (this.paymentsRepo as any).updateStatus(paymentRecord.id, 'success');
          }
        } else if (jobId) {
          try {
            await this.paymentsRepo.create({
              print_job_id: jobId,
              amount_paise: amount,
              currency: 'INR',
              method,
              gateway_ref: orderId,
              status: 'success'
            });
          } catch {
            // Ignore insert conflict
          }
        }
      }

      // Transition print job status to 'SUBMITTED'
      if (this.printJobsRepo && jobId) {
        try {
          const job = await this.printJobsRepo.findById(jobId);
          if (job) {
            shopId = shopId ?? job.shop_id ?? job.shopId;
            if (typeof this.printJobsRepo.update === 'function') {
              await this.printJobsRepo.update(jobId, { status: 'SUBMITTED' });
            } else if (typeof this.printJobsRepo.updateStatus === 'function') {
              await this.printJobsRepo.updateStatus(jobId, 'SUBMITTED');
            } else {
              job.status = 'SUBMITTED';
            }
          }
        } catch {
          // Non-fatal if update fails
        }
      }

      // Record in Supabase payment_events table
      if (this.supabaseClient && typeof this.supabaseClient.from === 'function') {
        try {
          await this.supabaseClient.from('payment_events').insert({
            event_id: eventId,
            payment_id: paymentId,
            job_id: jobId ?? null,
            amount_paise: amount,
            method,
            status: 'captured',
            created_at: new Date().toISOString()
          });
        } catch {
          // Table constraint violation or offline fallback
        }
      }

      // Broadcast Realtime status event on caps:shop:<shopId> and caps:job:<jobId>
      if (this.realtimeService && jobId) {
        try {
          const effectiveShopId = shopId ?? 'default-shop';
          if (typeof (this.realtimeService as any).emitJobStatusUpdated === 'function') {
            await (this.realtimeService as any).emitJobStatusUpdated(effectiveShopId, jobId, {
              status: 'SUBMITTED',
              pagesPrinted: 0
            });
          } else if (typeof (this.realtimeService as any).broadcast === 'function') {
            await (this.realtimeService as any).broadcast(
              `caps:shop:${effectiveShopId}`,
              'job.status_updated',
              { jobId, shopId: effectiveShopId, status: 'SUBMITTED' }
            );
          }
        } catch {
          // Realtime broadcast failure is non-blocking
        }
      }

      // Mark event as processed
      this.processedEventIds.add(eventId);

      return {
        acknowledged: true,
        is_idempotent_replay: false,
        status: 'processed',
        message: 'Payment captured and job transitioned to SUBMITTED.',
        job_id: jobId,
        order_id: orderId,
        payment_id: paymentId,
        event_id: eventId
      };
    }

    this.processedEventIds.add(eventId);
    return {
      acknowledged: true,
      is_idempotent_replay: false,
      status: 'processed',
      message: `Webhook event '${event}' acknowledged.`,
      event_id: eventId,
      order_id: orderId
    };
  }
}
