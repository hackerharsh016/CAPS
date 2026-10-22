import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CheckoutService,
  RAZORPAY_SCRIPT_URL,
  DEFAULT_THEME_COLOR,
  type PaymentOrderData,
  type RazorpayPaymentSuccess
} from '../checkout.service';

describe('Task INT-D1-03: Customer Web Checkout & Razorpay Modal Integration', () => {
  const sampleJobId = '77777777-1111-2222-3333-444444444444';
  const sampleOrderId = 'order_test_rzp_mock_001';
  const sampleKeyId = 'rzp_test_mock_key_12345';
  const samplePaymentId = 'pay_test_capture_001';
  const sampleSignature = 'sig_test_hmac_sha256_mock';

  let service: CheckoutService;
  let originalWindow: any;
  let originalDocument: any;
  let originalFetch: any;

  beforeEach(() => {
    service = new CheckoutService({
      baseUrl: 'http://localhost:4000',
      keyId: sampleKeyId,
      themeColor: DEFAULT_THEME_COLOR
    });

    originalFetch = globalThis.fetch;
    originalWindow = (globalThis as any).window;
    originalDocument = (globalThis as any).document;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    if (originalDocument !== undefined) {
      (globalThis as any).document = originalDocument;
    } else {
      delete (globalThis as any).document;
    }
    vi.clearAllMocks();
  });

  // ============================================================================
  // Test Suite 1: Payment Order Creation via Cloud API
  // ============================================================================
  describe('createPaymentOrder', () => {
    it('calls Cloud API POST /api/v1/payments/razorpay/order with integer paise and returns order details', async () => {
      const mockOrderResponse: PaymentOrderData = {
        order_id: sampleOrderId,
        amount_paise: 2950,
        currency: 'INR',
        key_id: sampleKeyId,
        receipt: 'rcpt_77777777',
        print_job_id: sampleJobId,
        status: 'initiated'
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: mockOrderResponse })
      });
      globalThis.fetch = fetchMock;

      const order = await service.createPaymentOrder({
        print_job_id: sampleJobId,
        amount_paise: 2950,
        currency: 'INR',
        notes: { customer_email: 'alice@caps.local' }
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(call).toBeDefined();
      const [url, init] = call;
      expect(url).toBe('http://localhost:4000/api/v1/payments/razorpay/order');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        print_job_id: sampleJobId,
        amount_paise: 2950,
        currency: 'INR',
        notes: { customer_email: 'alice@caps.local' }
      });

      expect(order).toEqual(mockOrderResponse);
      expect(order.order_id).toBe(sampleOrderId);
      expect(order.amount_paise).toBe(2950);
      expect(order.currency).toBe('INR');
      expect(Number.isInteger(order.amount_paise)).toBe(true);
    });

    it('falls back to /api/v1/payments/orders when primary endpoint returns 404', async () => {
      const mockOrderResponse: PaymentOrderData = {
        order_id: sampleOrderId,
        amount_paise: 2500,
        currency: 'INR',
        key_id: sampleKeyId,
        print_job_id: sampleJobId,
        status: 'initiated'
      };

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Not found' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ data: mockOrderResponse })
        });
      globalThis.fetch = fetchMock;

      const order = await service.createPaymentOrder({
        print_job_id: sampleJobId,
        amount_paise: 2500
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(secondCall[0]).toBe('http://localhost:4000/api/v1/payments/orders');
      expect(order.order_id).toBe(sampleOrderId);
    });

    it('throws error when server responds with 400 Bad Request (e.g. tampering or validation)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            code: 'AMOUNT_TAMPERING_DETECTED',
            message: 'Client submitted amount does not match authoritative quote.'
          }
        })
      });

      await expect(
        service.createPaymentOrder({
          print_job_id: sampleJobId,
          requested_amount_paise: 50 // Tampered
        })
      ).rejects.toThrow('Client submitted amount does not match authoritative quote.');
    });
  });

  // ============================================================================
  // Test Suite 2: Razorpay Script Dynamic Loader
  // ============================================================================
  describe('loadRazorpayScript', () => {
    it('returns false in non-browser (Node.js) environment', async () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;

      const loaded = await service.loadRazorpayScript();
      expect(loaded).toBe(false);
    });

    it('returns true immediately when window.Razorpay already exists in DOM', async () => {
      (globalThis as any).window = {
        Razorpay: vi.fn()
      };
      (globalThis as any).document = {};

      const loaded = await service.loadRazorpayScript();
      expect(loaded).toBe(true);
    });

    it('appends script tag with correct URL and resolves on script load', async () => {
      let appendedScript: any = null;

      const mockDocument = {
        querySelector: vi.fn().mockReturnValue(null),
        createElement: vi.fn(tag => {
          const el = {
            tagName: tag,
            src: '',
            async: false,
            onload: null as any,
            onerror: null as any
          };
          return el;
        }),
        body: {
          appendChild: vi.fn(el => {
            appendedScript = el;
            setTimeout(() => {
              (globalThis as any).window.Razorpay = vi.fn();
              if (el.onload) el.onload();
            }, 10);
            return el;
          })
        }
      };

      (globalThis as any).window = {};
      (globalThis as any).document = mockDocument;

      const loaded = await service.loadRazorpayScript();
      expect(loaded).toBe(true);
      expect(mockDocument.createElement).toHaveBeenCalledWith('script');
      expect(appendedScript.src).toBe(RAZORPAY_SCRIPT_URL);
      expect(appendedScript.async).toBe(true);
      expect(mockDocument.body.appendChild).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test Suite 3: Razorpay Modal Launch & Payment Callbacks
  // ============================================================================
  describe('launchRazorpayModal', () => {
    const sampleOrderData: PaymentOrderData = {
      order_id: sampleOrderId,
      amount_paise: 2950,
      currency: 'INR',
      key_id: sampleKeyId,
      print_job_id: sampleJobId,
      status: 'initiated'
    };

    it('initializes Razorpay with test-mode options and resolves on payment success', async () => {
      let capturedOptions: any = null;
      const mockInstance = {
        open: vi.fn(),
        on: vi.fn()
      };

      const mockRazorpayCtor = vi.fn().mockImplementation(opts => {
        capturedOptions = opts;
        return mockInstance;
      });

      (globalThis as any).window = {
        Razorpay: mockRazorpayCtor
      };
      (globalThis as any).document = {};

      const launchPromise = service.launchRazorpayModal({
        order: sampleOrderData,
        customerDetails: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '9876543210'
        },
        themeColor: '#2563eb'
      });

      // Verify Razorpay was constructed with correct options
      expect(mockRazorpayCtor).toHaveBeenCalledTimes(1);
      expect(capturedOptions.key).toBe(sampleKeyId);
      expect(capturedOptions.order_id).toBe(sampleOrderId);
      expect(capturedOptions.amount).toBe(2950);
      expect(capturedOptions.currency).toBe('INR');
      expect(capturedOptions.prefill.name).toBe('Jane Doe');
      expect(capturedOptions.prefill.email).toBe('jane@example.com');
      expect(capturedOptions.prefill.contact).toBe('9876543210');
      expect(capturedOptions.theme.color).toBe('#2563eb');
      expect(capturedOptions.notes.print_job_id).toBe(sampleJobId);
      expect(mockInstance.open).toHaveBeenCalledTimes(1);

      // Simulate customer completing payment in Razorpay modal
      const successPayload: RazorpayPaymentSuccess = {
        razorpay_payment_id: samplePaymentId,
        razorpay_order_id: sampleOrderId,
        razorpay_signature: sampleSignature
      };
      capturedOptions.handler(successPayload);

      const result = await launchPromise;
      expect(result).toEqual(successPayload);
      expect(result.razorpay_payment_id).toBe(samplePaymentId);
      expect(result.razorpay_order_id).toBe(sampleOrderId);
      expect(result.razorpay_signature).toBe(sampleSignature);
    });

    it('rejects when customer closes or dismisses the modal', async () => {
      let capturedOptions: any = null;
      const mockInstance = {
        open: vi.fn(),
        on: vi.fn()
      };

      (globalThis as any).window = {
        Razorpay: vi.fn().mockImplementation(opts => {
          capturedOptions = opts;
          return mockInstance;
        })
      };
      (globalThis as any).document = {};

      const dismissSpy = vi.fn();
      const launchPromise = service.launchRazorpayModal({
        order: sampleOrderData,
        onDismiss: dismissSpy
      });

      // Trigger modal dismissal callback
      expect(capturedOptions).not.toBeNull();
      capturedOptions.modal.ondismiss();

      await expect(launchPromise).rejects.toThrow('PAYMENT_DISMISSED');
      expect(dismissSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects when payment fails inside the Razorpay modal', async () => {
      let paymentFailedListener: any = null;
      const mockInstance = {
        open: vi.fn(),
        on: vi.fn((event, cb) => {
          if (event === 'payment.failed') {
            paymentFailedListener = cb;
          }
        })
      };

      (globalThis as any).window = {
        Razorpay: vi.fn().mockReturnValue(mockInstance)
      };
      (globalThis as any).document = {};

      const launchPromise = service.launchRazorpayModal({
        order: sampleOrderData
      });

      expect(paymentFailedListener).toBeDefined();

      // Simulate payment failure callback from Razorpay
      paymentFailedListener({
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'Payment was declined by issuing bank.'
        }
      });

      await expect(launchPromise).rejects.toThrow('Payment was declined by issuing bank.');
    });
  });

  // ============================================================================
  // Test Suite 4: End-to-End Checkout Flow & Order Tracking Redirection
  // ============================================================================
  describe('checkoutAndPay & Live Tracking Navigation', () => {
    it('creates order, opens modal, and forwards to live tracking page /orders/:orderId/track', async () => {
      const mockOrderResponse: PaymentOrderData = {
        order_id: sampleOrderId,
        amount_paise: 2950,
        currency: 'INR',
        key_id: sampleKeyId,
        print_job_id: sampleJobId,
        status: 'initiated'
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: mockOrderResponse })
      });

      let capturedOptions: any = null;
      const mockInstance = {
        open: vi.fn(),
        on: vi.fn()
      };

      (globalThis as any).window = {
        Razorpay: vi.fn().mockImplementation(opts => {
          capturedOptions = opts;
          return mockInstance;
        })
      };
      (globalThis as any).document = {};

      // Trigger complete checkout flow
      const checkoutPromise = service.checkoutAndPay({
        printJobId: sampleJobId,
        amountPaise: 2950,
        customerDetails: {
          name: 'Alice Springs',
          email: 'alice@caps.local',
          phone: '9988776655'
        }
      });

      // Let microtasks tick to complete fetch
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify modal opened
      expect(mockInstance.open).toHaveBeenCalledTimes(1);

      // Simulate successful payment
      capturedOptions.handler({
        razorpay_payment_id: samplePaymentId,
        razorpay_order_id: sampleOrderId,
        razorpay_signature: sampleSignature
      });

      const outcome = await checkoutPromise;

      // Verify acceptance criteria:
      // 1. Payment success confirmed
      expect(outcome.payment.razorpay_payment_id).toBe(samplePaymentId);
      expect(outcome.payment.razorpay_signature).toBe(sampleSignature);
      expect(outcome.order.order_id).toBe(sampleOrderId);

      // 2. Confirmed live tracking page destination
      expect(outcome.trackingUrl).toBe(`/orders/${sampleJobId}/track`);
      expect(service.getOrderTrackingUrl(sampleJobId)).toBe(`/orders/${sampleJobId}/track`);
    });
  });
});
