/**
 * Payment processing and settlement domain types for CAPS.
 */

export type PaymentMethod = 'upi' | 'card' | 'wallet' | 'pay_at_counter';

export type PaymentStatus = 'initiated' | 'success' | 'failed' | 'refunded';

export interface PaymentRecord {
  id: string; // UUID
  print_job_id: string; // UUID references PrintJob
  amount_paise: number;
  currency: 'INR';
  method: PaymentMethod;
  gateway_ref?: string; // Razorpay payment_id or order_id
  status: PaymentStatus;
  created_at: string;
  updated_at?: string;
}
