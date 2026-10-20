/**
 * Types and DTOs for CAPS Document Management & Trusted PDF Conversion.
 * Conforms to CAPS SRS §2.2, FR-1.3, FR-1.4, and Master Plan §5.5 & §12.
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

export const MAX_DOCUMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_DECOMPRESSED_RATIO = 100; // Zip bomb mitigation
export const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB max uncompressed
export const DEFAULT_CONVERSION_TIMEOUT_MS = 15000; // 15 seconds

export type DocumentStatus =
  | 'upload_pending'
  | 'converting'
  | 'ready'
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
  updated_at: string;
}

export interface CreateUploadIntentDto {
  file_name: string;
  mime_type: AllowedDocumentMime | string;
  file_size_bytes: number;
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
