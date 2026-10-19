/**
 * Customer Order History domain types for CAPS.
 * Conforms to CAPS SRS Section 4.1, 7.4 and Master Implementation Plan Section 5 & 7.
 */

export type PrintJobStatus =
  | 'draft'
  | 'pending_payment'
  | 'queued'
  | 'approved'
  | 'claimed'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'paid' | 'pay_at_counter' | 'failed' | 'refunded';

export type PriorityTier = 'urgent' | 'flexible';

export interface OrderSettings {
  paper_size: 'A4' | 'A3' | 'Legal' | 'Letter';
  color_mode: 'bw' | 'color';
  duplex: boolean;
  copies: number;
  orientation: 'portrait' | 'landscape';
  page_range?: string | undefined;
  pages_per_copy: number;
  total_pages: number;
  spiral_binding: boolean;
}

export interface CustomerOrder {
  id: string; // UUID
  token_number: string; // e.g. "T-024"
  customer_id: string;
  shop_id: string;
  shop_name: string;
  document_name: string;
  file_size_bytes: number;
  settings: OrderSettings;
  priority_tier: PriorityTier;
  amount_paise: number; // e.g. 4500 = ₹45.00
  status: PrintJobStatus;
  payment_status: PaymentStatus;
  document_deleted: boolean; // Privacy guarantee: file destroyed after print
  document_expires_at?: string | undefined;
  created_at: string;
  completed_at?: string | undefined;
}

export type OrderFilterStatus = 'all' | 'active' | 'completed' | 'cancelled';

export interface OrderHistoryQuery {
  customerId: string;
  page?: number | undefined;
  limit?: number | undefined;
  filter?: OrderFilterStatus | undefined;
}

export interface OrderHistoryResponse {
  orders: CustomerOrder[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}
