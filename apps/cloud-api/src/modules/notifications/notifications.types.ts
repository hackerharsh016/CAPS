export type LifecycleEventType =
  'job_queued' | 'job_printing' | 'job_ready' | 'job_failed' | 'job_cancelled';

export interface UserFcmToken {
  id: string;
  user_id: string;
  device_token: string;
  device_type: 'web' | 'android' | 'ios';
  is_active: boolean;
  created_at: string;
  last_used_at?: string | undefined;
}

export interface RegisterTokenDto {
  user_id: string;
  device_token: string;
  device_type?: 'web' | 'android' | 'ios' | undefined;
}

export type OutboxStatus = 'pending' | 'delivered' | 'failed' | 'duplicate_skipped' | 'revoked';

export interface NotificationOutboxEntry {
  id: string;
  dedupe_key: string;
  job_id: string;
  user_id: string;
  event_type: LifecycleEventType;
  title: string;
  body: string;
  data: Record<string, string>;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  last_error?: string | undefined;
  delivered_at?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface CreateOutboxEntryDto {
  dedupe_key: string;
  job_id: string;
  user_id: string;
  event_type: LifecycleEventType;
  title: string;
  body: string;
  data: Record<string, string>;
  max_attempts?: number | undefined;
}

export interface DispatchNotificationResult {
  outbox_id: string;
  dedupe_key: string;
  status: OutboxStatus;
  dispatched_tokens_count: number;
  revoked_tokens_count: number;
  skipped_as_duplicate?: boolean | undefined;
}
