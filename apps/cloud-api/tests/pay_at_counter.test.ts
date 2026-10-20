import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { MockPrintJobsRepository } from '../src/modules/print-jobs/print-jobs.repository.js';
import { MockPaymentsRepository } from '../src/modules/payments/payments.repository.js';
import { MockShopsRepository } from '../src/modules/shops/shops.repository.js';
import { MockJobEventsRepository } from '../src/modules/events/events.repository.js';
import { MockJobAttemptsRepository } from '../src/modules/attempts/attempts.repository.js';
import { MockRazorpayClient } from '../src/modules/payments/razorpay.service.js';
import {
  PayAtCounterService,
  PayAtCounterNotAllowedError,
  UnauthorizedOperatorError,
  InsufficientCashSettlementError
} from '../src/modules/payments/pay-at-counter.service.js';
import { JobClaimService, JobNotClaimableError } from '../src/modules/print-jobs/claim.service.js';
import type { Shop } from '../src/modules/shops/shops.types.js';
import type { PrintJob } from '../src/modules/print-jobs/print-jobs.types.js';

describe('Task P06-M01-F03: Pay-at-Counter Opt-In & Fulfillment', () => {
  let shopsRepo: MockShopsRepository;
  let printJobsRepo: MockPrintJobsRepository;
  let paymentsRepo: MockPaymentsRepository;
  let jobEventsRepo: MockJobEventsRepository;
  let attemptsRepo: MockJobAttemptsRepository;
  let razorpayClient: MockRazorpayClient;
  let payAtCounterService: PayAtCounterService;
  let claimService: JobClaimService;

  const ownerAId = '00000000-0000-0000-0000-000000000001';
  const ownerBId = '00000000-0000-0000-0000-000000000002';
  const customerId = '00000000-0000-0000-0000-000000000003';

  const shopAId = '11111111-1111-1111-1111-111111111111';
  const shopBId = '22222222-2222-2222-2222-222222222222';

  const jobA1Id = '77777777-1111-0000-0000-000000000001';
  const jobA2Id = '77777777-1111-0000-0000-000000000002';
  const jobB1Id = '77777777-2222-0000-0000-000000000001';

  beforeEach(async () => {
    shopsRepo = new MockShopsRepository();
    printJobsRepo = new MockPrintJobsRepository();
    paymentsRepo = new MockPaymentsRepository();
    jobEventsRepo = new MockJobEventsRepository();
    attemptsRepo = new MockJobAttemptsRepository();
    razorpayClient = new MockRazorpayClient();

    payAtCounterService = new PayAtCounterService(
      shopsRepo,
      printJobsRepo,
      paymentsRepo,
      jobEventsRepo
    );

    claimService = new JobClaimService(attemptsRepo);

    // Setup Shop A (initially allow_pay_at_counter: false)
    const shopA: Shop = {
      id: shopAId,
      owner_id: ownerAId,
      name: 'Campus Express Xerox',
      address: 'Main Gate, Campus',
      geo_lat: 12.9716,
      geo_lng: 77.5946,
      status: 'open',
      pricing_config: {
        A4: {
          bw_single_paise: 100,
          bw_double_paise: 80,
          color_single_paise: 500,
          color_double_paise: 400
        },
        A3: {
          bw_single_paise: 200,
          bw_double_paise: 160,
          color_single_paise: 1000,
          color_double_paise: 800
        },
        Legal: {
          bw_single_paise: 150,
          bw_double_paise: 120,
          color_single_paise: 700,
          color_double_paise: 600
        },
        binding_prices_paise: { none: 0, spiral: 3000, staple: 500, lamination: 2000 },
        gst_percentage: 18
      },
      urgent_surcharge_config: { type: 'flat', amount: 2000 },
      auto_print_enabled: false,
      allow_pay_at_counter: false, // Opt-in disabled by default
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    (shopsRepo as unknown as { shops: Map<string, Shop> }).shops.set(shopAId, shopA);

    // Setup Shop B (owned by Owner B, allow_pay_at_counter: true)
    const shopB: Shop = {
      ...shopA,
      id: shopBId,
      owner_id: ownerBId,
      name: 'Hostel Block Print Hub',
      allow_pay_at_counter: true
    };
    (shopsRepo as unknown as { shops: Map<string, Shop> }).shops.set(shopBId, shopB);

    // Setup Pending Job A1 for Shop A
    const jobA1: PrintJob = {
      id: jobA1Id,
      shop_id: shopAId,
      customer_id: customerId,
      document_storage_key: 'keys/doc_a1.pdf',
      settings: { paper_size: 'a4', color_mode: 'bw', copies: 1 },
      priority_tier: 'flexible',
      price_total_paise: 500,
      price_breakdown: { base_pages_paise: 500, total_paise: 500 },
      status: 'pending_payment',
      document_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: new Date().toISOString()
    };
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(jobA1Id, jobA1);

    // Setup Pending Job A2 for Shop A
    const jobA2: PrintJob = {
      ...jobA1,
      id: jobA2Id,
      price_total_paise: 750,
      price_breakdown: { base_pages_paise: 750, total_paise: 750 }
    };
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(jobA2Id, jobA2);

    // Setup Pending Job B1 for Shop B
    const jobB1: PrintJob = {
      ...jobA1,
      id: jobB1Id,
      shop_id: shopBId,
      price_total_paise: 1000
    };
    (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(jobB1Id, jobB1);
  });

  // ============================================================================
  // Test Evidence 1: Unauthorized Cash Path Denied
  // ============================================================================
  describe('Unauthorized Cash Path Denied', () => {
    it('denies pay-at-counter selection if shop has NOT opted into policy', async () => {
      // Shop A has allow_pay_at_counter: false
      await expect(
        payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id })
      ).rejects.toThrow(PayAtCounterNotAllowedError);

      try {
        await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });
      } catch (err) {
        expect(err).toBeInstanceOf(PayAtCounterNotAllowedError);
        expect((err as PayAtCounterNotAllowedError).code).toBe('PAY_AT_COUNTER_NOT_ALLOWED');
        expect((err as PayAtCounterNotAllowedError).message).toContain(
          'does not allow Pay-at-Counter'
        );
      }
    });

    it('denies cash settlement confirmation by unauthorized customer or non-owner', async () => {
      // Enable pay-at-counter on Shop A
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });

      // Customer attempts to self-confirm payment
      await expect(
        payAtCounterService.confirmCashSettlement({
          print_job_id: jobA1Id,
          operator_id: customerId // Not the owner
        })
      ).rejects.toThrow(UnauthorizedOperatorError);
    });

    it('denies cash settlement confirmation by operator of a different shop (tenant isolation)', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });

      // Owner B attempts to settle cash for Shop A's job
      await expect(
        payAtCounterService.confirmCashSettlement({
          print_job_id: jobA1Id,
          operator_id: ownerBId
        })
      ).rejects.toThrow(UnauthorizedOperatorError);
    });

    it('denies cash settlement if received cash is less than authoritative price', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });

      // Price is 500 paise; operator supplies 300 paise
      await expect(
        payAtCounterService.confirmCashSettlement({
          print_job_id: jobA1Id,
          operator_id: ownerAId,
          received_amount_paise: 300
        })
      ).rejects.toThrow(InsufficientCashSettlementError);
    });

    it('enforces that unconfirmed pay-at-counter jobs CANNOT be claimed by print agent', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });

      const pendingJob = await printJobsRepo.findById(jobA1Id);
      expect(pendingJob?.status).toBe('pending_payment');

      // Attempting to claim unconfirmed job must fail
      expect(() => JobClaimService.verifyEligibility(pendingJob!)).toThrow(JobNotClaimableError);
      await expect(
        claimService.claimJob({
          job: pendingJob!,
          printer_id: 'printer-001',
          agent_device_id: 'agent-001',
          idempotency_key: 'claim-attempt-unsettled-01'
        })
      ).rejects.toThrow(JobNotClaimableError);
    });
  });

  // ============================================================================
  // Test Evidence 2: Authorized Cash Fulfillment & State Progression
  // ============================================================================
  describe('Authorized Cash Fulfillment Lifecycle', () => {
    it('authorizes and fulfills pay-at-counter settlement, transitioning job to queued and claimable', async () => {
      // 1. Shop owner opts in to pay-at-counter
      const updatedShop = await payAtCounterService.configureShopPayAtCounter(
        shopAId,
        ownerAId,
        true
      );
      expect(updatedShop.allow_pay_at_counter).toBe(true);

      // 2. Customer selects pay-at-counter
      const selectResult = await payAtCounterService.selectPayAtCounter({
        print_job_id: jobA1Id
      });
      expect(selectResult.status).toBe('initiated');
      expect(selectResult.method).toBe('pay_at_counter');

      // 3. Authorized shop owner confirms cash receipt at counter
      const confirmResult = await payAtCounterService.confirmCashSettlement({
        print_job_id: jobA1Id,
        operator_id: ownerAId,
        receipt_number: 'CASH-REC-1001',
        received_amount_paise: 500
      });

      expect(confirmResult.success).toBe(true);
      expect(confirmResult.status).toBe('success');
      expect(confirmResult.method).toBe('pay_at_counter');
      expect(confirmResult.job_status).toBe('queued');
      expect(confirmResult.receipt_ref).toBe('CASH-REC-1001');

      // 4. Verify database state
      const payments = await paymentsRepo.findByJobId(jobA1Id);
      expect(payments).toHaveLength(1);
      expect(payments[0]?.status).toBe('success');
      expect(payments[0]?.method).toBe('pay_at_counter');
      expect(payments[0]?.gateway_ref).toBe('CASH-REC-1001');

      const job = await printJobsRepo.findById(jobA1Id);
      expect(job?.status).toBe('queued');
      expect(job?.enqueued_at).toBeDefined();

      // 5. Verify immutable audit event
      const events = await jobEventsRepo.findByJobId(jobA1Id);
      const settledEvent = events.find(e => e.event_name === 'cash_payment_settled');
      expect(settledEvent).toBeDefined();
      expect(settledEvent?.actor_type).toBe('owner');
      expect(settledEvent?.actor_id).toBe(ownerAId);
      expect(settledEvent?.metadata).toEqual({
        shop_id: shopAId,
        settled_by: ownerAId,
        amount_paise: 500,
        receipt_ref: 'CASH-REC-1001',
        method: 'pay_at_counter'
      });

      // 6. Verify job is now claimable by print agent
      const claim = await claimService.claimJob({
        job: job!,
        printer_id: 'printer-001',
        agent_device_id: 'agent-001',
        idempotency_key: 'claim-after-cash-confirmed-01'
      });
      expect(claim.id).toBeDefined();
      expect(claim.status).toBe('leased');
    });
  });

  // ============================================================================
  // Test Evidence 3: Cash Reporting Correct (Audit Cash vs Gateway)
  // ============================================================================
  describe('Cash Reporting Correct (Audit & Financial Reconciliation)', () => {
    it('produces accurate financial report splitting cash settlements from gateway transactions', async () => {
      // Setup Shop A with pay-at-counter enabled
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });

      // Transaction 1: Job A1 (500 paise) settled with cash
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });
      await payAtCounterService.confirmCashSettlement({
        print_job_id: jobA1Id,
        operator_id: ownerAId,
        receipt_number: 'CASH-001'
      });

      // Transaction 2: Job A2 (750 paise) settled with cash
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA2Id });
      await payAtCounterService.confirmCashSettlement({
        print_job_id: jobA2Id,
        operator_id: ownerAId,
        receipt_number: 'CASH-002'
      });

      // Transaction 3: Additional Job A3 (354 paise) settled via UPI gateway
      const jobA3Id = '77777777-1111-0000-0000-000000000003';
      const jobA3: PrintJob = {
        id: jobA3Id,
        shop_id: shopAId,
        customer_id: customerId,
        document_storage_key: 'keys/doc_a3.pdf',
        settings: { paper_size: 'a4', color_mode: 'bw', copies: 1 },
        priority_tier: 'flexible',
        price_total_paise: 354,
        price_breakdown: { base_pages_paise: 354, total_paise: 354 },
        status: 'queued',
        document_expires_at: new Date(Date.now() + 86400000).toISOString(),
        created_at: new Date().toISOString()
      };
      (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(jobA3Id, jobA3);
      await paymentsRepo.create({
        print_job_id: jobA3Id,
        amount_paise: 354,
        currency: 'INR',
        method: 'upi',
        gateway_ref: 'pay_rzp_upi_001',
        status: 'success'
      });

      // Transaction 4: Additional Job A4 (1200 paise) settled via Card gateway
      const jobA4Id = '77777777-1111-0000-0000-000000000004';
      const jobA4: PrintJob = {
        ...jobA3,
        id: jobA4Id,
        price_total_paise: 1200
      };
      (printJobsRepo as unknown as { jobs: Map<string, PrintJob> }).jobs.set(jobA4Id, jobA4);
      await paymentsRepo.create({
        print_job_id: jobA4Id,
        amount_paise: 1200,
        currency: 'INR',
        method: 'card',
        gateway_ref: 'pay_rzp_card_002',
        status: 'success'
      });

      // Transaction 5 (Shop B): 9999 paise cash settlement in Shop B (must NOT bleed into Shop A report)
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobB1Id });
      await payAtCounterService.confirmCashSettlement({
        print_job_id: jobB1Id,
        operator_id: ownerBId,
        receipt_number: 'CASH-SHOP-B'
      });

      // Fetch payment report for Shop A
      const report = await payAtCounterService.getShopPaymentReport(shopAId, ownerAId);

      // Verify overall totals
      expect(report.shop_id).toBe(shopAId);
      expect(report.total_revenue_paise).toBe(500 + 750 + 354 + 1200); // 2804 paise
      expect(report.total_transactions_count).toBe(4);

      // Verify cash settlement breakdown
      expect(report.cash_settlement.total_paise).toBe(1250); // 500 + 750
      expect(report.cash_settlement.transaction_count).toBe(2);
      expect(report.cash_settlement.items).toHaveLength(2);
      expect(report.cash_settlement.items[0]?.receipt_ref).toBe('CASH-001');
      expect(report.cash_settlement.items[1]?.receipt_ref).toBe('CASH-002');

      // Verify gateway settlement breakdown
      expect(report.gateway_settlement.total_paise).toBe(1554); // 354 + 1200
      expect(report.gateway_settlement.transaction_count).toBe(2);
      expect(report.gateway_settlement.by_method).toEqual({
        upi: 354,
        card: 1200
      });
      expect(report.gateway_settlement.items).toHaveLength(2);

      // Verify tenant isolation: Shop B's cash settlement is strictly excluded
      const shopBItemInReport = report.cash_settlement.items.find(i => i.job_id === jobB1Id);
      expect(shopBItemInReport).toBeUndefined();
    });

    it('rejects report request from unauthorized user', async () => {
      await expect(payAtCounterService.getShopPaymentReport(shopAId, customerId)).rejects.toThrow(
        UnauthorizedOperatorError
      );
    });
  });

  // ============================================================================
  // HTTP Endpoints Integration Tests
  // ============================================================================
  describe('HTTP Endpoints: Pay-at-Counter', () => {
    let app: ReturnType<typeof buildApp>;

    beforeEach(() => {
      app = buildApp({
        shopsRepo,
        printJobsRepo,
        paymentsRepo,
        razorpayClient,
        jobEventsRepo,
        payAtCounterService
      });
    });

    it('POST /api/v1/payments/counter/select returns 403 when shop has not opted in', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/counter/select',
        payload: {
          print_job_id: jobA1Id
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('PAY_AT_COUNTER_NOT_ALLOWED');
    });

    it('POST /api/v1/shops/:shop_id/pay-at-counter successfully configures shop opt-in', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/shops/${shopAId}/pay-at-counter`,
        payload: {
          owner_id: ownerAId,
          enabled: true
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.allow_pay_at_counter).toBe(true);
    });

    it('POST /api/v1/payments/counter/select succeeds after opt-in enabled', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/counter/select',
        payload: {
          print_job_id: jobA1Id
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.method).toBe('pay_at_counter');
      expect(response.json().data.status).toBe('initiated');
    });

    it('POST /api/v1/payments/counter/confirm allows authorized owner to settle cash', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/counter/confirm',
        payload: {
          print_job_id: jobA1Id,
          operator_id: ownerAId,
          receipt_number: 'HTTP-CASH-REC-01',
          received_amount_paise: 500
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.status).toBe('success');
      expect(response.json().data.receipt_ref).toBe('HTTP-CASH-REC-01');
      expect(response.json().data.job_status).toBe('queued');
    });

    it('POST /api/v1/payments/counter/confirm rejects unauthorized operator with 403', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/counter/confirm',
        payload: {
          print_job_id: jobA1Id,
          operator_id: customerId // Unauthorized
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('UNAUTHORIZED_OPERATOR');
    });

    it('GET /api/v1/shops/:shop_id/reports/payments returns accurate cash vs gateway breakdown', async () => {
      await shopsRepo.update(shopAId, { allow_pay_at_counter: true });
      await payAtCounterService.selectPayAtCounter({ print_job_id: jobA1Id });
      await payAtCounterService.confirmCashSettlement({
        print_job_id: jobA1Id,
        operator_id: ownerAId
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/shops/${shopAId}/reports/payments?user_id=${ownerAId}`
      });

      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.cash_settlement.total_paise).toBe(500);
      expect(data.cash_settlement.transaction_count).toBe(1);
      expect(data.total_revenue_paise).toBe(500);
    });
  });
});
