/**
 * Document Upload Service for CAPS Customer Web.
 * Coordinates client preflight, direct private upload intent negotiation,
 * chunked storage upload, SHA-256 finalization, and orphan cleanup on cancellation.
 */

import type {
  UploadedDocumentMetadata,
  UploadOptions,
  UploadValidationError
} from './types';
import { validateDocumentPreflight, getFileExtension } from './validation';
import {
  DirectUploadClient,
  defaultDirectUploadClient,
  computeSha256Checksum
} from './direct-upload-client';

export class UploadService {
  constructor(private client: DirectUploadClient = defaultDirectUploadClient) {}

  /**
   * Complete end-to-end direct private upload pipeline:
   * 1. Preflight validation
   * 2. Upload intent negotiation
   * 3. Direct private stream upload with progress
   * 4. Server-side SHA256 finalize verification
   * 5. Orphan cleanup on cancellation/abort
   */
  public async uploadDocument(
    file: File,
    options: UploadOptions = {}
  ): Promise<UploadedDocumentMetadata> {
    const { onProgress, signal, targetShopId, customerId = 'usr-current-session' } = options;

    // 1. Client-side preflight validation
    const preflight = validateDocumentPreflight(file);
    if (!preflight.valid && preflight.error) {
      throw preflight.error;
    }

    // 2. Immediate check for pre-aborted signal
    if (signal?.aborted) {
      const err: UploadValidationError = {
        code: 'ABORTED',
        message: 'Upload was cancelled by user before starting.'
      };
      throw err;
    }

    // 3. Negotiate upload intent with private storage key
    const intent = await this.client.createUploadIntent(
      {
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        targetShopId
      },
      customerId
    );

    // 4. Compute SHA-256 checksum
    const checksumPromise = computeSha256Checksum(file);

    // 5. Direct upload to storage with cancellation & orphan cleanup
    try {
      await this.client.uploadToStorage(intent.documentId, file, {
        onProgress,
        signal
      });
    } catch (err: unknown) {
      // Orphan cleanup on cancellation or failure
      try {
        await this.client.cancelUpload(intent.documentId, customerId);
      } catch (cleanupErr) {
        console.warn('Orphan cleanup warning:', cleanupErr);
      }
      throw err;
    }

    // 6. Finalize server-side checks
    const sha256Checksum = await checksumPromise;
    const finalized = await this.client.finalizeUpload(
      intent.documentId,
      {
        sha256Checksum,
        actualSizeBytes: file.size
      },
      customerId
    );

    const ext = getFileExtension(file.name);

    return {
      id: finalized.documentId,
      name: finalized.fileName,
      sizeBytes: finalized.sizeBytes,
      mimeType: finalized.mimeType,
      extension: ext,
      uploadedAt: finalized.finalizedAt,
      storagePath: finalized.storagePath
    };
  }

  public getClient(): DirectUploadClient {
    return this.client;
  }
}

export const defaultUploadService = new UploadService();
