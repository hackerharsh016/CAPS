/**
 * Live Queue Domain Types & Realtime Event Definitions for CAPS Owner Dashboard.
 * Aligned with CAPS SRS UC-3, Section 4.2 & Master Plan §4, §5.4.
 */

export type PriorityTier = 'urgent' | 'flexible';

export type JobStatus =
  | 'pending_payment'
  | 'queued'
  | 'approved'
  | 'claimed'
  | 'downloading'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'requires_review';

export interface PrintSettings {
  paper_size: 'A4' | 'A3' | 'Legal';
  color_mode: 'bw' | 'color';
  sides: 'single' | 'double';
  orientation: 'portrait' | 'landscape';
  copies: number;
  page_range: string;
  binding: 'none' | 'spiral' | 'staple' | 'lamination';
}

export interface PriceBreakdown {
  base_pages_paise: number;
  color_surcharge_paise: number;
  duplex_discount_paise: number;
  binding_fee_paise: number;
  urgent_surcharge_paise: number;
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
}

export interface PrintJob {
  id: string; // UUID primary key & queue token
  shop_id: string; // UUID references Shop
  customer_id: string; // UUID references UserProfile
  printer_id?: string | undefined;
  document_storage_key: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  price_total_paise: number;
  price_breakdown: PriceBreakdown;
  status: JobStatus;
  queue_position?: number | undefined;
  enqueued_at?: string | undefined;
  document_expires_at?: string | undefined;
  created_at: string;
  updated_at: string;
}

export type PaymentDisplayStatus = 'paid' | 'pay_at_counter_pending' | 'settled';

export interface QueueItem {
  id: string; // PrintJob UUID
  shop_id: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string | undefined;
  printer_id?: string | undefined;
  printer_name?: string | undefined;
  document_name?: string | undefined;
  document_storage_key: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  price_total_paise: number;
  price_breakdown: PriceBreakdown;
  status: JobStatus;
  payment_status: PaymentDisplayStatus;
  queue_position: number;
  is_currently_executing: boolean;
  estimated_wait_minutes: number;
  enqueued_at: string;
  created_at: string;
  updated_at: string;
}

export type QueueFilter = 'all' | 'urgent' | 'flexible' | 'executing';

export type RealtimeConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'fallback_polling';

export interface QueueSummaryMetrics {
  pendingCount: number;
  urgentCount: number;
  flexibleCount: number;
  executingCount: number;
  totalEstimatedWaitMinutes: number;
  todayCompletedCount: number;
  todayRevenuePaise: number;
}

export interface RealtimeQueueEvent {
  event_id: string;
  event_type: 'JOB_ENQUEUED' | 'JOB_UPDATED' | 'JOB_CLAIMED' | 'JOB_COMPLETED' | 'JOB_CANCELLED';
  job_id: string;
  shop_id: string;
  sequence: number;
  timestamp: string;
  payload?: Partial<QueueItem> | undefined;
}

export type QueueEventListener = (event: RealtimeQueueEvent) => void;
export type ConnectionStateListener = (state: RealtimeConnectionState) => void;
