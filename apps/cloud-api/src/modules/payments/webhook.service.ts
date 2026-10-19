import type { IPrintJobsRepository } from '../print-jobs/print-jobs.repository.js';
import type { IPaymentsRepository } from './payments.repository.js';
import type { IRazorpayClient } from './razorpay.service.js';
import type { IJobEventsRepository } from '../events/events.repository.js';
import { verifyRazorpayWebhookSignature } from './razorpay.service.js';
import type {
  RazorpayWebhookPayload,
  WebhookProcessingResult,
  ReconcilePaymentRequestDto,
  ReconcilePaymentResponseDto
} from './payments.types.js';

export class InvalidSignatureError extends Error {
  constructor(message = 'Invalid Razorpay webhook signature') {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

export class WebhookService {
  constructor(
    private readonly printJobsRepo: IPrintJobsRepository,
    private readonly paymentsRepo: IPaymentsRepository,
    private readonly razorpayClient: IRazorpayClient,
    private readonly jobEventsRepo: IJobEventsRepository,
    private readonly webhookSecret: string
  ) {}

  /**
   * Verifies HMAC-SHA256 signature against raw request body using constant-time comparison.
   */
  verifySignature(rawBody: string, signature: string): boolean {
    return verifyRazorpayWebhookSignature(rawBody, signature, this.webhookSecret);
  }

  /**
   * Processes a verified Razorpay webhook payload with strict replay protection
   * and out-of-order safeguards.
   */
  async handleWebhook(
    payload: RazorpayWebhookPayload,
    rawBody: string,
    signature?: string | undefined
  ): Promise<WebhookProcessingResult> {
    // 1. Signature verification
    if (signature !== undefined) {
      const isValid = this.verifySignature(rawBody, signature);
      if (!isValid) {
        throw new InvalidSignatureError('Razorpay webhook HMAC signature verification failed.');
      }
    }

    const event = payload.event;

    // 2. Handle Payment Captured / Order Paid
    if (event === 'payment.captured' || event === 'order.paid') {
      const orderId =
        payload.payload.payment?.entity.order_id ?? payload.payload.order?.entity.id;
      const paymentId = payload.payload.payment?.entity.id;
      const amount =
        payload.payload.payment?.entity.amount ?? payload.payload.order?.entity.amount ?? 0;
      const method = payload.payload.payment?.entity.method ?? 'upi';

      if (!orderId) {
        return {
          success: false,
          status: 'already_processed',
          message: 'Webhook payload missing order ID reference.'
        };
      }

      // Lookup payment by gateway order reference
      const payment = await this.paymentsRepo.findByGatewayRef(orderId);
      if (!payment) {
        return {
          success: false,
          status: 'already_processed',
          order_id: orderId,
          message: `No payment record found for order ${orderId}`
        };
      }

      // Safeguard: Check for duplicate / repeated webhook replay
      if (payment.status === 'success') {
        return {
          success: true,
          status: 'already_processed',
          job_id: payment.print_job_id,
          order_id: orderId,
          payment_id: paymentId,
          message: 'Payment already marked as successful. Repeated webhook safely deduplicated.'
        };
      }

      // Lookup print job
      const job = await this.printJobsRepo.findById(payment.print_job_id);
      if (!job) {
        return {
          success: false,
          status: 'already_processed',
          order_id: orderId,
          message: `Print job ${payment.print_job_id} not found`
        };
      }

      // Transition payment to success
      await this.paymentsRepo.update(payment.id, {
        status: 'success'
      });

      // Transition print job to queued and stamp enqueued_at for FIFO ordering
      const enqueuedAt = new Date().toISOString();
      await this.printJobsRepo.update(job.id, {
        status: 'queued',
        enqueued_at: enqueuedAt
      });

      // Append immutable audit event in job_events ledger
      await this.jobEventsRepo.create({
        job_id: job.id,
        actor_type: 'system',
        from_status: job.status,
        to_status: 'queued',
        event_name: 'payment_verified',
        metadata: {
          gateway_ref: orderId,
          payment_id: paymentId ?? 'unknown',
          amount_paise: amount,
          method
        }
      });

      return {
        success: true,
        status: 'processed',
        job_id: job.id,
        order_id: orderId,
        payment_id: paymentId,
        message: 'Payment successfully captured and print job enqueued.'
      };
    }

    // 3. Handle Payment Failed
    if (event === 'payment.failed') {
      const orderId = payload.payload.payment?.entity.order_id;
      const paymentId = payload.payload.payment?.entity.id;
      const errorCode = payload.payload.payment?.entity.error_code;
      const errorDesc = payload.payload.payment?.entity.error_description;

      if (!orderId) {
        return {
          success: false,
          status: 'payment_failed_recorded',
          message: 'Payment failed event missing order ID.'
        };
      }

      const payment = await this.paymentsRepo.findByGatewayRef(orderId);
      if (!payment) {
        return {
          success: false,
          status: 'payment_failed_recorded',
          order_id: orderId,
          message: `Payment record not found for order ${orderId}`
        };
      }

      // Out-of-order safeguard: If payment already succeeded, DO NOT downgrade to failed!
      if (payment.status === 'success') {
        return {
          success: true,
          status: 'ignored_out_of_order',
          job_id: payment.print_job_id,
          order_id: orderId,
          payment_id: paymentId,
          message: 'Payment already succeeded. Out-of-order failed webhook safely ignored.'
        };
      }

      // Mark payment failed
      await this.paymentsRepo.update(payment.id, {
        status: 'failed'
      });

      // Record audit failure event without modifying print job pending state
      await this.jobEventsRepo.create({
        job_id: payment.print_job_id,
        actor_type: 'system',
        from_status: 'pending_payment',
        to_status: 'pending_payment',
        event_name: 'payment_failed',
        metadata: {
          gateway_ref: orderId,
          payment_id: paymentId ?? 'unknown',
          error_code: errorCode ?? 'PAYMENT_DECLINED',
          error_description: errorDesc ?? 'Payment declined by gateway'
        }
      });

      return {
        success: true,
        status: 'payment_failed_recorded',
        job_id: payment.print_job_id,
        order_id: orderId,
        payment_id: paymentId,
        message: 'Payment failure recorded; job remains pending for retry.'
      };
    }

    return {
      success: true,
      status: 'already_processed',
      message: `Ignored unhandled webhook event type: ${event}`
    };
  }

  /**
   * Reconciles payment state directly with Razorpay gateway across client disconnects.
   * If client browser crashed or disconnected during payment, this queries the authoritative
   * order status and updates database accordingly.
   */
  async reconcilePayment(dto: ReconcilePaymentRequestDto): Promise<ReconcilePaymentResponseDto> {
    let orderId = dto.order_id;
    let jobId = dto.print_job_id;

    if (!orderId && !jobId) {
      throw new Error('Either print_job_id or order_id must be provided for reconciliation.');
    }

    let payment = orderId ? await this.paymentsRepo.findByGatewayRef(orderId) : null;

    if (!payment && jobId) {
      const payments = await this.paymentsRepo.findByJobId(jobId);
      payment = payments[0] ?? null;
      if (payment?.gateway_ref) {
        orderId = payment.gateway_ref;
      }
    }

    if (!payment) {
      throw new Error(`No payment record found for reconciliation.`);
    }

    jobId = payment.print_job_id;
    const job = await this.printJobsRepo.findById(jobId);
    if (!job) {
      throw new Error(`Print job '${jobId}' not found.`);
    }

    // If already marked success locally, reconciliation is already complete
    if (payment.status === 'success') {
      return {
        success: true,
        print_job_id: job.id,
        payment_status: 'success',
        job_status: job.status,
        reconciled: false,
        ...(orderId !== undefined ? { order_id: orderId } : {})
      };
    }

    // Query authoritative gateway order status
    if (orderId) {
      const gatewayOrder = await this.razorpayClient.getOrder(orderId);
      if (gatewayOrder && gatewayOrder.status === 'paid') {
        // Authoritative reconciliation: Gateway confirmed payment
        await this.paymentsRepo.update(payment.id, {
          status: 'success'
        });

        const enqueuedAt = new Date().toISOString();
        await this.printJobsRepo.update(job.id, {
          status: 'queued',
          enqueued_at: enqueuedAt
        });

        await this.jobEventsRepo.create({
          job_id: job.id,
          actor_type: 'system',
          from_status: job.status,
          to_status: 'queued',
          event_name: 'payment_reconciled',
          metadata: {
            gateway_ref: orderId,
            amount_paise: gatewayOrder.amount
          }
        });

        return {
          success: true,
          print_job_id: job.id,
          payment_status: 'success',
          job_status: 'queued',
          reconciled: true,
          order_id: orderId
        };
      }
    }

    return {
      success: true,
      print_job_id: job.id,
      payment_status: payment.status,
      job_status: job.status,
      reconciled: false,
      ...(orderId !== undefined ? { order_id: orderId } : {})
    };
  }
}
