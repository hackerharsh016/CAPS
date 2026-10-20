import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService } from '../../src/features/checkout/checkout-service';
import type { CheckoutOrderInput } from '../../src/features/checkout/types';
import { generateAuthoritativeQuote } from '../../src/features/pricing/pricing-calculator';
import { DEFAULT_PRINT_SETTINGS } from '../../src/features/print-settings/validation';
import { defaultOrdersService } from '../../src/features/orders/orders-service';

describe('Checkout & Order Review Service (P04-M05-F02)', () => {
  let checkoutService: CheckoutService;
  const customerId = 'usr-test-alice-123';
  const openShopId = 'shop-8888-campus-xerox';
  const closedShopId = 'shop-7777-tech-xerox';
  const cashlessShopId = 'shop-9999-metro-prints';

  beforeEach(() => {
    checkoutService = new CheckoutService();
  });

  const createSampleInput = (
    shopId: string = openShopId,
    paymentMethod: 'upi' | 'card' | 'wallet' | 'pay_at_counter' = 'upi',
    idempotencyKey: string = `key-${Date.now()}-${Math.random()}`
  ): CheckoutOrderInput => {
    const quote = generateAuthoritativeQuote({
      shop_id: shopId,
      settings: DEFAULT_PRINT_SETTINGS,
      priority_tier: 'flexible',
      document_page_count: 5
    });

    return {
      quote_id: quote.quote_id,
      shop_id: shopId,
      customer_id: customerId,
      document_storage_key: `uploads/${customerId}/report.pdf`,
      document_name: 'CS_Thesis_Report.pdf',
      file_size_bytes: 1024 * 500,
      settings: DEFAULT_PRINT_SETTINGS,
      priority_tier: 'flexible',
      quote,
      payment_method: paymentMethod,
      idempotency_key: idempotencyKey
    };
  };

  describe('1. Happy Path: Order Creation', () => {
    it('creates a pending online payment order with token number and 24h expiration', async () => {
      const input = createSampleInput(openShopId, 'upi', 'idem-happy-online');
      const result = await checkoutService.createPendingOrder(input);

      expect(result).toBeDefined();
      expect(result.order_id).toBeDefined();
      expect(result.token_number).toMatch(/^T-\d{3}$/);
      expect(result.status).toBe('pending_payment');
      expect(result.payment_status).toBe('pending');
      expect(result.payment_method).toBe('upi');
      expect(result.payment_redirect_url).toContain(result.order_id);
      expect(result.amount_paise).toBe(input.quote.price_breakdown.total_paise);
      expect(result.document_expires_at).toBeDefined();

      // Check document expires in ~24 hours
      const expiresMs = new Date(result.document_expires_at).getTime();
      expect(expiresMs - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);

      // Verify order is queryable in orders service
      const queried = await defaultOrdersService.getOrderById(result.order_id, customerId);
      expect(queried).not.toBeNull();
      expect(queried?.id).toBe(result.order_id);
      expect(queried?.customer_id).toBe(customerId);
    });

    it('creates a pay-at-counter order without payment redirect URL', async () => {
      const input = createSampleInput(openShopId, 'pay_at_counter', 'idem-happy-counter');
      const result = await checkoutService.createPendingOrder(input);

      expect(result.payment_method).toBe('pay_at_counter');
      expect(result.payment_status).toBe('pay_at_counter');
      expect(result.payment_redirect_url).toBeUndefined();
    });
  });

  describe('2. Idempotency & Double-Click Duplicate Defense', () => {
    it('prevents duplicate orders when identical idempotency key is submitted twice', async () => {
      const sharedKey = 'idem-unique-double-click-key';
      const input1 = createSampleInput(openShopId, 'upi', sharedKey);
      const input2 = createSampleInput(openShopId, 'upi', sharedKey);

      // Simulate fast successive clicks
      const order1 = await checkoutService.createPendingOrder(input1);
      const order2 = await checkoutService.createPendingOrder(input2);

      // Must return identical order details
      expect(order1.order_id).toBe(order2.order_id);
      expect(order1.token_number).toBe(order2.token_number);
      expect(order1.idempotency_key).toBe(sharedKey);
      expect(order2.idempotency_key).toBe(sharedKey);
    });
  });

  describe('3. Closed Shop Blocker Rejection', () => {
    it('rejects order creation if the shop is currently closed', async () => {
      const input = createSampleInput(closedShopId, 'upi', 'idem-closed-shop');

      await expect(checkoutService.createPendingOrder(input)).rejects.toMatchObject({
        code: 'SHOP_CLOSED',
        message: expect.stringContaining('currently closed')
      });
    });
  });

  describe('4. Expired Quote Blocker Rejection', () => {
    it('rejects order creation if the quote timestamp has expired', async () => {
      const input = createSampleInput(openShopId, 'upi', 'idem-expired-quote');
      // Set quote expiration to 10 minutes in past
      input.quote.expires_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      await expect(checkoutService.createPendingOrder(input)).rejects.toMatchObject({
        code: 'QUOTE_EXPIRED',
        message: expect.stringContaining('quote has expired')
      });
    });
  });

  describe('5. Pay-at-Counter Conditional Policy', () => {
    it('disallows pay-at-counter for commercial transit cashless shops (e.g. Metro station)', async () => {
      const input = createSampleInput(cashlessShopId, 'pay_at_counter', 'idem-cashless-reject');

      await expect(checkoutService.createPendingOrder(input)).rejects.toMatchObject({
        code: 'PAY_AT_COUNTER_UNAVAILABLE',
        message: expect.stringContaining('cashless')
      });
    });

    it('permits online payments (UPI) for the same commercial transit shop', async () => {
      const input = createSampleInput(cashlessShopId, 'upi', 'idem-cashless-upi-ok');
      const result = await checkoutService.createPendingOrder(input);
      expect(result.payment_method).toBe('upi');
      expect(result.status).toBe('pending_payment');
    });
  });

  describe('6. Target Shop ID Mismatch Defense', () => {
    it('rejects if quote shop ID does not align with request shop ID', async () => {
      const input = createSampleInput(openShopId, 'upi', 'idem-mismatch');
      input.quote.shop_id = 'different-shop-uuid';

      await expect(checkoutService.createPendingOrder(input)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: expect.stringContaining('Quotation shop identifier does not match')
      });
    });
  });

  describe('7. Tenant / Customer Isolation Guarantee', () => {
    it('ensures orders belong strictly to the submitting customer', async () => {
      const aliceInput = createSampleInput(openShopId, 'upi', 'idem-tenant-alice');
      const aliceOrder = await checkoutService.createPendingOrder(aliceInput);

      // Customer Bob queries his orders
      const bobHistory = await defaultOrdersService.getCustomerOrders({
        customerId: 'usr-different-bob-456'
      });

      // Bob MUST NOT see Alice's order
      const containsAliceOrder = bobHistory.orders.some((o) => o.id === aliceOrder.order_id);
      expect(containsAliceOrder).toBe(false);

      // Unauthorized access via getOrderById returns null
      const bobAttempt = await defaultOrdersService.getOrderById(
        aliceOrder.order_id,
        'usr-different-bob-456'
      );
      expect(bobAttempt).toBeNull();
    });
  });
});
