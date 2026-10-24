/**
 * Domain types for Order Review and Checkout Shell in CAPS Customer Web (P04-M05-F02).
 * Conforms to @caps/types/jobs and @caps/types/payments contracts.
 */

import type { PrintSettings } from '../print-settings/types';
import type { QuoteResponse, PriorityTier } from '../pricing/types';
import type { PrintJobStatus, PaymentStatus } from '../orders/types';

export type PaymentMethod = 'upi' | 'card' | 'wallet' | 'pay_at_counter';

export interface CheckoutOrderInput {
  quote_id: string;
  shop_id: string;
  customer_id: string;
  document_id?: string | undefined;
  document_storage_key: string;
  document_name: string;
  file_size_bytes: number;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  quote: QuoteResponse;
  payment_method: PaymentMethod;
  idempotency_key: string;
}

export interface CheckoutResult {
  order_id: string; // UUID primary key
  token_number: string; // e.g. "T-042"
  shop_id: string;
  shop_name: string;
  customer_id: string;
  document_name: string;
  status: PrintJobStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  amount_paise: number;
  payment_redirect_url?: string | undefined;
  idempotency_key: string;
  created_at: string;
  document_expires_at: string;
}

export type CheckoutErrorCode =
  | 'SHOP_CLOSED'
  | 'QUOTE_EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_PAYMENT_METHOD'
  | 'PAY_AT_COUNTER_UNAVAILABLE'
  | 'VALIDATION_FAILED'
  | 'ORDER_CREATION_FAILED'
  | 'NETWORK_ERROR';

export interface CheckoutError {
  code: CheckoutErrorCode;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export interface PaymentMethodOption {
  id: PaymentMethod;
  label: string;
  description: string;
  icon: string;
  badge?: string | undefined;
  isOnline: boolean;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
}
