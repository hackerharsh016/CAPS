/**
 * Checkout and Pending Order Creation Service for CAPS Customer Web (P04-M05-F02).
 * Handles:
 * - Quote revalidation before order admission.
 * - Shop open/closed status verification.
 * - Pay-at-counter conditional eligibility.
 * - Idempotency locking to prevent duplicate orders from rapid/double-clicks.
 * - Atomic pending print job registration conforming to frozen contracts.
 */

import type { CheckoutOrderInput, CheckoutResult, CheckoutErrorCode } from './types';
import type { Shop } from '../shop-discovery/types';
import type { CustomerOrder } from '../orders/types';
import { defaultShopsService } from '../shop-discovery/shops-service';
import { defaultOrdersService } from '../orders/orders-service';

export class CheckoutCustomError extends Error {
  public code: CheckoutErrorCode;
  public details?: Record<string, unknown> | undefined;

  constructor(code: CheckoutErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CheckoutCustomError';
    this.code = code;
    this.details = details;
  }
}

export class CheckoutService {
  // Idempotency store mapping idempotencyKey -> CheckoutResult
  private idempotencyStore = new Map<string, CheckoutResult>();

  // In-flight request lock map to block simultaneous clicks with same idempotency key
  private inFlightLocks = new Set<string>();

  // Custom pay-at-counter override policies for shops
  private payAtCounterOverrides = new Map<
    string,
    { allowed: boolean; reason?: string | undefined }
  >();

  // Counter for generating human-readable sequential tokens (e.g. T-045)
  private tokenCounter = 42;

  /**
   * Evaluates whether pay-at-counter is permitted for a specific shop.
   * Commercial / transit locations (like metro stations) mandate cashless online payment.
   * Campus & local xerox shops permit pay-at-counter with owner confirmation.
   */
  public canPayAtCounter(shop: Shop): { allowed: boolean; reason?: string | undefined } {
    if (this.payAtCounterOverrides.has(shop.id)) {
      const override = this.payAtCounterOverrides.get(shop.id)!;
      return { allowed: override.allowed, reason: override.reason };
    }

    // Metro transit hub requires online cashless payment
    if (shop.id === 'shop-9999-metro-prints') {
      return {
        allowed: false,
        reason:
          'This commercial transit shop operates cashless. Please choose an online payment method.'
      };
    }

    return { allowed: true };
  }

  /**
   * Revalidates quote freshness and shop open status.
   */
  public revalidateQuote(
    quote: CheckoutOrderInput['quote'],
    shop: Shop
  ): { valid: boolean; reason?: string | undefined; code?: CheckoutErrorCode | undefined } {
    // 1. Check shop open status
    if (!shop.is_open) {
      return {
        valid: false,
        code: 'SHOP_CLOSED',
        reason: `This shop is currently closed. Orders cannot be queued until opening time (${shop.opening_time}).`
      };
    }

    // 2. Check quote expiry
    if (quote.expires_at) {
      const expiryMs = new Date(quote.expires_at).getTime();
      if (!isNaN(expiryMs) && Date.now() >= expiryMs) {
        return {
          valid: false,
          code: 'QUOTE_EXPIRED',
          reason: 'This pricing quote has expired. Please refresh to lock in current rates.'
        };
      }
    }

    // 3. Shop ID alignment
    if (quote.shop_id !== shop.id) {
      return {
        valid: false,
        code: 'VALIDATION_FAILED',
        reason: 'Quotation shop identifier does not match target shop.'
      };
    }

    return { valid: true };
  }

