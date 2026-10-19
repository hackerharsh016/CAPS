export type PaymentMethod = 'upi' | 'card' | 'wallet' | 'pay_at_counter';

export type PaymentStatus = 'initiated' | 'success' | 'failed' | 'refunded';

export interface PaymentRecord {
  id: string; // UUID
  print_job_id: string; // UUID referencing PrintJob
  amount_paise: number;
  currency: 'INR';
  method: PaymentMethod;
  gateway_ref?: string | undefined; // Razorpay payment_id or order_id
  status: PaymentStatus;
  created_at: string;
  updated_at?: string | undefined;
}

export interface CreatePaymentDto {
  print_job_id: string;
  amount_paise: number;
  currency?: 'INR' | undefined;
  method: PaymentMethod;
  gateway_ref?: string | undefined;
  status?: PaymentStatus | undefined;
}

export interface UpdatePaymentDto {
  status?: PaymentStatus | undefined;
  gateway_ref?: string | undefined;
}

export interface RazorpayOrderInput {
  amount_paise: number;
  currency: 'INR';
  receipt: string;
  notes?: Record<string, string> | undefined;
}

export interface RazorpayOrderResponse {
  id: string; // "order_..."
  amount: number; // in paise
  currency: 'INR';
  receipt: string;
  status: 'created' | 'attempted' | 'paid';
  notes?: Record<string, string> | undefined;
  created_at: number;
}

export interface CreateOrderRequestDto {
  print_job_id: string;
  notes?: Record<string, string> | undefined;
  requested_amount_paise?: number | undefined; // Client-submitted amount to verify against tampering
}

export interface CreateOrderResponseDto {
  order_id: string;
  amount_paise: number;
  currency: 'INR';
  key_id: string;
  print_job_id: string;
  status: PaymentStatus;
  receipt: string;
}
