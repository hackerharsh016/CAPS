/**
 * Domain types and DTOs for CAPS Print Jobs Module.
 * Follows Master Plan §5.2, §5.5, ADR 0004, and packages/types.
 */

import type { PrintSettings, PriorityTier, PriceBreakdown } from '../pricing/pricing.types.js';

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

export interface PrintJobRecord {
  id: string; // UUID
  shop_id: string; // UUID
  customer_id: string; // UUID
  printer_id?: string | undefined;
  document_id?: string | undefined;
  document_storage_key: string;
  settings: PrintSettings;
  priority_tier: PriorityTier;
  price_total_paise: number;
  price_breakdown: PriceBreakdown;
  status: JobStatus;
  idempotency_key?: string | undefined;
  queue_position?: number | undefined;
  enqueued_at?: string | undefined;
  claimed_at?: string | undefined;
  claimed_by_agent_id?: string | undefined;
  completed_at?: string | undefined;
  failed_reason?: string | undefined;
  document_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface JobEventRecord {
  id: string;
  job_id: string;
  actor_id?: string | undefined;
  actor_type: 'customer' | 'owner' | 'agent' | 'system';
  from_status?: JobStatus | undefined;
  to_status: JobStatus;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  created_at: string;
}

export interface CreatePrintJobInput {
  shop_id: string;
  quote_id?: string | undefined;
  document_id?: string | undefined;
  document_storage_key?: string | undefined;
  printer_id?: string | undefined;
  settings?: PrintSettings | undefined;
  priority_tier?: PriorityTier | undefined;
}

export interface ListPrintJobsFilter {
  shop_id?: string | undefined;
  customer_id?: string | undefined;
  status?: JobStatus | undefined;
  priority_tier?: PriorityTier | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
