/**
 * Document Upload Service for CAPS Customer Web.
 * Coordinates client preflight, chunked progress reporting, cancellation via AbortSignal,
 * and contract-first mock upload resolution.
 */

import type {
  UploadedDocumentMetadata,
  UploadOptions,
  UploadValidationError
} from './types';
import { validateDocumentPreflight, getFileExtension } from './validation';

export class UploadService {
  /**
   * Uploads a document with progress updates and abort support.
   */
  public async uploadDocument(
    file: File,
    options: UploadOptions = {}
  ): Promise<UploadedDocumentMetadata> {
    const { onProgress, signal, targetShopId } = options;

    // 1. Run client preflight validation
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

    const totalBytes = file.size;
    const totalSteps = 10;
    const stepDurationMs = 50; // Fast simulation for responsive UI & testing

    return new Promise<UploadedDocumentMetadata>((resolve, reject) => {
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

      // Initial progress: 0%
      if (onProgress) {
        onProgress({
          loadedBytes: 0,
          totalBytes,
          percentage: 0
        });
      }

      intervalId = setInterval(() => {
        // If aborted between ticks
        if (signal?.aborted) {
          handleAbort();
          return;
        }

        currentStep++;
        const loadedBytes = Math.min(totalBytes, Math.round((currentStep / totalSteps) * totalBytes));
        const percentage = Math.min(100, Math.round((currentStep / totalSteps) * 100));

        if (onProgress) {
          onProgress({
            loadedBytes,
            totalBytes,
            percentage
          });
        }

        if (currentStep >= totalSteps) {
          cleanup();

          const ext = getFileExtension(file.name);
          const docId = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

          const metadata: UploadedDocumentMetadata = {
            id: docId,
            name: file.name,
            sizeBytes: file.size,
            mimeType: file.type || 'application/octet-stream',
            extension: ext,
            uploadedAt: new Date().toISOString(),
            storagePath: `private/uploads/${targetShopId || 'general'}/${docId}/${file.name}`
          };

          resolve(metadata);
        }
      }, stepDurationMs);
    });
  }
}

export const defaultUploadService = new UploadService();
