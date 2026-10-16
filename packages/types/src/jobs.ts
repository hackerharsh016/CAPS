/**
 * Print job lifecycle and two-tier queue domain types for CAPS.
 */

import { PriceBreakdown } from './pricing.js';
import { PrintSettings } from './settings.js';

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

export interface PrintJob {
  id: string; // UUID primary key & queue token
  shop_id: string; // UUID references Shop
  customer_id: string; // UUID references UserProfile
  printer_id?: string; // UUID references Printer
  document_storage_key: string; // Path in private encrypted S3/Supabase storage
  settings: PrintSettings;
  priority_tier: PriorityTier;
  price_total_paise: number;
  price_breakdown: PriceBreakdown;
  status: JobStatus;
  queue_position?: number; // Computed dynamically, never a raw authoritative column
  enqueued_at?: string; // Timestamp when job entered 'queued' state
  document_expires_at: string; // Strict auto-delete deadline (e.g. 24h)
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  id: number;
  job_id: string;
  actor_id?: string;
  actor_type: 'customer' | 'owner' | 'agent' | 'system';
  from_status?: JobStatus;
  to_status: JobStatus;
  metadata?: Record<string, unknown>;
  created_at: string;
}
