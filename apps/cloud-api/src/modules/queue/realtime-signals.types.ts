/**
 * Types and DTOs for Realtime Queue Signals and Missed-Event Reconciliation.
 * Adheres to CAPS SRS §3.4, Master Plan §8.1-8.4, and ADR 0004/ADR 0005.
 *
 * Realtime messages are strictly wake-up events, NOT ownership claims.
 * A claimed job requires explicit authentication and capability verification.
 */

import type { JobStatus } from '../print-jobs/print-jobs.types.js';
import type { PriorityTier } from '../pricing/pricing.types.js';

export type QueueSignalType =
  | 'AGENT_WAKE'
  | 'JOB_STATUS_CHANGED'
  | 'QUEUE_REORDERED'
  | 'QUEUE_ETA_REFRESH';

export interface AgentWakePayload {
  signal: 'AGENT_WAKE';
  shop_id: string;
  job_id: string;
  printer_id?: string | undefined;
  priority_tier: PriorityTier;
  /**
   * Explicit architectural safeguard: Realtime messages are wake-up signals only.
   * Agent must make an authenticated RPC claim to acquire an atomic exclusive lease.
   */
  requires_claim: true;
  queued_at?: string | undefined;
  wake_timestamp: string;
}

export interface JobStatusChangedPayload {
  signal: 'JOB_STATUS_CHANGED';
  shop_id: string;
  job_id: string;
  customer_id?: string | undefined;
  from_status?: JobStatus | undefined;
  to_status: JobStatus;
  queue_position?: number | undefined;
  estimated_wait_seconds?: number | undefined;
  updated_at: string;
}

export interface QueueReorderedPayload {
  signal: 'QUEUE_REORDERED' | 'QUEUE_ETA_REFRESH';
  shop_id: string;
  total_queued: number;
  urgent_count: number;
  flexible_count: number;
  total_estimated_wait_seconds: number;
  active_printers_count: number;
  timestamp: string;
}

export type QueueSignalPayload =
  | AgentWakePayload
  | JobStatusChangedPayload
  | QueueReorderedPayload
  | Record<string, unknown>;

export interface QueueSignal {
  id: number;
  shop_id: string;
  channel: string;
  event_type: QueueSignalType;
  job_id?: string | undefined;
  customer_id?: string | undefined;
  payload: QueueSignalPayload;
  created_at: string;
}

export interface CreateQueueSignalInput {
  shop_id: string;
  channel: string;
  event_type: QueueSignalType;
  job_id?: string | undefined;
  customer_id?: string | undefined;
  payload: QueueSignalPayload;
}

export interface MissedEventReconcileRequest {
  device_id: string;
  last_event_id?: number | undefined;
  since_timestamp?: string | undefined;
  in_flight_attempt_id?: string | undefined;
  in_flight_lease_token?: string | undefined;
}

export interface ActiveLeaseSummary {
  job_id: string;
  attempt_id: string;
  lease_token: string;
  lease_expires_at: string;
  status: string;
  printer_id?: string | undefined;
  is_expired: boolean;
}

export interface MissedEventReconcileResponse {
  shop_id: string;
  device_id: string;
  latest_event_id: number;
  missed_events: QueueSignal[];
  active_lease: ActiveLeaseSummary | null;
  has_claimable_jobs: boolean;
  claimable_jobs_count: number;
  server_time: string;
}
