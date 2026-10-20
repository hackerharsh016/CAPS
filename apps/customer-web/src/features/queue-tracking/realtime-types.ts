/**
 * Realtime Job Tracking Domain Types for CAPS Customer Web (P04-M06-F02).
 * Conforms to Master Plan Module 06 and Non-Negotiable Policy #5.
 */

export type RealtimeConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'polling';

export interface RealtimeJobEvent {
  job_id: string;
  customer_id: string;
  shop_id: string;
  event_type: 'status_changed' | 'queue_updated' | 'agent_heartbeat' | 'wake_up';
  status?: string | undefined;
  timestamp: string; // ISO 8601
  sequence_number?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface RealtimeSubscriptionOptions {
  jobId: string;
  customerId: string;
  enableFallbackPolling?: boolean | undefined;
  pollingIntervalMs?: number | undefined;
  reconnectDelayMs?: number | undefined;
}

export type RealtimeEventListener = (event: RealtimeJobEvent) => void;
export type ConnectionStateListener = (state: RealtimeConnectionState) => void;
export type ErrorListener = (error: Error) => void;
