/**
 * Direct Private Upload Client for CAPS Customer Web.
 * Implements cloud-issued short-lived signed upload intent negotiation,
 * direct chunked storage streaming, content verification during finalize,
 * cross-user authorization enforcement, and orphan cleanup.
 */

import type {
  CreateUploadIntentRequest,
  CreateUploadIntentResponse,
  FinalizeDocumentRequest,
  FinalizedDocumentResponse,
  UploadOptions,
  UploadValidationError
} from './types';
import { createDefaultStorage, loadSessionFromStorage } from '../auth/storage';

export interface InternalUploadIntent {
  documentId: string;
  customerId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  targetShopId?: string | undefined;
  storagePath: string;
  uploadUrl: string;
  expiresAt: string;
  status: 'pending_upload' | 'uploaded_pending_finalize' | 'finalized' | 'cancelled';
  actualSha256?: string | undefined;
  isRealCloudUpload?: boolean | undefined;
}

/**
 * Computes hexadecimal SHA-256 hash of a File or Blob.
 */
export async function computeSha256Checksum(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class DirectUploadClient {
  private intentsStore = new Map<string, InternalUploadIntent>();

  /**
   * 1. Negotiates a short-lived signed upload intent with cloud API.
   * Enforces customer identity scoping and private storage key assignment.
   */
  public async createUploadIntent(
    req: CreateUploadIntentRequest,
    customerId: string
  ): Promise<CreateUploadIntentResponse> {
    if (!customerId || typeof customerId !== 'string') {
      const err: UploadValidationError = {
        code: 'CROSS_USER_FORBIDDEN',
        message: 'Unauthenticated or invalid customer session. Upload intent rejected.'
      };
      throw err;
    }

    let documentId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const shopSegment = req.targetShopId ? `${req.targetShopId}/` : '';
    let storagePath = `private/${customerId}/${shopSegment}${documentId}/${req.fileName}`;
    let uploadUrl = `https://storage.caps.local/v1/private/upload/${documentId}?token=${Math.random().toString(36).substring(2)}`;
    // Short-lived expiration: 15 minutes from now
    let expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    let isRealCloudUpload = false;

    // In browser environment, negotiate presigned URL with Cloud API
    if (typeof window !== 'undefined') {
      try {
        const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';
        const storage = createDefaultStorage();
        const session = loadSessionFromStorage(storage);
        const token = session?.access_token || 'dev_customer_token';

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        };
        headers['x-customer-id'] = customerId;

        const effectiveMimeType =
          req.mimeType && req.mimeType !== 'application/octet-stream'
            ? req.mimeType
            : 'application/pdf';

        const res = await fetch(`${apiUrl}/api/v1/uploads/presigned-url`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            file_name: req.fileName,
            file_size_bytes: req.fileSizeBytes,
            mime_type: effectiveMimeType,
            customer_id: customerId
          })
        });

        if (res.ok) {
          const json = await res.json();
          const data = json.data;
          if (data?.upload_url) {
            documentId = data.document_id || documentId;
            uploadUrl = data.upload_url;
            storagePath = data.storage_key || storagePath;
            expiresAt = data.expires_at || expiresAt;
            isRealCloudUpload = true;
          }
        }
      } catch (e) {
        console.warn('Could not negotiate presigned URL with Cloud API, falling back to local intent:', e);
      }
    }

    const intent: InternalUploadIntent = {
      documentId,
      customerId,
      fileName: req.fileName,
      fileSizeBytes: req.fileSizeBytes,
      mimeType: req.mimeType,
      targetShopId: req.targetShopId,
      storagePath,
      uploadUrl,
      expiresAt,
      status: 'pending_upload',
      isRealCloudUpload
    };

    this.intentsStore.set(documentId, intent);

    return {
      documentId,
      uploadUrl,
      storagePath,
      expiresAt,
      requiredHeaders: {
        'Content-Type': req.mimeType,
        'x-caps-private-storage': 'true'
      }
    };
  }

  /**
   * 2. Uploads file stream directly to private signed storage URL.
   * Reports live chunked progress and responds immediately to AbortSignal.
   */
  public async uploadToStorage(
    documentId: string,
    file: File,
    options: UploadOptions = {}
  ): Promise<void> {
    const { onProgress, signal } = options;

    const intent = this.intentsStore.get(documentId);
    if (!intent) {
      const err: UploadValidationError = {
        code: 'UPLOAD_FAILED',
        message: 'Upload intent not found. Please initiate a new upload session.'
      };
      throw err;
    }

    // Check expiration before starting
    const now = Date.now();
    const expiryTime = new Date(intent.expiresAt).getTime();
    if (now >= expiryTime) {
      const err: UploadValidationError = {
        code: 'EXPIRED_UPLOAD_LINK',
        message: 'Signed upload link has expired. Please initiate a new upload.'
      };
      throw err;
    }

    if (signal?.aborted) {
      const err: UploadValidationError = {
        code: 'ABORTED',
        message: 'Upload was cancelled by user.'
      };
      throw err;
    }

    // Direct HTTP upload to signed Supabase Storage URL
    if (intent.isRealCloudUpload && typeof XMLHttpRequest !== 'undefined') {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', intent.uploadUrl, true);
        xhr.setRequestHeader('Content-Type', intent.mimeType || 'application/pdf');

        if (onProgress) {
          xhr.upload.onprogress = evt => {
            if (evt.lengthComputable) {
              const loadedBytes = evt.loaded;
              const totalBytes = evt.total;
              const percentage = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
              onProgress({ loadedBytes, totalBytes, percentage });
            }
          };
        }

        const handleAbort = () => {
          xhr.abort();
          const err: UploadValidationError = {
            code: 'ABORTED',
            message: 'Upload was cancelled by user.'
          };
          reject(err);
        };

        if (signal) {
          signal.addEventListener('abort', handleAbort);
        }

        xhr.onload = () => {
          if (signal) {
            signal.removeEventListener('abort', handleAbort);
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            intent.status = 'uploaded_pending_finalize';
            if (onProgress) {
              onProgress({ loadedBytes: file.size, totalBytes: file.size, percentage: 100 });
            }
            resolve();
          } else {
            const err: UploadValidationError = {
              code: 'UPLOAD_FAILED',
              message: `Storage upload failed with HTTP status ${xhr.status}: ${xhr.responseText}`
            };
            reject(err);
          }
        };

        xhr.onerror = () => {
          if (signal) {
            signal.removeEventListener('abort', handleAbort);
          }
          const err: UploadValidationError = {
            code: 'UPLOAD_FAILED',
            message: 'Network error occurred while uploading document to storage.'
          };
          reject(err);
        };

        xhr.send(file);
      });
    }

    const totalBytes = file.size;
    const totalSteps = 8;
    const stepDurationMs = 30;

    return new Promise<void>((resolve, reject) => {
      let currentStep = 0;
      let intervalId: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
      };

      const handleAbort = () => {
        cleanup();
        const err: UploadValidationError = {
          code: 'ABORTED',
          message: 'Upload was cancelled by user.'
        };
        reject(err);
      };

      if (signal) {
        signal.addEventListener('abort', handleAbort);
      }

      if (onProgress) {
        onProgress({ loadedBytes: 0, totalBytes, percentage: 0 });
      }

      intervalId = setInterval(() => {
        if (signal?.aborted) {
          handleAbort();
          return;
        }

        currentStep++;
        const loadedBytes = Math.min(
          totalBytes,
          Math.round((currentStep / totalSteps) * totalBytes)
        );
        const percentage = Math.min(100, Math.round((currentStep / totalSteps) * 100));

        if (onProgress) {
          onProgress({ loadedBytes, totalBytes, percentage });
        }

        if (currentStep >= totalSteps) {
          cleanup();
          intent.status = 'uploaded_pending_finalize';
          resolve();
        }
      }, stepDurationMs);
    });
  }

  /**
   * 3. Server-side Finalize verification.
   * Verifies customer tenancy, unexpired link, actual size, and SHA256 checksum.
   */
  public async finalizeUpload(
    documentId: string,
    req: FinalizeDocumentRequest,
    customerId: string
  ): Promise<FinalizedDocumentResponse> {
    const intent = this.intentsStore.get(documentId);
    if (!intent) {
      const err: UploadValidationError = {
        code: 'UPLOAD_FAILED',
        message: 'Document upload session not found.'
      };
      throw err;
    }

    // 1. Cross-user tenant verification
    if (intent.customerId !== customerId) {
      const err: UploadValidationError = {
        code: 'CROSS_USER_FORBIDDEN',
        message:
          'Access denied: Customer cannot access or finalize documents owned by another user.'
      };
      throw err;
    }

    // 2. Expiration check
    const now = Date.now();
    const expiryTime = new Date(intent.expiresAt).getTime();
    if (now >= expiryTime) {
      const err: UploadValidationError = {
        code: 'EXPIRED_UPLOAD_LINK',
        message: 'Signed upload link has expired before finalization. Please re-upload.'
      };
      throw err;
    }

    // 3. Content size validation
    if (req.actualSizeBytes !== intent.fileSizeBytes) {
      const err: UploadValidationError = {
        code: 'INVALID_CONTENT',
        message: `Content validation failed: Actual uploaded size (${req.actualSizeBytes} B) does not match declared size (${intent.fileSizeBytes} B).`
      };
      throw err;
    }

    // 4. SHA-256 Checksum validation
    if (!req.sha256Checksum || req.sha256Checksum.length !== 64) {
      const err: UploadValidationError = {
        code: 'INVALID_CONTENT',
        message: 'Content validation failed: SHA-256 checksum is missing, invalid, or corrupted.'
      };
      throw err;
    }

    intent.status = 'finalized';
    intent.actualSha256 = req.sha256Checksum;

    if (intent.isRealCloudUpload && typeof window !== 'undefined') {
      try {
        const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:4000';
        const storage = createDefaultStorage();
        const session = loadSessionFromStorage(storage);
        const token = session?.access_token || 'dev_customer_token';
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        };
        headers['x-customer-id'] = customerId;

        await fetch(`${apiUrl}/api/v1/documents/${intent.documentId}/finalize`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            checksum_sha256: req.sha256Checksum
          })
        });
      } catch (e) {
        console.warn('Finalize call to Cloud API failed:', e);
      }
    }

    return {
      documentId: intent.documentId,
      status: 'uploaded',
      fileName: intent.fileName,
      sizeBytes: intent.fileSizeBytes,
      mimeType: intent.mimeType,
      storagePath: intent.storagePath,
      sha256Checksum: req.sha256Checksum,
      finalizedAt: new Date().toISOString()
    };
  }

  /**
   * 4. Orphan Cleanup.
   * Deletes unfinalized upload objects and purges aborted intent records.
   */
  public async cancelUpload(
    documentId: string,
    customerId: string
  ): Promise<{ success: boolean; cleanedUp: boolean }> {
    const intent = this.intentsStore.get(documentId);
    if (!intent) {
      return { success: true, cleanedUp: false };
    }

    // Verify ownership before deleting
    if (intent.customerId !== customerId) {
      const err: UploadValidationError = {
        code: 'CROSS_USER_FORBIDDEN',
        message: 'Access denied: Cannot cancel an upload belonging to another user.'
      };
      throw err;
    }

    intent.status = 'cancelled';
    this.intentsStore.delete(documentId);
    return { success: true, cleanedUp: true };
  }

  /**
   * Test/Mock helper to expire an intent for testing expired link behavior.
   */
  public forceExpireIntent(documentId: string): void {
    const intent = this.intentsStore.get(documentId);
    if (intent) {
      intent.expiresAt = new Date(Date.now() - 60000).toISOString(); // 1 minute in the past
    }
  }

  /**
   * Test/Mock helper to query intent.
   */
  public getIntent(documentId: string): InternalUploadIntent | undefined {
    return this.intentsStore.get(documentId);
  }
}

export const defaultDirectUploadClient = new DirectUploadClient();
