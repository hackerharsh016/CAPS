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
