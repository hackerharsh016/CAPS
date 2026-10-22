/**
 * Customer Web Checkout & Razorpay Integration Service (INT-D1-03).
 *
 * Implements:
 * - Cloud API payment order creation: POST /api/v1/payments/razorpay/order
 * - Dynamic loading of Razorpay Standard Checkout SDK: https://checkout.razorpay.com/v1/checkout.js
 * - Launching the Razorpay modal with order_id, key, customer contact, and brand theme.
 * - Handling checkout callbacks and forwarding to /orders/:orderId/track.
 */

export interface CreatePaymentOrderInput {
  print_job_id: string;
  amount_paise?: number | undefined;
  requested_amount_paise?: number | undefined;
  currency?: 'INR' | undefined;
  notes?: Record<string, string> | undefined;
  receipt?: string | undefined;
}

export interface PaymentOrderData {
  order_id: string;
  amount_paise: number;
  currency: 'INR';
  key_id: string;
  receipt?: string | undefined;
  print_job_id: string;
  status: string;
}

export interface RazorpayPaymentSuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  amount: number; // integer in paise
  currency: 'INR' | string;
  name?: string | undefined;
  description?: string | undefined;
  image?: string | undefined;
  order_id: string;
  prefill?:
    | {
        name?: string | undefined;
        email?: string | undefined;
        contact?: string | undefined;
      }
    | undefined;
  notes?: Record<string, string> | undefined;
  theme?:
    | {
        color?: string | undefined;
      }
    | undefined;
  modal?:
    | {
        ondismiss?: () => void;
        escape?: boolean | undefined;
        backdropclose?: boolean | undefined;
      }
    | undefined;
  handler?: (response: RazorpayPaymentSuccess) => void;
}

export interface CheckoutServiceOptions {
  baseUrl?: string | undefined;
  keyId?: string | undefined;
  themeColor?: string | undefined;
}

export const RAZORPAY_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
export const DEFAULT_THEME_COLOR = '#2563eb'; // Tailwind blue-600

export class CheckoutService {
  private readonly baseUrl: string;
  private readonly defaultKeyId?: string | undefined;
  private readonly themeColor: string;

