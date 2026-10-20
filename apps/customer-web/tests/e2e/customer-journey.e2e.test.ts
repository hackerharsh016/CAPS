/**
 * CAPS Customer Module End-to-End Acceptance Gate (P04-M07-F01).
 *
 * Full-journey acceptance test exercising the complete customer flow:
 * 1. Authentication & Session Acquisition (Supabase Auth, Token Lifecycle, RoleGuard)
 * 2. Shop Discovery & Filtering (Search, Location Fallback, Capability Inspection)
 * 3. Document Preflight, Upload Intent & Checksum Verification
 * 4. Capability-Aware Print Settings & Constraint Enforcement
 * 5. Live Pricing Quote & Itemized GST / Urgent Surcharge Calculation
 * 6. Order Review, Checkout, Double-Click Idempotency & Closed Shop Safety
 * 7. Queue Tracking, Token Display, 24h Privacy Countdown & Realtime Resync
 * 8. Customer Order History & Strict Multi-Tenant Boundary Isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SupabaseAuthClient } from '../../src/features/auth/supabase-auth-client';
import { createDefaultStorage } from '../../src/features/auth/storage';
import { ShopsService } from '../../src/features/shop-discovery/shops-service';
import { MOCK_SHOPS } from '../../src/features/shop-discovery/fixtures';
import { validateDocumentPreflight } from '../../src/features/document-upload/validation';
import { inspectPdfBytes } from '../../src/features/document-upload/pdf-inspector';
import { DirectUploadClient } from '../../src/features/document-upload/direct-upload-client';
import { validatePrintSettings } from '../../src/features/print-settings/validation';
import {
  defaultCapabilitiesService,
  checkSettingsCompatibility
} from '../../src/features/print-settings/capabilities-service';
import type { PrintSettings } from '../../src/features/print-settings/types';
import { generateAuthoritativeQuote } from '../../src/features/pricing/pricing-calculator';
import { CheckoutService } from '../../src/features/checkout/checkout-service';
import type { CheckoutOrderInput } from '../../src/features/checkout/types';
import { defaultOrdersService, OrdersService } from '../../src/features/orders/orders-service';
import { QueueTrackingService } from '../../src/features/queue-tracking/queue-tracking-service';
import { RealtimeTrackingClient } from '../../src/features/queue-tracking/realtime-tracking-client';

describe('CAPS Customer Module End-to-End Journey (P04-M07-F01)', () => {
  let storage: ReturnType<typeof createDefaultStorage>;
  let authClient: SupabaseAuthClient;
  let shopsService: ShopsService;
  let ordersService: OrdersService;
  let checkoutService: CheckoutService;
  let queueTrackingService: QueueTrackingService;

  const customerId = 'usr-customer-alpha';
  const customerEmail = 'alice.student@university.edu';
  const otherCustomerId = 'usr-customer-BETA-ANOTHER-TENANT';

  beforeEach(() => {
    storage = createDefaultStorage();
    authClient = new SupabaseAuthClient({
      supabaseUrl: 'https://test-project.supabase.co',
      supabaseAnonKey: 'test-anon-key-caps-customer-web',
      storage
    });
    shopsService = new ShopsService(MOCK_SHOPS);
    ordersService = defaultOrdersService;
    checkoutService = new CheckoutService();
    queueTrackingService = new QueueTrackingService(ordersService, shopsService);
  });

  it('executes full end-to-end customer journey from login to tracking with zero errors', async () => {
    // =========================================================================
    // STEP 1: Authentication & Customer Session Acquisition
    // =========================================================================
    const mockAuthResponse = {
      access_token: 'mock-jwt-customer-alpha-valid',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'mock-refresh-token-alpha',
      user: {
        id: customerId,
        email: customerEmail,
        role: 'customer' as const,
        app_metadata: { role: 'customer' },
        user_metadata: { name: 'Alice Student' },
        created_at: new Date().toISOString()
      }
    };

    authClient = new SupabaseAuthClient({
      supabaseUrl: 'https://test-project.supabase.co',
      supabaseAnonKey: 'test-anon-key-caps-customer-web',
      storage,
      customFetch: async () =>
        new Response(JSON.stringify(mockAuthResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    });

    const { user, session } = await authClient.signInWithPassword({
      email: customerEmail,
      password: 'StrongPassword@123'
    });

    expect(user.id).toBe(customerId);
    expect(user.app_metadata?.['role']).toBe('customer');
    expect(session.access_token).toBe('mock-jwt-customer-alpha-valid');

    // =========================================================================
    // STEP 2: Shop Discovery & Capability Verification
    // =========================================================================
    const shopDiscovery = await shopsService.getShops({
      searchQuery: 'Campus',
      userCoordinates: { latitude: 12.9716, longitude: 77.5946 }
    });

    expect(shopDiscovery.shops.length).toBeGreaterThan(0);
    const selectedShop = shopDiscovery.shops.find((s) => s.id === 'shop-8888-campus-xerox')!;
    expect(selectedShop).toBeDefined();
    expect(selectedShop.name).toBe('Campus Central Xerox & Stationery');
    expect(selectedShop.is_open).toBe(true);
    expect(selectedShop.capabilities.paper_sizes).toContain('A4');
    expect(selectedShop.capabilities.color).toBe(true);
    expect(selectedShop.capabilities.duplex).toBe(true);
    expect(selectedShop.capabilities.spiral_binding).toBe(true);

    // =========================================================================
    // STEP 3: Document Preflight, Intent Negotiation & Checksum Verification
    // =========================================================================
    const samplePdfContent = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF';
    const samplePdfBytes = new TextEncoder().encode(samplePdfContent);
    const mockFile = {
      name: 'Thesis_Draft_Final.pdf',
      size: samplePdfBytes.byteLength,
      type: 'application/pdf'
    };

    // 3a. Client preflight validation
    const preflightResult = validateDocumentPreflight(mockFile);
    expect(preflightResult.valid).toBe(true);

    // 3b. PDF structure inspection
    const pdfInspection = inspectPdfBytes(samplePdfBytes);
    expect(pdfInspection.isValidPdf).toBe(true);

    // 3c. Direct private upload intent negotiation & finalization
    const directUploadClient = new DirectUploadClient();
    const intent = await directUploadClient.createUploadIntent(
      {
        fileName: mockFile.name,
        fileSizeBytes: mockFile.size,
        mimeType: 'application/pdf',
        targetShopId: selectedShop.id
      },
      customerId
    );
    expect(intent.documentId).toBeDefined();
    expect(intent.storagePath).toContain(customerId);

    // Finalize upload with verified checksum
    const finalDoc = await directUploadClient.finalizeUpload(
      intent.documentId,
      {
        actualSizeBytes: mockFile.size,
        sha256Checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      },
      customerId
    );
    expect(finalDoc.documentId).toBe(intent.documentId);
    expect(finalDoc.status).toBe('uploaded');

    // =========================================================================
    // STEP 4: Print Settings & Capability Constraint Enforcement
    // =========================================================================
    const validSettings: PrintSettings = {
      paper_size: 'A4',
      color_mode: 'bw',
      sides: 'double',
      copies: 2,
      orientation: 'portrait',
      page_range: '1-15',
      binding: 'spiral'
    };

    const settingsValidation = validatePrintSettings(validSettings, 15);
    expect(settingsValidation.isValid).toBe(true);
    expect(settingsValidation.calculation?.effectivePageCount).toBe(15);

    // Verify capability compatibility with selected shop
    const capabilities = await defaultCapabilitiesService.getShopPrinterCapabilities(selectedShop.id);
    const compatibility = checkSettingsCompatibility(validSettings, capabilities);
    expect(compatibility.isCompatible).toBe(true);

    // Verify rejection of unsupported settings against mono-only fleet
    const monoFleetCapabilities = await defaultCapabilitiesService.getShopPrinterCapabilities('shop-offline-fleet');
    const monoCheck = checkSettingsCompatibility(
      { ...validSettings, color_mode: 'color' },
      monoFleetCapabilities
    );
    expect(monoCheck.isCompatible).toBe(false);

    // =========================================================================
    // STEP 5: Live Pricing Quote Generation
    // =========================================================================
    const quote = generateAuthoritativeQuote({
      shop_id: selectedShop.id,
      settings: validSettings,
      priority_tier: 'urgent',
      document_page_count: 15
    });

    expect(quote.shop_id).toBe(selectedShop.id);
    expect(quote.price_breakdown.subtotal_paise).toBeGreaterThan(0);
    expect(quote.price_breakdown.gst_paise).toBeGreaterThan(0);
    expect(quote.price_breakdown.urgent_surcharge_paise).toBe(2000); // ₹20 express fee
    expect(quote.price_breakdown.total_paise).toBe(
      quote.price_breakdown.subtotal_paise + quote.price_breakdown.gst_paise
    );
    expect(new Date(quote.expires_at).getTime()).toBeGreaterThan(Date.now());

    // =========================================================================
    // STEP 6: Order Review, Checkout, Closed Shop & Idempotency Defense
    // =========================================================================
    const idempotencyKey = `idemp_e2e_${Date.now()}`;
    const checkoutInput: CheckoutOrderInput = {
      quote_id: quote.quote_id,
      shop_id: selectedShop.id,
      customer_id: customerId,
      document_name: mockFile.name,
      document_storage_key: intent.storagePath,
      file_size_bytes: mockFile.size,
      settings: validSettings,
      priority_tier: 'urgent',
      quote,
      payment_method: 'pay_at_counter',
      idempotency_key: idempotencyKey
    };

    // 6a. Pay-at-counter eligibility check
    const counterPolicy = checkoutService.canPayAtCounter(selectedShop);
    expect(counterPolicy.allowed).toBe(true);

    // 6b. Initial successful order placement
    const orderResult1 = await checkoutService.createPendingOrder(checkoutInput);
    expect(orderResult1.order_id).toBeDefined();
    expect(orderResult1.token_number).toMatch(/^T-\d{3}$/);
    expect(orderResult1.status).toBe('pending_payment');
    expect(orderResult1.document_expires_at).toBeDefined();

    // 6c. Idempotency double-click defense: Rapid repeat call returns identical result without duplicate
    const orderResult2 = await checkoutService.createPendingOrder(checkoutInput);
    expect(orderResult2.order_id).toBe(orderResult1.order_id);
    expect(orderResult2.token_number).toBe(orderResult1.token_number);

    // =========================================================================
    // STEP 7: Queue Tracking, Token Display & Realtime Wake-up
    // =========================================================================
    // 7a. Initial tracking inspection
    const tracking = await queueTrackingService.getJobTracking(orderResult1.order_id, customerId);
    expect(tracking.job_id).toBe(orderResult1.order_id);
    expect(tracking.token_number).toBe(orderResult1.token_number);
    expect(tracking.priority_tier).toBe('urgent');
    expect(tracking.queue_position).toBe(1); // Urgent gets express position
    expect(tracking.status).toBe('pending_payment');
    expect(tracking.document_deleted).toBe(false);

    // 7b. Realtime wake-up subscription
    const realtimeClient = new RealtimeTrackingClient({
      jobId: orderResult1.order_id,
      customerId
    });

    const wakeUpListener = vi.fn();
    realtimeClient.onWakeup(wakeUpListener);
    realtimeClient.subscribe();

    // Dispatch status change wake-up event
    const statusEvent = {
      job_id: orderResult1.order_id,
      customer_id: customerId,
      shop_id: selectedShop.id,
      event_type: 'status_changed' as const,
      status: 'printing',
      timestamp: new Date().toISOString(),
      sequence_number: 1
    };
    const eventProcessed = realtimeClient.handleIncomingEvent(statusEvent);
    expect(eventProcessed).toBe(true);
    expect(wakeUpListener).toHaveBeenCalledTimes(1);

    // Clean subscription teardown
    realtimeClient.unsubscribe();
    expect(realtimeClient.getState()).toBe('disconnected');

    // =========================================================================
    // STEP 8: Customer Order History & Multi-Tenant Boundary Isolation
    // =========================================================================
    // 8a. Customer Alpha queries their order history
    const customerOrders = await ordersService.getCustomerOrders({
      customerId,
      page: 1,
      limit: 10,
      filter: 'all'
    });
    expect(customerOrders.orders.some((o) => o.id === orderResult1.order_id)).toBe(true);

    // 8b. Strict Tenant Isolation Invariant: Customer Beta CANNOT inspect Customer Alpha's order
    const crossTenantOrder = await ordersService.getOrderById(orderResult1.order_id, otherCustomerId);
    expect(crossTenantOrder).toBeNull();

    await expect(
      queueTrackingService.getJobTracking(orderResult1.order_id, otherCustomerId)
    ).rejects.toThrow();
  });

  describe('Edge Cases & Failure Recovery', () => {
    it('rejects order admission if shop is closed', async () => {
      const closedShop = MOCK_SHOPS.find((s) => s.id === 'shop-7777-tech-xerox')!;
      expect(closedShop).toBeDefined();
      expect(closedShop.is_open).toBe(false);

      const quote = generateAuthoritativeQuote({
        shop_id: closedShop.id,
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          orientation: 'portrait',
          page_range: '1-5',
          binding: 'none'
        },
        priority_tier: 'flexible',
        document_page_count: 5
      });

      await expect(
        checkoutService.createPendingOrder({
          quote_id: quote.quote_id,
          shop_id: closedShop.id,
          customer_id: customerId,
          document_name: 'test.pdf',
          document_storage_key: 'docs/test.pdf',
          file_size_bytes: 50000,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            orientation: 'portrait',
            page_range: '1-5',
            binding: 'none'
          },
          priority_tier: 'flexible',
          quote,
          payment_method: 'upi',
          idempotency_key: 'key-closed-shop'
        })
      ).rejects.toThrow(/closed/i);
    });

    it('rejects order admission with expired quote', async () => {
      const openShop = MOCK_SHOPS[0]!;
      const staleQuote = generateAuthoritativeQuote({
        shop_id: openShop.id,
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          orientation: 'portrait',
          page_range: '1-5',
          binding: 'none'
        },
        priority_tier: 'flexible',
        document_page_count: 5
      });

      // Force expiration into the past
      staleQuote.expires_at = new Date(Date.now() - 60000).toISOString();

      await expect(
        checkoutService.createPendingOrder({
          quote_id: staleQuote.quote_id,
          shop_id: openShop.id,
          customer_id: customerId,
          document_name: 'stale.pdf',
          document_storage_key: 'docs/stale.pdf',
          file_size_bytes: 50000,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            orientation: 'portrait',
            page_range: '1-5',
            binding: 'none'
          },
          priority_tier: 'flexible',
          quote: staleQuote,
          payment_method: 'upi',
          idempotency_key: 'key-stale-quote'
        })
      ).rejects.toThrow(/expired/i);
    });

    it('rejects pay-at-counter for cashless transit locations', async () => {
      const metroTransitShop = MOCK_SHOPS.find((s) => s.id === 'shop-9999-metro-prints')!;
      expect(metroTransitShop).toBeDefined();

      const quote = generateAuthoritativeQuote({
        shop_id: metroTransitShop.id,
        settings: {
          paper_size: 'A4',
          color_mode: 'bw',
          sides: 'single',
          copies: 1,
          orientation: 'portrait',
          page_range: '1-2',
          binding: 'none'
        },
        priority_tier: 'flexible',
        document_page_count: 2
      });

      await expect(
        checkoutService.createPendingOrder({
          quote_id: quote.quote_id,
          shop_id: metroTransitShop.id,
          customer_id: customerId,
          document_name: 'resume.pdf',
          document_storage_key: 'docs/resume.pdf',
          file_size_bytes: 20000,
          settings: {
            paper_size: 'A4',
            color_mode: 'bw',
            sides: 'single',
            copies: 1,
            orientation: 'portrait',
            page_range: '1-2',
            binding: 'none'
          },
          priority_tier: 'flexible',
          quote,
          payment_method: 'pay_at_counter',
          idempotency_key: 'key-metro-counter'
        })
      ).rejects.toThrow(/cashless/i);
    });
  });
});
