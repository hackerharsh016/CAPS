/**
 * Queue Tracking and Job Status domain types for CAPS Customer Web (P04-M06-F01).
 * Conforms to CAPS SRS Section 4.1, 7.4 and Master Plan Module 06.
 */

import type { OrderSettings, PriorityTier } from '../orders/types';

export type DisplayJobStatus =
  | 'submitted'
  | 'pending_payment'
  | 'queued'
  | 'approved'
  | 'claimed'
  | 'printing'
  | 'ready'
  | 'unknown'
  | 'failed'
  | 'cancelled';

export type AgentConnectionStatus = 'online' | 'degraded' | 'offline';

export interface JobTrackingInfo {
  job_id: string;
  token_number: string;
  customer_id: string;
  shop_id: string;
  shop_name: string;
  shop_address?: string | undefined;
  shop_phone?: string | undefined;
  document_name: string;
  file_size_bytes: number;
  settings: OrderSettings;
  priority_tier: PriorityTier;
  status: DisplayJobStatus;
  raw_status: string;
  status_label: string;
  status_explanation: string;
  next_step_instruction: string;
  queue_position: number | null; // e.g. 1 = next in line; null when printing/ready/cancelled
  queue_total_in_tier: number;
  estimated_pickup_at: string | null; // ISO timestamp
  estimated_minutes_remaining: number | null;
  agent_status: AgentConnectionStatus;
  is_agent_offline: boolean;
  document_expires_at: string;
  document_deleted: boolean;
  amount_paise: number;
  payment_status: string;
  created_at: string;
  updated_at: string;
}

export type TrackingErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'AGENT_OFFLINE'
  | 'UNKNOWN_STATE'
  | 'NETWORK_ERROR';

export interface TrackingError {
  code: TrackingErrorCode;
  message: string;
  details?: Record<string, unknown> | undefined;
}
