/**
 * Domain types, DTOs, and schemas for CAPS Private Document Upload & Lifecycle.
 * Follows Master Plan §5.5, ADR 0007, and docs/architecture/privacy-lifecycle.md.
 */

export const ALLOWED_DOCUMENT_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
  'application/vnd.ms-powerpoint', // ppt
  'image/jpeg',
  'image/png'
] as const;

export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

export type AllowedMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | AllowedDocumentMime;

export const ALLOWED_MIME_TYPES = ALLOWED_DOCUMENT_MIMES;

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_DOCUMENT_FILE_SIZE_BYTES = MAX_DOCUMENT_SIZE_BYTES;
export const MAX_DECOMPRESSED_RATIO = 100; // Zip bomb mitigation
export const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB max uncompressed
export const DEFAULT_CONVERSION_TIMEOUT_MS = 15000; // 15 seconds
export const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes (900s)
export const DOWNLOAD_URL_EXPIRY_SECONDS = 300; // 5 minutes (300s)

export type DocumentStatus =
  | 'upload_pending'
  | 'converting'
  | 'ready'
  | 'processing'
  | 'failed'
  | 'purged';

export interface PageDimensions {
  width_pt: number;
  height_pt: number;
  format: 'A4' | 'A3' | 'Legal' | 'Custom';
}

export interface ConversionMetadata {
  source_format: string;
  target_format: 'pdf';
  duration_ms: number;
  page_count: number;
  dimensions: PageDimensions;
  has_color: boolean;
  warnings?: string[] | undefined;
  converted_at: string;
}

export interface DocumentMetadata {
  id: string;
  customer_id: string;
  file_name: string;
  mime_type: AllowedDocumentMime | string;
  file_size_bytes: number;
  storage_key: string;
  converted_storage_key?: string | undefined;
  status: DocumentStatus;
  page_count?: number | undefined;
  checksum_sha256?: string | undefined;
  converted_checksum_sha256?: string | undefined;
  conversion_metadata?: ConversionMetadata | undefined;
  expires_at: string;
  created_at: string;
  updated_at?: string | undefined;
  purged_at?: string | undefined;
}

export interface CreateUploadIntentDto {
  file_name: string;
  mime_type: AllowedDocumentMime | string;
  file_size_bytes: number;
}

export interface CreateUploadIntentInput {
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  page_count?: number | undefined;
}

export interface UploadIntentResponseDto {
  document_id: string;
  storage_key: string;
  upload_url: string;
  upload_token: string;
  expires_at: string;
  max_size_bytes: number;
  allowed_mimes: readonly string[];
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

export interface ConvertDocumentRequestDto {
  document_id: string;
  timeout_ms?: number | undefined;
}

export interface ConversionResult {
  document_id: string;
  pdf_buffer: Buffer;
  converted_storage_key: string;
  checksum_sha256: string;
  page_count: number;
  dimensions: PageDimensions;
  has_color: boolean;
  duration_ms: number;
}

export interface DownloadUrlResponseDto {
  document_id: string;
  download_url: string;
  expires_at: string;
  checksum_sha256?: string | undefined;
  content_type: string;
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
