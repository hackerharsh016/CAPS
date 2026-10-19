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
  | 'UPLOAD_FAILED';

export interface UploadValidationError {
  code: UploadErrorCode;
  message: string;
  details?: string | undefined;
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
}

export interface UploadState {
  status: UploadStatus;
  file: File | null;
  progress: UploadProgressEvent | null;
  uploadedDoc: UploadedDocumentMetadata | null;
  error: UploadValidationError | null;
}
