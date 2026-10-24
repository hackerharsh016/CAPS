/**
 * Domain types and DTOs for the CAPS Queue module.
 * Implements two-tier priority queue (urgent before flexible FIFO within tier),
 * non-preemption guarantees, dynamic position calculation, and live ETA estimation.
 */

import type { PriorityTier, PrintSettings, PriceBreakdown } from '../pricing/pricing.types.js';
import type { JobStatus, PrintJobRecord } from '../print-jobs/print-jobs.types.js';

export interface UrgentCapRejectionDetails {
  cap_type: 'hourly' | 'queue_depth' | 'fairness_guard';
  limit?: number | undefined;
  current_usage?: number | undefined;
  reset_at?: string | undefined;
  retry_after_seconds?: number | undefined;
  fallback_tier: 'flexible';
  message: string;
}

export interface UrgentCapStatus {
  shop_id: string;
  is_urgent_available: boolean;
  hourly_cap: number | null;
  hourly_usage: number;
  hourly_remaining: number | null;
  queue_cap: number | null;
  current_urgent_queued: number;
  queue_remaining: number | null;
  fairness_guard_active: boolean;
  oldest_flexible_wait_seconds: number | null;
  window_resets_at: string | null;
  retry_after_seconds: number | null;
  rejection_details: UrgentCapRejectionDetails | null;
}

export interface ConfigureUrgentPolicyRequest {
  type?: 'flat' | 'percentage' | undefined;
  amount?: number | undefined;
  max_urgent_jobs_per_hour?: number | null | undefined;
  max_urgent_jobs_in_queue?: number | null | undefined;
  fairness_guard_enabled?: boolean | undefined;
  max_flexible_wait_threshold_seconds?: number | null | undefined;
}

export interface UrgentSurchargeResult {
  shop_id: string;
  priority_tier: PriorityTier;
  base_price_paise: number;
  urgent_surcharge_paise: number;
  total_price_paise: number;
  surcharge_type: 'flat' | 'percentage' | 'none';
  surcharge_rate: number;
  urgent_available?: boolean | undefined;
  cap_status?: UrgentCapStatus | undefined;
}

export interface QueueJobSummary {
  id: string;
  shop_id: string;
  customer_id: string;
  customer_name?: string | undefined;
  customer_phone?: string | undefined;
  printer_id?: string | undefined;
  document_storage_key: string;
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
  price_breakdown?: PriceBreakdown | undefined;
  settings?: PrintSettings | undefined;
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
  urgent_available?: boolean | undefined;
  cap_rejection?: UrgentCapRejectionDetails | undefined;
}

export interface ReassignPrinterRequest {
  job_id: string;
  new_printer_id: string;
  shop_id: string;
}

export interface NextEligibleJobRequest {
  shop_id: string;
  printer_id?: string | undefined;
}

export interface NextEligibleJobResponse {
  job: PrintJobRecord | null;
}
