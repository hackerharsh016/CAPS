/**
 * Domain types and DTOs for CAPS Print Jobs Module.
 * Follows Master Plan §5.2, §5.5, ADR 0004, and packages/types.
 */

import type { PrintSettings, PriorityTier, PriceBreakdown } from '../pricing/pricing.types.js';

export type { PriorityTier };

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
  id: string; // UUID primary key & queue token
  shop_id: string; // UUID references Shop
  customer_id: string; // UUID references UserProfile
  printer_id?: string | undefined; // UUID references Printer
  document_id?: string | undefined;
  document_storage_key: string;
  settings: PrintSettings | Record<string, unknown>;
  priority_tier: PriorityTier;
  price_total_paise: number;
  price_breakdown: PriceBreakdown | Record<string, unknown>;
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

export type PrintJob = PrintJobRecord;

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
  settings?: PrintSettings | Record<string, unknown> | undefined;
  priority_tier?: PriorityTier | undefined;
  price_total_paise?: number | undefined;
  price_breakdown?: PriceBreakdown | Record<string, unknown> | undefined;
  document_expires_at?: string | undefined;
}

export interface CreatePrintJobDto {
  shop_id: string;
  customer_id: string;
  printer_id?: string | undefined;
  document_id?: string | undefined;
  document_storage_key: string;
  settings: Record<string, unknown>;
  priority_tier?: PriorityTier | undefined;
  price_total_paise: number;
  price_breakdown: Record<string, unknown>;
  document_expires_at?: string | undefined;
}

export interface UpdatePrintJobDto {
  status?: JobStatus | undefined;
  printer_id?: string | undefined;
  enqueued_at?: string | undefined;
  queue_position?: number | undefined;
}

export interface ListPrintJobsFilter {
  shop_id?: string | undefined;
  customer_id?: string | undefined;
  status?: JobStatus | undefined;
  priority_tier?: PriorityTier | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