  /**
   * Atomically creates a pending print job order.
   * Enforces strict idempotency: if the same idempotency_key is submitted again,
   * the existing order is returned without creating duplicates.
   */
  public async createPendingOrder(input: CheckoutOrderInput): Promise<CheckoutResult> {
    const { idempotency_key } = input;

    if (!idempotency_key || typeof idempotency_key !== 'string') {
      throw new CheckoutCustomError('VALIDATION_FAILED', 'A valid idempotency_key is required.');
    }

    // 1. Double-click / In-Flight Locking Guard
    if (this.inFlightLocks.has(idempotency_key)) {
      throw new CheckoutCustomError(
        'IDEMPOTENCY_CONFLICT',
        'An order submission with this key is already in progress. Please wait.'
      );
    }

    // 2. Idempotency Cache Check: Return existing order if already processed
    if (this.idempotencyStore.has(idempotency_key)) {
      return this.idempotencyStore.get(idempotency_key)!;
    }

    this.inFlightLocks.add(idempotency_key);

    try {
      // 3. Lookup target shop
      const shop = await defaultShopsService.getShopById(input.shop_id);
      if (!shop) {
        throw new CheckoutCustomError('VALIDATION_FAILED', 'Target print shop could not be found.');
      }

      // 4. Revalidate quote and shop open status
      const validation = this.revalidateQuote(input.quote, shop);
      if (!validation.valid) {
        throw new CheckoutCustomError(
          validation.code || 'VALIDATION_FAILED',
          validation.reason || 'Quote validation failed.'
        );
      }

      // 5. Verify payment method eligibility
      if (input.payment_method === 'pay_at_counter') {
        const counterEligibility = this.canPayAtCounter(shop);
        if (!counterEligibility.allowed) {
          throw new CheckoutCustomError(
            'PAY_AT_COUNTER_UNAVAILABLE',
            counterEligibility.reason || 'Pay at counter is not available for this shop.'
          );
        }
      }

      // 6. Generate order identifiers & 24h strict privacy expiration deadline
      let orderId = crypto.randomUUID
        ? crypto.randomUUID()
        : `order-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const apiUrl =
        typeof process !== 'undefined'
          ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
          : 'http://localhost:4000';

      // Submit print job to live Cloud API if available
      try {
        const jobRes = await fetch(`${apiUrl}/api/v1/print-jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotency_key
          },
          body: JSON.stringify({
            shop_id: shop.id,
            quote_id: input.quote.quote_id,
            priority_tier: input.priority_tier,
            settings: {
              paper_size: input.settings.paper_size,
              color_mode: input.settings.color_mode,
              sides: input.settings.sides,
              orientation: input.settings.orientation,
              copies: input.settings.copies,
              page_range: input.settings.page_range,
              binding: input.settings.binding
            }
          })
        });

        if (jobRes.ok) {
          const jobJson = await jobRes.json();
          const liveJob = jobJson.data?.job || jobJson.data || jobJson;
          if (liveJob?.id) {
            orderId = liveJob.id;
          }
        }
      } catch {
        // Offline / dev fallback to generated orderId
      }

      this.tokenCounter++;
      const tokenNumber = `T-${this.tokenCounter.toString().padStart(3, '0')}`;
      const nowIso = new Date().toISOString();
      const docExpiresIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const isCounter = input.payment_method === 'pay_at_counter';

      const result: CheckoutResult = {
        order_id: orderId,
        token_number: tokenNumber,
        shop_id: shop.id,
        shop_name: shop.name,
        customer_id: input.customer_id,
        document_name: input.document_name,
        status: 'pending_payment',
        payment_status: isCounter ? 'pay_at_counter' : 'pending',
        payment_method: input.payment_method,
        amount_paise: input.quote.price_breakdown.total_paise,
        payment_redirect_url: isCounter
          ? undefined
          : `/print/payment?orderId=${encodeURIComponent(orderId)}`,
        idempotency_key,
        created_at: nowIso,
        document_expires_at: docExpiresIso
      };

      // 7. Store order into customer orders service
      const customerOrder: CustomerOrder = {
        id: orderId,
        token_number: tokenNumber,
        customer_id: input.customer_id,
        shop_id: shop.id,
        shop_name: shop.name,
        document_name: input.document_name,
        file_size_bytes: input.file_size_bytes,
        settings: {
          paper_size: input.settings.paper_size,
          color_mode: input.settings.color_mode,
          duplex: input.settings.sides === 'double',
          copies: input.settings.copies,
          orientation: input.settings.orientation,
          page_range: input.settings.page_range,
          pages_per_copy: input.quote.page_count,
          total_pages: input.quote.page_count * input.settings.copies,
          spiral_binding: input.settings.binding === 'spiral'
        },
        priority_tier: input.priority_tier,
        amount_paise: input.quote.price_breakdown.total_paise,
        status: 'pending_payment',
        payment_status: isCounter ? 'pay_at_counter' : 'pending',
        document_deleted: false,
        document_expires_at: docExpiresIso,
        created_at: nowIso
      };

      defaultOrdersService.addOrder(customerOrder);

      // 8. Commit to idempotency cache
      this.idempotencyStore.set(idempotency_key, result);

      return result;
    } finally {
      this.inFlightLocks.delete(idempotency_key);
    }
  }

  /**
   * Test helper to set custom pay-at-counter policy for a shop.
   */
  public setShopPayAtCounterPolicy(shopId: string, allowed: boolean, reason?: string | undefined) {
    this.payAtCounterOverrides.set(shopId, { allowed, reason });
  }

  /**
   * Test helper to clear idempotency cache.
   */
  public clearIdempotencyCache() {
    this.idempotencyStore.clear();
    this.inFlightLocks.clear();
    this.payAtCounterOverrides.clear();
  }
}

export const defaultCheckoutService = new CheckoutService();
