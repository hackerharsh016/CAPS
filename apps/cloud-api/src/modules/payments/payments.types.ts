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
  method?: PaymentMethod | undefined;
  amount_paise?: number | undefined;
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

export interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  status: 'captured' | 'failed' | 'authorized';
  method?: PaymentMethod | undefined;
  error_code?: string | undefined;
  error_description?: string | undefined;
  notes?: Record<string, string> | undefined;
}

export interface RazorpayOrderEntity {
  id: string;
  amount: number;
  amount_paid: number;
  status: 'created' | 'attempted' | 'paid';
  notes?: Record<string, string> | undefined;
}

export interface RazorpayWebhookPayload {
  entity: 'event';
  account_id?: string | undefined;
  event: 'payment.captured' | 'payment.failed' | 'order.paid' | string;
  contains?: string[] | undefined;
  payload: {
    payment?:
      | {
          entity: RazorpayPaymentEntity;
        }
      | undefined;
    order?:
      | {
          entity: RazorpayOrderEntity;
        }
      | undefined;
  };
  created_at?: number | undefined;
}

export interface WebhookProcessingResult {
  success: boolean;
  status: 'processed' | 'already_processed' | 'ignored_out_of_order' | 'payment_failed_recorded';
  job_id?: string | undefined;
  order_id?: string | undefined;
  payment_id?: string | undefined;
  message?: string | undefined;
}

export interface ReconcilePaymentRequestDto {
  print_job_id?: string | undefined;
  order_id?: string | undefined;
}

export interface ReconcilePaymentResponseDto {
  success: boolean;
  print_job_id: string;
  payment_status: PaymentStatus;
  job_status: string;
  reconciled: boolean;
  order_id?: string | undefined;
}

export interface SelectPayAtCounterDto {
  print_job_id: string;
}

export interface SelectPayAtCounterResponseDto {
  success: boolean;
  print_job_id: string;
  payment_id: string;
  amount_paise: number;
  method: 'pay_at_counter';
  status: 'initiated';
  message: string;
}

export interface ConfirmCashSettlementDto {
  print_job_id: string;
  operator_id: string; // Authenticated shop owner / operator ID
  received_amount_paise?: number | undefined;
  receipt_number?: string | undefined;
  notes?: string | undefined;
}

export interface ConfirmCashSettlementResponseDto {
  success: boolean;
  print_job_id: string;
  payment_id: string;
  amount_paise: number;
  status: 'success';
  method: 'pay_at_counter';
  settled_by: string;
  receipt_ref: string;
  job_status: 'queued';
  settled_at: string;
}

export interface CashSettlementItem {
  payment_id: string;
  job_id: string;
  amount_paise: number;
  receipt_ref: string;
  settled_at: string;
}

export interface GatewaySettlementItem {
  payment_id: string;
  job_id: string;
  method: PaymentMethod;
  amount_paise: number;
  gateway_ref: string;
  settled_at: string;
}

export interface ShopPaymentReportDto {
  shop_id: string;
  period: string;
  total_revenue_paise: number;
  total_transactions_count: number;
  cash_settlement: {
    total_paise: number;
    transaction_count: number;
    items: CashSettlementItem[];
  };
  gateway_settlement: {
    total_paise: number;
    transaction_count: number;
    by_method: Record<string, number>;
    items: GatewaySettlementItem[];
  };
}
