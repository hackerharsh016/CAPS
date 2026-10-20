/**
 * Domain types, DTOs, and schemas for CAPS Private Document Upload & Lifecycle.
 * Follows Master Plan §5.5, ADR 0007, and docs/architecture/privacy-lifecycle.md.
 */

export type AllowedMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg';

export const ALLOWED_MIME_TYPES: readonly AllowedMimeType[] = [
  'application/pdf',
  'image/png',
  'image/jpeg'
] as const;

export const MAX_DOCUMENT_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes (900s)
export const DOWNLOAD_URL_EXPIRY_SECONDS = 300; // 5 minutes (300s) per Master Plan §5.5 & ADR 0007

export type DocumentStatus =
  | 'upload_pending'
  | 'ready'
  | 'processing'
  | 'failed'
  | 'purged';

export interface DocumentMetadata {
  id: string;
  customer_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  page_count?: number | undefined;
  storage_key: string;
  checksum_sha256?: string | undefined;
  status: DocumentStatus;
  created_at: string;
  expires_at: string;
  purged_at?: string | undefined;
}

export interface CreateUploadIntentInput {
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  page_count?: number | undefined;
}

export interface UploadIntentResult {
  document_id: string;
  storage_key: string;
  upload_url: string;
  upload_token: string;
  expires_at: string;
  expires_in_seconds: number;
  max_size_bytes: number;
  allowed_mime_types: readonly string[];
}

export interface FinalizeUploadInput {
  checksum_sha256?: string | undefined;
  page_count?: number | undefined;
}

export interface DownloadUrlResult {
  document_id: string;
  download_url: string;
  expires_at: string;
  expires_in_seconds: number;
}

export type DeletionReason =
  | 'print_completed'
  | 'retention_expired'
  | 'job_cancelled'
  | 'manual_purge';

export type DeletedByType =
  | 'agent_post_spool'
  | 'cloud_ttl_sweeper'
  | 'admin_intervention';

export interface DocumentDeletionLog {
  id: string;
  job_id: string;
  document_storage_key: string;
  deleted_by: DeletedByType;
  reason: DeletionReason;
  deleted_at: string;
}

export interface PrivacyCleanupResult {
  swept_at: string;
  processed_jobs_count: number;
  deleted_objects_count: number;
  deleted_keys: string[];
  deletion_logs: DocumentDeletionLog[];
  errors: Array<{ job_id: string; storage_key: string; error: string }>;
}