  constructor(options: CheckoutServiceOptions = {}) {
    this.baseUrl =
      options.baseUrl ||
      (typeof process !== 'undefined'
        ? process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000'
        : 'http://localhost:4000');
    this.defaultKeyId =
      options.keyId ||
      (typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_RAZORPAY_KEY_ID'] : undefined);
    this.themeColor = options.themeColor || DEFAULT_THEME_COLOR;
  }

  /**
   * Calls Cloud API to create a Razorpay payment order.
   */
  public async createPaymentOrder(
    input: CreatePaymentOrderInput,
    signal?: AbortSignal
  ): Promise<PaymentOrderData> {
    const apiUrl = this.baseUrl.replace(/\/+$/, '');
    const payload = {
      print_job_id: input.print_job_id,
      ...(input.amount_paise !== undefined ? { amount_paise: input.amount_paise } : {}),
      ...(input.requested_amount_paise !== undefined
        ? { requested_amount_paise: input.requested_amount_paise }
        : {}),
      currency: input.currency ?? 'INR',
      notes: input.notes,
      receipt: input.receipt
    };

    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
    if (signal) {
      init.signal = signal;
    }

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/v1/payments/razorpay/order`, init);
    } catch {
      if (signal?.aborted) {
        throw new DOMException('Payment order request aborted', 'AbortError');
      }
      // Retry with alias /api/v1/payments/orders
      res = await fetch(`${apiUrl}/api/v1/payments/orders`, init);
    }

    if (!res.ok) {
      // Fallback attempt with /api/v1/payments/orders if first returned 404
      if (res.status === 404) {
        const fallbackRes = await fetch(`${apiUrl}/api/v1/payments/orders`, init);
        if (fallbackRes.ok) {
          const json = await fallbackRes.json();
          return json.data || json;
        }
      }
      const errBody = await res.json().catch(() => null);
      const errMsg =
        errBody?.error?.message || `Failed to create Razorpay payment order: HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    const json = await res.json();
    return json.data || json;
  }

  /**
   * Dynamically injects the Razorpay Standard Checkout SDK into the DOM.
   */
  public async loadRazorpayScript(scriptUrl = RAZORPAY_SCRIPT_URL): Promise<boolean> {
    if (typeof window === 'undefined') {
      return false;
    }

    if ((window as any).Razorpay) {
      return true;
    }

    if (typeof document === 'undefined') {
      return false;
    }

    // Check if script element already exists
    const existing = document.querySelector(`script[src="${scriptUrl}"]`);
    if (existing) {
      return new Promise<boolean>(resolve => {
        if ((window as any).Razorpay) {
          return resolve(true);
        }
        existing.addEventListener('load', () => resolve(true));
        existing.addEventListener('error', () => resolve(false));
      });
    }

    return new Promise<boolean>(resolve => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  /**
   * Launches the Razorpay Standard Checkout modal.
   * Returns a promise resolving with the payment success response or rejecting on cancellation/failure.
   */
  public async launchRazorpayModal(options: {
    order: PaymentOrderData;
    customerDetails?:
      | {
          name?: string | undefined;
          email?: string | undefined;
          phone?: string | undefined;
        }
      | undefined;
    notes?: Record<string, string> | undefined;
    themeColor?: string | undefined;
    onDismiss?: (() => void) | undefined;
  }): Promise<RazorpayPaymentSuccess> {
    if (typeof (window as any)?.Razorpay !== 'function') {
      const isLoaded = await this.loadRazorpayScript();
      if (!isLoaded || typeof (window as any)?.Razorpay !== 'function') {
        throw new Error('Razorpay SDK failed to load. Please check your internet connection.');
      }
    }

    const RazorpayCtor = (window as any).Razorpay;

    return new Promise<RazorpayPaymentSuccess>((resolve, reject) => {
      let isSettled = false;

      const checkoutOptions: RazorpayCheckoutOptions = {
        key: options.order.key_id || this.defaultKeyId || '',
        amount: options.order.amount_paise,
        currency: options.order.currency || 'INR',
        name: 'CAPS Cloud Print',
        description: `Print Job #${options.order.print_job_id.slice(0, 8)}`,
        order_id: options.order.order_id,
        prefill: {
          name: options.customerDetails?.name,
          email: options.customerDetails?.email,
          contact: options.customerDetails?.phone
        },
        notes: {
          print_job_id: options.order.print_job_id,
          ...(options.notes || {})
        },
        theme: {
          color: options.themeColor || this.themeColor
        },
        modal: {
          ondismiss: () => {
            if (!isSettled) {
              isSettled = true;
              options.onDismiss?.();
              reject(new Error('PAYMENT_DISMISSED: User closed the payment modal.'));
            }
          }
        },
        handler: (response: RazorpayPaymentSuccess) => {
          if (!isSettled) {
            isSettled = true;
            resolve(response);
          }
        }
      };

      const rzpInstance = new RazorpayCtor(checkoutOptions);
      if (typeof rzpInstance.on === 'function') {
        rzpInstance.on('payment.failed', (errResponse: any) => {
          if (!isSettled) {
            isSettled = true;
            reject(
              new Error(
                errResponse?.error?.description ||
                  errResponse?.error?.message ||
                  'Payment transaction failed.'
              )
            );
          }
        });
      }

      rzpInstance.open();
    });
  }

  /**
   * Complete checkout and payment flow: creates order, launches modal, and returns tracking URL.
   */
  public async checkoutAndPay(params: {
    printJobId: string;
    amountPaise?: number | undefined;
    customerDetails?:
      | {
          name?: string | undefined;
          email?: string | undefined;
          phone?: string | undefined;
        }
      | undefined;
    notes?: Record<string, string> | undefined;
    onDismiss?: () => void;
  }): Promise<{
    payment: RazorpayPaymentSuccess;
    order: PaymentOrderData;
    trackingUrl: string;
  }> {
    const order = await this.createPaymentOrder({
      print_job_id: params.printJobId,
      amount_paise: params.amountPaise,
      notes: params.notes
    });

    const payment = await this.launchRazorpayModal({
      order,
      customerDetails: params.customerDetails,
      notes: params.notes,
      onDismiss: params.onDismiss
    });

    return {
      payment,
      order,
      trackingUrl: this.getOrderTrackingUrl(order.print_job_id)
    };
  }

  /**
   * Helper that builds the live tracking page URL for an order.
   */
  public getOrderTrackingUrl(orderId: string): string {
    return `/orders/${encodeURIComponent(orderId)}/track`;
  }
}

export const defaultCheckoutService = new CheckoutService();
