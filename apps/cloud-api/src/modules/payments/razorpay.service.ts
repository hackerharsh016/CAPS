import crypto from 'node:crypto';
import type { RazorpayOrderInput, RazorpayOrderResponse } from './payments.types.js';

export interface IRazorpayClient {
  createOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResponse>;
  getOrder(orderId: string): Promise<RazorpayOrderResponse | null>;
  getKeyId(): string;
}

/**
 * Validates the HMAC-SHA256 signature attached to Razorpay webhook requests.
 * Uses timingSafeEqual to protect against timing side-channel attacks.
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret || !rawBody) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf-8')
      .digest('hex');

    if (expectedSignature.length !== signature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf-8'),
      Buffer.from(signature, 'utf-8')
    );
  } catch {
    return false;
  }
}

export class MockRazorpayClient implements IRazorpayClient {
  private keyId: string;
  private orders: Map<string, RazorpayOrderResponse> = new Map();

  constructor(keyId = 'rzp_test_mock_caps_key') {
    this.keyId = keyId;
  }

  getKeyId(): string {
    return this.keyId;
  }

  setOrderStatus(orderId: string, status: 'created' | 'attempted' | 'paid'): void {
    const order = this.orders.get(orderId);
    if (order) {
      this.orders.set(orderId, { ...order, status });
    } else {
      this.orders.set(orderId, {
        id: orderId,
        amount: 2950,
        currency: 'INR',
        receipt: `rcpt_${orderId}`,
        status,
        created_at: Math.floor(Date.now() / 1000)
      });
    }
  }

  async createOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResponse> {
    if (input.amount_paise <= 0) {
      throw new Error('Razorpay order amount must be a positive integer in paise.');
    }
    if (input.currency !== 'INR') {
      throw new Error(`Unsupported currency '${input.currency}'. CAPS strictly requires INR.`);
    }

    const randomSuffix = Math.random().toString(36).substring(2, 12);
    const orderId = `order_${randomSuffix}`;

    const order: RazorpayOrderResponse = {
      id: orderId,
      amount: input.amount_paise,
      currency: 'INR',
      receipt: input.receipt,
      status: 'created',
      created_at: Math.floor(Date.now() / 1000),
      ...(input.notes !== undefined ? { notes: { ...input.notes } } : {})
    };

    this.orders.set(orderId, order);
    return { ...order };
  }

  async getOrder(orderId: string): Promise<RazorpayOrderResponse | null> {
    const order = this.orders.get(orderId);
    return order ? { ...order } : null;
  }
}

export class RazorpayHttpClient implements IRazorpayClient {
  private keyId: string;
  private keySecret: string;
  private baseUrl: string;

  constructor(keyId: string, keySecret: string, baseUrl = 'https://api.razorpay.com/v1') {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.baseUrl = baseUrl;
  }

  getKeyId(): string {
    return this.keyId;
  }

  async createOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResponse> {
    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    const payload: Record<string, unknown> = {
      amount: input.amount_paise,
      currency: input.currency,
      receipt: input.receipt,
      ...(input.notes !== undefined ? { notes: input.notes } : {})
    };

    const response = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Razorpay API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as RazorpayOrderResponse;
    return data;
  }

  async getOrder(orderId: string): Promise<RazorpayOrderResponse | null> {
    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    const response = await fetch(`${this.baseUrl}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader
      }
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Razorpay API error (${response.status}): ${errorText}`);
    }

    return (await response.json()) as RazorpayOrderResponse;
  }
}

export function createRazorpayClient(options: {
  keyId?: string | undefined;
  keySecret?: string | undefined;
  useMock?: boolean | undefined;
} = {}): IRazorpayClient {
  if (options.useMock || !options.keyId || !options.keySecret) {
    return new MockRazorpayClient(options.keyId ?? 'rzp_test_mock_caps_key');
  }
  return new RazorpayHttpClient(options.keyId, options.keySecret);
}
