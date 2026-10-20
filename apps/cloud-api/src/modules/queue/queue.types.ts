import type { PriorityTier, JobStatus } from '../print-jobs/print-jobs.types.js';

export interface UrgentSurchargeResult {
  shop_id: string;
  priority_tier: PriorityTier;
  base_price_paise: number;
  urgent_surcharge_paise: number;
  total_price_paise: number;
  surcharge_type: 'flat' | 'percentage' | 'none';
  surcharge_rate: number;
}

export interface QueueJobSummary {
  id: string;
  shop_id: string;
  customer_id: string;
  printer_id?: string | undefined;
  priority_tier: PriorityTier;
  status: JobStatus;
  queue_position: number;
  enqueued_at: string;
  pages: number;
  copies: number;
  color_mode: string;
  duplex: boolean;
  binding: string;
  estimated_print_duration_seconds: number;
  estimated_wait_seconds: number;
  projected_completion_time: string;
  price_total_paise: number;
}

export interface CustomerRedactedQueueJob {
  id: string;
  priority_tier: PriorityTier;
  status: JobStatus;
  queue_position: number;
  estimated_wait_seconds: number;
  projected_completion_time: string;
  is_caller_job: boolean;
  pages?: number | undefined;
  copies?: number | undefined;
  color_mode?: string | undefined;
  duplex?: boolean | undefined;
  binding?: string | undefined;
  price_total_paise?: number | undefined;
}

export interface ShopQueueResponse {
  shop_id: string;
  currently_printing: QueueJobSummary | CustomerRedactedQueueJob | null;
  queue: Array<QueueJobSummary | CustomerRedactedQueueJob>;
  urgent_count: number;
  flexible_count: number;
  total_queued: number;
  total_estimated_wait_seconds: number;
  active_printers_count: number;
  generated_at: string;
}

export interface LiveEtaRequest {
  shop_id: string;
  pages: number;
  copies?: number | undefined;
  color_mode?: 'bw' | 'color' | undefined;
  duplex?: boolean | undefined;
  binding?: 'none' | 'spiral' | 'staple' | 'lamination' | undefined;
  priority_tier: PriorityTier;
  printer_id?: string | undefined;
}

export interface LiveEtaResponse {
  shop_id: string;
  priority_tier: PriorityTier;
  projected_queue_position: number;
  estimated_wait_seconds: number;
  estimated_print_duration_seconds: number;
  projected_start_time: string;
  projected_completion_time: string;
  ahead_urgent_jobs: number;
  ahead_flexible_jobs: number;
  is_currently_printing_ahead: boolean;
}

export interface ReassignPrinterRequest {
  job_id: string;
  new_printer_id: string;
  shop_id: string;
}
