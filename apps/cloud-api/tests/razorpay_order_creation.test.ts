import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPaymentsRepository } from '../src/modules/payments/payments.repository.js';
import { MockJobEventsRepository } from '../src/modules/events/events.repository.js';
import { MockJobAttemptsRepository } from '../src/modules/attempts/attempts.repository.js';
import {
  MockRazorpayClient,
  createRazorpayClient
} from '../src/modules/payments/razorpay.service.js';
import {
  PaymentsService,
  AmountTamperingError,
  NotFoundError,
  InvalidJobStateError
} from '../src/modules/payments/payments.service.js';
import { JobClaimService, JobNotClaimableError } from '../src/modules/print-jobs/claim.service.js';
import type { PrintJob } from '../src/modules/print-jobs/print-jobs.types.js';

describe('Task P06-M01-F01: Razorpay Order Creation & Security Invariants', () => {
  let printJobsRepo: MockPrintJobsRepository;
  let paymentsRepo: MockPaymentsRepository;
  let razorpayClient: MockRazorpayClient;
  let jobEventsRepo: MockJobEventsRepository;
  let attemptsRepo: MockJobAttemptsRepository;
  let paymentsService: PaymentsService;
  let claimService: JobClaimService;

  const samplePendingJobId = '11111111-2222-3333-4444-555555555555';
  const sampleQueuedJobId = '22222222-3333-4444-5555-666666666666';
  const sampleCompletedJobId = '33333333-4444-5555-6666-777777777777';

  beforeEach(async () => {
    printJobsRepo = new MockPrintJobsRepository();
    paymentsRepo = new MockPaymentsRepository();
    razorpayClient = new MockRazorpayClient('rzp_test_mock_caps_key');
    jobEventsRepo = new MockJobEventsRepository();
    attemptsRepo = new MockJobAttemptsRepository();

    paymentsService = new PaymentsService(
      printJobsRepo,
      paymentsRepo,
      razorpayClient,
      jobEventsRepo
    );

    claimService = new JobClaimService(attemptsRepo);

    // Seed sample print jobs in various states
    await printJobsRepo.create({
      shop_id: 'shop-uuid-001',
      customer_id: 'customer-uuid-001',
      document_storage_key: 'keys/sample-doc-1.pdf',
      settings: { paper_size: 'a4', color_mode: 'bw', copies: 2 },
      priority_tier: 'flexible',
      price_total_paise: 354, // Authoritative price: ₹3.54
      price_breakdown: { base_pages_paise: 300, gst_paise: 54, total_paise: 354 }
    });

    // We override the ID to match our deterministic test ID
    const jobs = await printJobsRepo.findByCustomer('customer-uuid-001');
    const firstJob = jobs[0] as PrintJob;
    (firstJob as { id: string }).id = samplePendingJobId;
    (firstJob as { status: string }).status = 'pending_payment';
    (firstJob as { price_total_paise: number }).price_total_paise = 354;
    // Update map manually for deterministic lookup
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(
      samplePendingJobId,
      firstJob
    );

    // Create a queued job (paid)
    const queuedJob: PrintJob = {
      ...firstJob,
      id: sampleQueuedJobId,
      status: 'queued',
      enqueued_at: new Date().toISOString()
    };
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(
      sampleQueuedJobId,
      queuedJob
    );

    // Create a completed job
    const completedJob: PrintJob = {
      ...firstJob,
      id: sampleCompletedJobId,
      status: 'completed',
      enqueued_at: new Date().toISOString()
    };
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(
      sampleCompletedJobId,
      completedJob
    );
  });

  // ============================================================================
  // Test Evidence 1: Amount Tampering Denied
  // ============================================================================
  describe('Amount Tampering Security Controls', () => {
    it('strictly denies client-submitted amount that does not match authoritative price', async () => {
      // Job authoritative price is 354 paise. Attacker attempts to pay 100 paise.
      await expect(
        paymentsService.createRazorpayOrder({
          print_job_id: samplePendingJobId,
          requested_amount_paise: 100
        })
      ).rejects.toThrow(AmountTamperingError);

      // Verify rejection message contains exact tamper details
      try {
        await paymentsService.createRazorpayOrder({
          print_job_id: samplePendingJobId,
          requested_amount_paise: 100
        });
      } catch (err) {
        expect(err).toBeInstanceOf(AmountTamperingError);
        expect((err as AmountTamperingError).code).toBe('AMOUNT_TAMPERING_DETECTED');
        expect((err as AmountTamperingError).message).toContain('Amount tampering detected');
        expect((err as AmountTamperingError).message).toContain('client requested 100 paise');
        expect((err as AmountTamperingError).message).toContain('authoritative quote is 354 paise');
      }

      // Verify NO payment record was created
      const payments = await paymentsRepo.findByJobId(samplePendingJobId);
      expect(payments).toHaveLength(0);
    });

    it('creates Razorpay order with authoritative DB price when client does not supply amount', async () => {
      const order = await paymentsService.createRazorpayOrder({
        print_job_id: samplePendingJobId
      });

      expect(order.amount_paise).toBe(354);
      expect(order.currency).toBe('INR');
      expect(order.order_id).toMatch(/^order_/);
      expect(order.key_id).toBe('rzp_test_mock_caps_key');
      expect(order.status).toBe('initiated');

      // Verify payment was recorded in repository
      const payments = await paymentsRepo.findByJobId(samplePendingJobId);
      expect(payments).toHaveLength(1);
      expect(payments[0]?.amount_paise).toBe(354);
      expect(payments[0]?.gateway_ref).toBe(order.order_id);
      expect(payments[0]?.status).toBe('initiated');
    });

    it('accepts order creation when client sends identical requested_amount_paise matching DB price', async () => {
      const order = await paymentsService.createRazorpayOrder({
        print_job_id: samplePendingJobId,
        requested_amount_paise: 354
      });

      expect(order.amount_paise).toBe(354);
      expect(order.status).toBe('initiated');
    });
  });

  // ============================================================================
  // Test Evidence 2: Pending Payment Not Claimable
  // ============================================================================
  describe('Pending Payment Claim Ineligibility', () => {
    it('verifies that a job in pending_payment status CANNOT be claimed by print agents', async () => {
      const pendingJob = await printJobsRepo.findById(samplePendingJobId);
      expect(pendingJob).not.toBeNull();
      expect(pendingJob?.status).toBe('pending_payment');

      // Static verification must throw JobNotClaimableError
      expect(() => JobClaimService.verifyEligibility(pendingJob!)).toThrow(JobNotClaimableError);

      try {
        JobClaimService.verifyEligibility(pendingJob!);
      } catch (err) {
        expect(err).toBeInstanceOf(JobNotClaimableError);
        expect((err as JobNotClaimableError).code).toBe('PAYMENT_PENDING');
        expect((err as JobNotClaimableError).message).toContain(
          'Unpaid print jobs cannot be claimed'
        );
      }

      // Claim attempt execution must fail
      await expect(
        claimService.claimJob({
          job: pendingJob!,
          printer_id: 'printer-001',
          agent_device_id: 'agent-pc-001',
          idempotency_key: 'claim-attempt-unpaid-01'
        })
      ).rejects.toThrow(JobNotClaimableError);

      // Verify no lease or attempt record was created
      const attempts = await attemptsRepo.findByJobId(samplePendingJobId);
      expect(attempts).toHaveLength(0);
    });

    it('permits agent claim only once payment has succeeded and job is in queued status', async () => {
      const queuedJob = await printJobsRepo.findById(sampleQueuedJobId);
      expect(queuedJob).not.toBeNull();
      expect(queuedJob?.status).toBe('queued');

      // Static verification succeeds without error
      expect(() => JobClaimService.verifyEligibility(queuedJob!)).not.toThrow();

      // Agent claim execution succeeds
      const attempt = await claimService.claimJob({
        job: queuedJob!,
        printer_id: 'printer-001',
        agent_device_id: 'agent-pc-001',
        idempotency_key: 'claim-attempt-paid-01'
      });

      expect(attempt.id).toBeDefined();
      expect(attempt.job_id).toBe(sampleQueuedJobId);
      expect(attempt.status).toBe('leased');
      expect(attempt.lease_token).toBeDefined();
    });

    it('rejects claim for already completed job', async () => {
      const completedJob = await printJobsRepo.findById(sampleCompletedJobId);
      expect(() => JobClaimService.verifyEligibility(completedJob!)).toThrow(JobNotClaimableError);
    });
  });

  // ============================================================================
  // Idempotency & Lifecycle Controls
  // ============================================================================
  describe('Idempotency & Replay Protection', () => {
    it('returns existing initiated order when re-invoked for same pending job', async () => {
      const firstOrder = await paymentsService.createRazorpayOrder({
        print_job_id: samplePendingJobId
      });

      const secondOrder = await paymentsService.createRazorpayOrder({
        print_job_id: samplePendingJobId
      });

      expect(secondOrder.order_id).toBe(firstOrder.order_id);
      expect(secondOrder.amount_paise).toBe(firstOrder.amount_paise);
      expect(secondOrder.receipt).toBe(firstOrder.receipt);

      // Payment records count in repository remains 1
      const payments = await paymentsRepo.findByJobId(samplePendingJobId);
      expect(payments).toHaveLength(1);
    });

    it('rejects order creation for non-existent job ID', async () => {
      await expect(
        paymentsService.createRazorpayOrder({
          print_job_id: '99999999-9999-9999-9999-999999999999'
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('rejects order creation for job already paid and queued', async () => {
      await expect(
        paymentsService.createRazorpayOrder({
          print_job_id: sampleQueuedJobId
        })
      ).rejects.toThrow(InvalidJobStateError);
    });

    it('appends payment_order_created event to immutable audit ledger', async () => {
      const order = await paymentsService.createRazorpayOrder({
        print_job_id: samplePendingJobId
      });

      const events = await jobEventsRepo.findByJobId(samplePendingJobId);
      expect(events).toHaveLength(1);
      expect(events[0]?.event_name).toBe('payment_order_created');
      expect(events[0]?.actor_type).toBe('customer');
      expect(events[0]?.metadata).toEqual({
        order_id: order.order_id,
        amount_paise: 354,
        currency: 'INR'
      });
    });
  });

  // ============================================================================
  // HTTP Endpoint Integration Tests (/api/v1/payments/orders)
  // ============================================================================
  describe('HTTP Route: POST /api/v1/payments/orders', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp({
        printJobsRepo,
        paymentsRepo,
        razorpayClient,
        jobEventsRepo,
        paymentsService
      });
    });

    it('returns 201 Created with order details on valid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        payload: {
          print_job_id: samplePendingJobId,
          notes: { client: 'web-checkout' }
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.order_id).toMatch(/^order_/);
      expect(body.data.amount_paise).toBe(354);
      expect(body.data.currency).toBe('INR');
      expect(body.data.key_id).toBe('rzp_test_mock_caps_key');
      expect(body.data.status).toBe('initiated');
    });

    it('returns 400 Bad Request when amount tampering is attempted over HTTP', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        payload: {
          print_job_id: samplePendingJobId,
          requested_amount_paise: 10 // Tampered: 10 paise instead of 354 paise
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('AMOUNT_TAMPERING_DETECTED');
      expect(body.error.message).toContain('Amount tampering detected');
    });

    it('returns 400 Bad Request on invalid payload format (non-UUID)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        payload: {
          print_job_id: 'invalid-not-a-uuid'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 Not Found when print_job_id does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        payload: {
          print_job_id: '00000000-0000-0000-0000-000000000000'
        }
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 Bad Request when job is not pending payment', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/orders',
        payload: {
          print_job_id: sampleQueuedJobId
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('INVALID_JOB_STATE');
    });
  });

  // ============================================================================
  // Razorpay Client Factory & Test Mode Unit Tests
  // ============================================================================
  describe('Razorpay Client Factory & Validation', () => {
    it('creates MockRazorpayClient when test mode or missing keys', () => {
      const client = createRazorpayClient({ useMock: true });
      expect(client).toBeInstanceOf(MockRazorpayClient);
      expect(client.getKeyId()).toBe('rzp_test_mock_caps_key');
    });

    it('rejects order with non-positive amount in paise', async () => {
      const client = new MockRazorpayClient();
      await expect(
        client.createOrder({
          amount_paise: 0,
          currency: 'INR',
          receipt: 'rcpt_fail'
        })
      ).rejects.toThrow('positive integer in paise');
    });

    it('rejects order with non-INR currency', async () => {
      const client = new MockRazorpayClient();
      await expect(
        client.createOrder({
          amount_paise: 100,
          currency: 'USD' as 'INR',
          receipt: 'rcpt_fail'
        })
      ).rejects.toThrow('Unsupported currency');
    });
  });
});
