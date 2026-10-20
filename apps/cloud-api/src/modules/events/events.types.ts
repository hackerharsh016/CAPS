import type { JobStatus } from '../print-jobs/print-jobs.types.js';

export type ActorType = 'customer' | 'owner' | 'agent' | 'system';

export interface JobEvent {
  id: number;
  job_id: string; // UUID
  attempt_id?: string | undefined; // UUID
  actor_type: ActorType;
  actor_id?: string | undefined; // UUID
  from_status?: JobStatus | undefined;
  to_status: JobStatus;
  event_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreateJobEventDto {
  job_id: string;
  attempt_id?: string | undefined;
  actor_type: ActorType;
  actor_id?: string | undefined;
  from_status?: JobStatus | undefined;
  to_status: JobStatus;
  event_name: string;
  metadata?: Record<string, unknown> | undefined;
}

export type DocumentDeletedBy = 'agent_post_spool' | 'cloud_ttl_sweeper' | 'admin_intervention';
export type DocumentDeletionReason =
  'print_completed' | 'retention_expired' | 'job_cancelled' | 'manual_purge';

export interface DocumentDeletionLog {
  id: string;
  job_id?: string | undefined;
  document_id?: string | undefined;
  document_storage_key: string;
  deleted_by: DocumentDeletedBy;
  reason: DocumentDeletionReason;
  deleted_at: string;
}

export interface CreateDocumentDeletionLogDto {
  job_id?: string | undefined;
  document_id?: string | undefined;
  document_storage_key: string;
  deleted_by: DocumentDeletedBy;
  reason: DocumentDeletionReason;
}
