import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPaymentsRepository } from '../src/modules/payments/payments.repository.js';
import { MockJobEventsRepository } from '../src/modules/events/events.repository.js';
import { MockJobAttemptsRepository } from '../src/modules/attempts/attempts.repository.js';
import { MockRazorpayClient } from '../src/modules/payments/razorpay.service.js';
import { WebhookService, InvalidSignatureError } from '../src/modules/payments/webhook.service.js';
import { JobClaimService } from '../src/modules/print-jobs/claim.service.js';
import type { PrintJob } from '../src/modules/print-jobs/print-jobs.types.js';
import type { RazorpayWebhookPayload } from '../src/modules/payments/payments.types.js';

describe('Task P06-M01-F02: Trusted Payment Webhook & Reconciliation', () => {
  const webhookSecret = 'test_secret_for_razorpay_webhook_12345';
  let printJobsRepo: MockPrintJobsRepository;
  let paymentsRepo: MockPaymentsRepository;
  let razorpayClient: MockRazorpayClient;
  let jobEventsRepo: MockJobEventsRepository;
  let attemptsRepo: MockJobAttemptsRepository;
  let webhookService: WebhookService;
  let claimService: JobClaimService;

  const samplePendingJobId = '77777777-1111-2222-3333-444444444444';
  const sampleOrderId = 'order_test_webhook_001';
  const samplePaymentId = 'pay_test_capture_001';

  function signPayload(bodyStr: string, secret = webhookSecret): string {
    return crypto.createHmac('sha256', secret).update(bodyStr, 'utf-8').digest('hex');
  }

  beforeEach(async () => {
    printJobsRepo = new MockPrintJobsRepository();
    paymentsRepo = new MockPaymentsRepository();
    razorpayClient = new MockRazorpayClient('rzp_test_mock_caps_key');
    jobEventsRepo = new MockJobEventsRepository();
    attemptsRepo = new MockJobAttemptsRepository();

    webhookService = new WebhookService(
      printJobsRepo,
      paymentsRepo,
      razorpayClient,
      jobEventsRepo,
      webhookSecret
    );

    claimService = new JobClaimService(attemptsRepo);

    // Seed a pending print job
    const job: PrintJob = {
      id: samplePendingJobId,
      shop_id: 'shop-uuid-001',
      customer_id: 'customer-uuid-001',
      document_storage_key: 'keys/sample-unpaid-doc.pdf',
      settings: { paper_size: 'a4', color_mode: 'bw', copies: 1 },
      priority_tier: 'urgent',
      price_total_paise: 2950,
      price_breakdown: {
        base_pages_paise: 200,
        urgent_surcharge_paise: 2500,
        gst_paise: 250,
        total_paise: 2950
      },
      status: 'pending_payment',
      document_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      created_at: new Date().toISOString()
    };
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(samplePendingJobId, job);

    // Seed initiated payment record with gateway reference
    await paymentsRepo.create({
      print_job_id: samplePendingJobId,
      amount_paise: 2950,
      currency: 'INR',
      method: 'upi',
      gateway_ref: sampleOrderId,
      status: 'initiated'
    });
  });

  // ============================================================================
  // Test Evidence 1: Forged Webhook Rejected
  // ============================================================================
  describe('Forged Webhook Rejection', () => {
    const samplePayload: RazorpayWebhookPayload = {
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: samplePaymentId,
            order_id: sampleOrderId,
            amount: 2950,
            currency: 'INR',
            status: 'captured',
            method: 'upi'
          }
        }
      }
    };

    it('rejects forged webhook with invalid signature', async () => {
      const rawBody = JSON.stringify(samplePayload);
      const forgedSignature = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      expect(webhookService.verifySignature(rawBody, forgedSignature)).toBe(false);

      await expect(
        webhookService.handleWebhook(samplePayload, rawBody, forgedSignature)
      ).rejects.toThrow(InvalidSignatureError);

      // Verify payment was NOT transitioned to success
      const payment = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(payment?.status).toBe('initiated');

      // Verify job is still pending payment and NOT claimable
      const job = await printJobsRepo.findById(samplePendingJobId);
      expect(job?.status).toBe('pending_payment');
    });

    it('rejects forged webhook signed with incorrect secret', async () => {
      const rawBody = JSON.stringify(samplePayload);
      const signatureWrongSecret = signPayload(rawBody, 'wrong_secret_key');

      expect(webhookService.verifySignature(rawBody, signatureWrongSecret)).toBe(false);

      await expect(
        webhookService.handleWebhook(samplePayload, rawBody, signatureWrongSecret)
      ).rejects.toThrow(InvalidSignatureError);
    });

    it('verifies and accepts authentically signed webhook', async () => {
      const rawBody = JSON.stringify(samplePayload);
      const authenticSignature = signPayload(rawBody);

      expect(webhookService.verifySignature(rawBody, authenticSignature)).toBe(true);

      const result = await webhookService.handleWebhook(samplePayload, rawBody, authenticSignature);
      expect(result.success).toBe(true);
      expect(result.status).toBe('processed');
    });
  });

  // ============================================================================
  // Test Evidence 2: Repeated Webhook Safely Deduped
  // ============================================================================
  describe('Repeated Webhook Replay Protection & Deduplication', () => {
    const samplePayload: RazorpayWebhookPayload = {
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: samplePaymentId,
            order_id: sampleOrderId,
            amount: 2950,
            currency: 'INR',
            status: 'captured',
            method: 'upi'
          }
        }
      }
    };

    it('safely deduplicates repeated webhook delivery without duplicate state updates', async () => {
      const rawBody = JSON.stringify(samplePayload);
      const signature = signPayload(rawBody);

      // 1. Initial valid delivery
      const firstResult = await webhookService.handleWebhook(samplePayload, rawBody, signature);
      expect(firstResult.success).toBe(true);
      expect(firstResult.status).toBe('processed');

      // State is updated
      const paymentAfterFirst = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(paymentAfterFirst?.status).toBe('success');

      const jobAfterFirst = await printJobsRepo.findById(samplePendingJobId);
      expect(jobAfterFirst?.status).toBe('queued');
      expect(jobAfterFirst?.enqueued_at).toBeDefined();

      const eventsAfterFirst = await jobEventsRepo.findByJobId(samplePendingJobId);
      expect(eventsAfterFirst).toHaveLength(1);
      expect(eventsAfterFirst[0]?.event_name).toBe('payment_verified');

      // 2. Duplicate / Repeated webhook delivery (e.g. gateway retry)
      const secondResult = await webhookService.handleWebhook(samplePayload, rawBody, signature);
      expect(secondResult.success).toBe(true);
      expect(secondResult.status).toBe('already_processed');
      expect(secondResult.message).toContain('Repeated webhook safely deduplicated');

      // Verify no duplicate events were created
      const eventsAfterSecond = await jobEventsRepo.findByJobId(samplePendingJobId);
      expect(eventsAfterSecond).toHaveLength(1);
    });
  });

  // ============================================================================
  // Test Evidence 3: Out-of-Order Webhook Rejected or Safely Ignored
  // ============================================================================
  describe('Out-of-Order Webhook Handling', () => {
    it('safely ignores delayed payment.failed event arriving after payment.captured', async () => {
      // 1. First, payment succeeds via payment.captured
      const capturedPayload: RazorpayWebhookPayload = {
        entity: 'event',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: samplePaymentId,
              order_id: sampleOrderId,
              amount: 2950,
              currency: 'INR',
              status: 'captured',
              method: 'upi'
            }
          }
        }
      };

      const capturedRaw = JSON.stringify(capturedPayload);
      await webhookService.handleWebhook(capturedPayload, capturedRaw, signPayload(capturedRaw));

      // Verify state is success & queued
      const payment = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(payment?.status).toBe('success');
      const job = await printJobsRepo.findById(samplePendingJobId);
      expect(job?.status).toBe('queued');

      // 2. Delayed out-of-order payment.failed webhook arrives
      const failedPayload: RazorpayWebhookPayload = {
        entity: 'event',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_earlier_failed_attempt',
              order_id: sampleOrderId,
              amount: 2950,
              currency: 'INR',
              status: 'failed',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Earlier attempt timed out'
            }
          }
        }
      };

      const failedRaw = JSON.stringify(failedPayload);
      const failedResult = await webhookService.handleWebhook(
        failedPayload,
        failedRaw,
        signPayload(failedRaw)
      );

      expect(failedResult.success).toBe(true);
      expect(failedResult.status).toBe('ignored_out_of_order');
      expect(failedResult.message).toContain('Out-of-order failed webhook safely ignored');

      // Crucial: Payment status MUST NOT be downgraded!
      const paymentAfterOutOrder = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(paymentAfterOutOrder?.status).toBe('success');

      // Crucial: Job MUST remain queued!
      const jobAfterOutOrder = await printJobsRepo.findById(samplePendingJobId);
      expect(jobAfterOutOrder?.status).toBe('queued');
    });

    it('records failure event when payment.failed arrives while payment is still initiated', async () => {
      const failedPayload: RazorpayWebhookPayload = {
        entity: 'event',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_declined_001',
              order_id: sampleOrderId,
              amount: 2950,
              currency: 'INR',
              status: 'failed',
              error_code: 'INSUFFICIENT_FUNDS',
              error_description: 'Account balance insufficient'
            }
          }
        }
      };

      const failedRaw = JSON.stringify(failedPayload);
      const result = await webhookService.handleWebhook(
        failedPayload,
        failedRaw,
        signPayload(failedRaw)
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('payment_failed_recorded');

      const payment = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(payment?.status).toBe('failed');

      // Job remains pending_payment for retry
      const job = await printJobsRepo.findById(samplePendingJobId);
      expect(job?.status).toBe('pending_payment');

      const events = await jobEventsRepo.findByJobId(samplePendingJobId);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_name).toBe('payment_failed');
    });
  });

  // ============================================================================
  // Test Evidence 4: Reconciliation Across Client Disconnect
  // ============================================================================
  describe('Client Disconnect Reconciliation', () => {
    it('reconciles payment state directly with gateway when browser disconnected', async () => {
      // Simulate: Order was created, client paid on Razorpay, but closed browser before redirect.
      // Gateway marks order as 'paid'.
      razorpayClient.setOrderStatus(sampleOrderId, 'paid');

      // Client returns to app or reconnects, triggering reconciliation
      const reconResult = await webhookService.reconcilePayment({
        print_job_id: samplePendingJobId
      });

      expect(reconResult.success).toBe(true);
      expect(reconResult.payment_status).toBe('success');
      expect(reconResult.job_status).toBe('queued');
      expect(reconResult.reconciled).toBe(true);

      // Verify database updated
      const payment = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(payment?.status).toBe('success');

      const job = await printJobsRepo.findById(samplePendingJobId);
      expect(job?.status).toBe('queued');

      // Verify job is now claimable by print agent
      const claimResult = await claimService.claimJob({
        job: job!,
        printer_id: 'printer-001',
        agent_device_id: 'agent-pc-001',
        idempotency_key: 'claim-after-reconciliation-01'
      });
      expect(claimResult.id).toBeDefined();
      expect(claimResult.status).toBe('leased');
    });

    it('returns current state without transition when gateway order is not paid', async () => {
      // Gateway order is still 'created'
      const reconResult = await webhookService.reconcilePayment({
        order_id: sampleOrderId
      });

      expect(reconResult.success).toBe(true);
      expect(reconResult.payment_status).toBe('initiated');
      expect(reconResult.job_status).toBe('pending_payment');
      expect(reconResult.reconciled).toBe(false);
    });
  });

  // ============================================================================
  // HTTP Endpoint Integration Tests
  // ============================================================================
  describe('HTTP Endpoints: Webhook & Reconcile', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp({
        printJobsRepo,
        paymentsRepo,
        razorpayClient,
        jobEventsRepo,
        webhookService
      });
    });

    it('POST /api/v1/webhooks/razorpay returns 200 with valid signature and captures payment', async () => {
      const payload: RazorpayWebhookPayload = {
        entity: 'event',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: samplePaymentId,
              order_id: sampleOrderId,
              amount: 2950,
              currency: 'INR',
              status: 'captured',
              method: 'upi'
            }
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPayload(rawBody);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.acknowledged).toBe(true);
      expect(json.status).toBe('processed');

      // Database state verified
      const payment = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(payment?.status).toBe('success');
      const job = await printJobsRepo.findById(samplePendingJobId);
      expect(job?.status).toBe('queued');
    });

    it('POST /api/v1/webhooks/razorpay returns 401 when signature is forged', async () => {
      const payload = { event: 'payment.captured' };
      const rawBody = JSON.stringify(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'forged_signature_00000000000000000000000000000000'
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('INVALID_SIGNATURE');
    });

    it('POST /api/v1/webhooks/razorpay returns 400 when signature header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/razorpay',
        headers: {
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify({ event: 'payment.captured' })
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('MISSING_SIGNATURE');
    });

    it('POST /api/v1/payments/reconcile successfully recovers disconnected payment', async () => {
      razorpayClient.setOrderStatus(sampleOrderId, 'paid');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/reconcile',
        payload: {
          order_id: sampleOrderId
        }
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.payment_status).toBe('success');
      expect(json.data.job_status).toBe('queued');
      expect(json.data.reconciled).toBe(true);
    });
  });
});
