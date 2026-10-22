import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fastify, { FastifyInstance } from 'fastify';
import { paymentsRoutes } from '../payments.routes.js';
import { PaymentService } from '../../services/payment.service.js';
import { PricingService } from '../../services/pricing.service.js';
import { RealtimeService } from '../../services/realtime.service.js';
import { MockPrintJobsRepository } from '../../modules/print-jobs/print-jobs.repository.js';
import { MockPaymentsRepository } from '../../modules/payments/payments.repository.js';
import { MockRazorpayClient } from '../../modules/payments/razorpay.service.js';

describe('Task INT-D3-06: Razorpay Webhook Verification & Idempotent Payment Routes', () => {
  const webhookSecret = 'test_secret_for_razorpay_webhook_int_d3_06';
  const sampleJobId = '77777777-1111-2222-3333-444444444444';
  const sampleShopId = '11111111-2222-3333-4444-555555555555';
  const sampleOrderId = 'order_test_rzp_001';
  const samplePaymentId = 'pay_test_rzp_001';

  let app: FastifyInstance;
  let printJobsRepo: MockPrintJobsRepository;
  let paymentsRepo: MockPaymentsRepository;
  let razorpayClient: MockRazorpayClient;
  let realtimeService: RealtimeService;
  let pricingService: PricingService;
  let paymentService: PaymentService;

  function signPayload(bodyStr: string, secret = webhookSecret): string {
    return crypto.createHmac('sha256', secret).update(bodyStr, 'utf-8').digest('hex');
  }

  beforeEach(async () => {
    printJobsRepo = new MockPrintJobsRepository();
    paymentsRepo = new MockPaymentsRepository();
    razorpayClient = new MockRazorpayClient('rzp_test_key_d3_06');
    realtimeService = new RealtimeService();
    pricingService = new PricingService();

    paymentService = new PaymentService({
      razorpayClient,
      webhookSecret,
      pricingService,
      printJobsRepo,
      paymentsRepo,
      realtimeService
    });

    // Seed a pending print job
    const job: any = {
      id: sampleJobId,
      shop_id: sampleShopId,
      customer_id: 'customer-uuid-001',
      document_storage_key: 'keys/sample.pdf',
      settings: { paper_size: 'a4', color_mode: 'bw', copies: 1 },
      priority_tier: 'flexible',
      price_total_paise: 2500,
      status: 'pending_payment',
      document_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString()
    };
    (printJobsRepo as any).jobs.set(sampleJobId, job);

    app = fastify({ logger: false });

    // Preserve raw body buffer for signature verification
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      try {
        const raw = body.toString('utf-8');
        (req as any).rawBody = raw;
        const json = raw.trim().length === 0 ? {} : JSON.parse(raw);
        done(null, json);
      } catch (err: any) {
        done(err, undefined);
      }
    });

    await app.register(paymentsRoutes, {
      prefix: '/api/v1/payments',
      paymentService,
      realtimeService,
      printJobsRepo,
      paymentsRepo
    });

    await app.ready();
  });

  // ============================================================================
  // Test Suite 1: Razorpay Order Creation
  // ============================================================================
  describe('POST /api/v1/payments/razorpay/order', () => {
    it('creates Razorpay order with integer amount in paise and currency INR', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/order',
        payload: {
          print_job_id: sampleJobId
        }
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data).toBeDefined();
      expect(json.data.order_id).toMatch(/^order_/);
      expect(json.data.amount_paise).toBe(2500);
      expect(json.data.currency).toBe('INR');
      expect(json.data.key_id).toBe('rzp_test_key_d3_06');
      expect(json.data.print_job_id).toBe(sampleJobId);
      expect(Number.isInteger(json.data.amount_paise)).toBe(true);
    });

    it('rejects order creation with 400 when client attempts amount tampering', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/order',
        payload: {
          print_job_id: sampleJobId,
          requested_amount_paise: 50 // Tampered amount (50 paise vs 2500 paise authoritative)
        }
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('AMOUNT_TAMPERING_DETECTED');
      expect(json.error.message).toContain('tampering detected');
    });

    it('returns 404 Not Found when print_job_id does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/order',
        payload: {
          print_job_id: '99999999-9999-9999-9999-999999999999'
        }
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 Bad Request for invalid request payload format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/order',
        payload: {
          print_job_id: 'invalid-non-uuid'
        }
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ============================================================================
  // Test Suite 2: Webhook Signature Verification
  // ============================================================================
  describe('Webhook Signature Verification', () => {
    const samplePayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: samplePaymentId,
            order_id: sampleOrderId,
            amount: 2500,
            currency: 'INR',
            status: 'captured',
            method: 'upi',
            notes: {
              print_job_id: sampleJobId,
              shop_id: sampleShopId
            }
          }
        }
      }
    };

    it('returns 400 Bad Request when x-razorpay-signature header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        payload: samplePayload
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('MISSING_SIGNATURE');
    });

    it('returns 400 Bad Request when signature is forged or invalid', async () => {
      const rawBody = JSON.stringify(samplePayload);
      const forgedSignature = 'forged_signature_0000000000000000000000000000000000000000';

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': forgedSignature
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('INVALID_SIGNATURE');
    });

    it('returns 400 Bad Request when signed with the wrong secret', async () => {
      const rawBody = JSON.stringify(samplePayload);
      const badSecretSignature = signPayload(rawBody, 'completely_wrong_secret_key');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': badSecretSignature
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('INVALID_SIGNATURE');
    });
  });

  // ============================================================================
  // Test Suite 3: Webhook Processing & State Transitions
  // ============================================================================
  describe('State Transitions & Realtime Broadcast', () => {
    it('processes valid payment.captured webhook, transitions job to SUBMITTED and broadcasts', async () => {
      // Seed initiated payment record
      await paymentsRepo.create({
        print_job_id: sampleJobId,
        amount_paise: 2500,
        currency: 'INR',
        method: 'upi',
        gateway_ref: sampleOrderId,
        status: 'initiated'
      });

      const payload = {
        event: 'payment.captured',
        event_id: 'evt_unique_capture_1001',
        payload: {
          payment: {
            entity: {
              id: samplePaymentId,
              order_id: sampleOrderId,
              amount: 2500,
              currency: 'INR',
              status: 'captured',
              method: 'upi',
              notes: {
                print_job_id: sampleJobId,
                shop_id: sampleShopId
              }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const validSignature = signPayload(rawBody);

      // Listen for realtime broadcast
      const broadcastEvents: any[] = [];
      realtimeService.subscribe(`caps:shop:${sampleShopId}`, msg => {
        broadcastEvents.push(msg);
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': validSignature
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.acknowledged).toBe(true);
      expect(json.is_idempotent_replay).toBe(false);
      expect(json.status).toBe('processed');

      // Verify print job was transitioned to SUBMITTED
      const job = await printJobsRepo.findById(sampleJobId);
      expect(job?.status).toBe('SUBMITTED');

      // Verify payment was marked as success
      const payment = await paymentsRepo.findByGatewayRef(sampleOrderId);
      expect(payment?.status).toBe('success');

      // Verify realtime broadcast was triggered
      expect(broadcastEvents.length).toBeGreaterThan(0);
      const lastEvent = broadcastEvents[broadcastEvents.length - 1];
      expect(lastEvent.payload.status).toBe('SUBMITTED');
      expect(lastEvent.payload.jobId).toBe(sampleJobId);
    });
  });

  // ============================================================================
  // Test Suite 4: Idempotency & Replay Protection
  // ============================================================================
  describe('Idempotency & Replay Protection', () => {
    it('returns 200 OK on duplicate webhook delivery without double processing or error', async () => {
      const payload = {
        event: 'payment.captured',
        event_id: 'evt_replay_test_2001',
        payload: {
          payment: {
            entity: {
              id: 'pay_replay_2001',
              order_id: 'order_replay_2001',
              amount: 2500,
              currency: 'INR',
              status: 'captured',
              method: 'upi',
              notes: {
                print_job_id: sampleJobId,
                shop_id: sampleShopId
              }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = signPayload(rawBody);

      // 1. First Delivery
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature
        },
        payload: rawBody
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(firstResponse.json().is_idempotent_replay).toBe(false);

      // Verify job is SUBMITTED
      const jobAfterFirst = await printJobsRepo.findById(sampleJobId);
      expect(jobAfterFirst?.status).toBe('SUBMITTED');

      // 2. Second Duplicate Delivery (Network retry or Razorpay redelivery)
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature
        },
        payload: rawBody
      });

      expect(secondResponse.statusCode).toBe(200);
      const secondJson = secondResponse.json();
      expect(secondJson.acknowledged).toBe(true);
      expect(secondJson.is_idempotent_replay).toBe(true);
      expect(secondJson.status).toBe('already_processed');

      // Crucial: Job status must remain SUBMITTED without error or regression
      const jobAfterSecond = await printJobsRepo.findById(sampleJobId);
      expect(jobAfterSecond?.status).toBe('SUBMITTED');
    });

    it('safely ignores delayed payment.failed event arriving after payment.captured', async () => {
      const capturedPayload = {
        event: 'payment.captured',
        event_id: 'evt_out_of_order_3001',
        payload: {
          payment: {
            entity: {
              id: 'pay_ooo_3001',
              order_id: 'order_ooo_3001',
              amount: 2500,
              currency: 'INR',
              status: 'captured',
              method: 'upi',
              notes: {
                print_job_id: sampleJobId,
                shop_id: sampleShopId
              }
            }
          }
        }
      };

      const capturedRaw = JSON.stringify(capturedPayload);
      await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signPayload(capturedRaw)
        },
        payload: capturedRaw
      });

      // Now delayed failed event arrives
      const failedPayload = {
        event: 'payment.failed',
        event_id: 'evt_out_of_order_failed_3002',
        payload: {
          payment: {
            entity: {
              id: 'pay_ooo_failed_3002',
              order_id: 'order_ooo_3001',
              amount: 2500,
              currency: 'INR',
              status: 'failed',
              notes: {
                print_job_id: sampleJobId
              }
            }
          }
        }
      };

      const failedRaw = JSON.stringify(failedPayload);
      const failedResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/razorpay/webhook',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signPayload(failedRaw)
        },
        payload: failedRaw
      });

      expect(failedResponse.statusCode).toBe(200);
      expect(failedResponse.json().status).toBe('ignored_out_of_order');

      // Status must not regress
      const finalJob = await printJobsRepo.findById(sampleJobId);
      expect(finalJob?.status).toBe('SUBMITTED');
    });
  });
});
