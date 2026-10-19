/**
 * Document Upload domain types for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.2 & Master Implementation Plan Section 3 & 4.
 */

export type SupportedMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'text/plain';

export type SupportedExtension =
  | '.pdf'
  | '.jpg'
  | '.jpeg'
  | '.png'
  | '.docx'
  | '.pptx'
  | '.txt';

export type UploadStatus =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'success'
  | 'error'
  | 'aborted';

export type UploadErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'UPLOAD_FAILED'
  | 'EXPIRED_UPLOAD_LINK'
  | 'INVALID_CONTENT'
  | 'CROSS_USER_FORBIDDEN'
  | 'ORPHAN_CLEANUP_FAILED';

export interface UploadValidationError {
  code: UploadErrorCode;
  message: string;
  details?: string | undefined;
}

export interface CreateUploadIntentRequest {
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  targetShopId?: string | undefined;
}

export interface CreateUploadIntentResponse {
  documentId: string;
  uploadUrl: string;
  storagePath: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
}

export interface FinalizeDocumentRequest {
  sha256Checksum: string;
  actualSizeBytes: number;
}

export interface FinalizedDocumentResponse {
  documentId: string;
  status: 'uploaded' | 'ready_for_conversion';
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  storagePath: string;
  sha256Checksum: string;
  finalizedAt: string;
}


export interface UploadProgressEvent {
  loadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export interface UploadedDocumentMetadata {
  id: string; // client document reference ID
  name: string;
  sizeBytes: number;
  mimeType: string;
  extension: string;
  uploadedAt: string;
  storagePath?: string | undefined;
}

export interface UploadOptions {
  onProgress?: ((progress: UploadProgressEvent) => void) | undefined;
  signal?: AbortSignal | undefined;
  targetShopId?: string | undefined;
  customerId?: string | undefined;
}


export interface UploadState {
  status: UploadStatus;
  file: File | null;
  progress: UploadProgressEvent | null;
  uploadedDoc: UploadedDocumentMetadata | null;
  error: UploadValidationError | null;
}

export type ConversionStatus =
  | 'not_required'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface DocumentPagePreview {
  pageNumber: number;
  width: number;
  height: number;
  thumbnailUrl?: string | undefined;
}

export interface DocumentPreviewData {
  documentId: string;
  fileName: string;
  pageCount: number;
  conversionStatus: ConversionStatus;
  conversionError?: string | null | undefined;
  isPasswordProtected: boolean;
  isCorrupted: boolean;
  pages: DocumentPagePreview[];
}

