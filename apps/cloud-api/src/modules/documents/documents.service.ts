/**
 * Unified Documents Service for CAPS.
 * Supports both Phase 03 upload/finalize workflows and Phase 06 trusted PDF conversion.
 */

import crypto from 'node:crypto';
import type {
  CreateUploadIntentDto,
  CreateUploadIntentInput,
  UploadIntentResponseDto,
  UploadIntentResult,
  DocumentMetadata,
  ConversionResult,
  DownloadUrlResponseDto,
  DownloadUrlResult,
  FinalizeUploadInput,
  AllowedDocumentMime
} from './documents.types.js';
import {
  ALLOWED_DOCUMENT_MIMES,
  MAX_DOCUMENT_SIZE_BYTES,
  DEFAULT_CONVERSION_TIMEOUT_MS,
  UPLOAD_URL_EXPIRY_SECONDS,
  DOWNLOAD_URL_EXPIRY_SECONDS
} from './documents.types.js';
import type { IDocumentsRepository } from './documents.repository.js';
import type { IStorageService } from './storage.service.js';
import type { IDocumentConverter } from './document-converter.js';
import { SecuritySandboxError, withSandboxTimeout } from './security-sandbox.js';
import { ApiError, AuthError, NotFoundError, ValidationError } from '../../plugins/error-handler.js';

export class DocumentsError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'DocumentsError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class DocumentError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'DocumentError';
  }
}

export class DocumentsService {
  constructor(
    private readonly documentsRepo: IDocumentsRepository,
    private readonly storageService: IStorageService,
    private readonly converter?: IDocumentConverter
  ) {}

  /**
   * Generates a pre-signed upload intent and reserves a document record.
   * Supports both (customerId: string, dto) and (user: { id, role }, input).
   */
  async createUploadIntent(
    userOrCustomerId: string | { id: string; role: string },
    input: CreateUploadIntentDto | CreateUploadIntentInput
  ): Promise<any> {
    const customerId =
      typeof userOrCustomerId === 'string' ? userOrCustomerId : userOrCustomerId.id;

    if (!customerId) {
      throw new DocumentsError(400, 'INVALID_CUSTOMER_ID', 'Customer ID is required.');
    }

    if (!input.file_name || input.file_name.trim().length === 0) {
      throw new DocumentsError(400, 'INVALID_FILE_NAME', 'File name cannot be empty.');
    }

    if (input.file_size_bytes <= 0) {
      throw new ValidationError('File size must be positive.', { providedSizeBytes: input.file_size_bytes });
    }

    if (input.file_size_bytes > MAX_DOCUMENT_SIZE_BYTES) {
      throw new ValidationError(
        `File size exceeds maximum permitted limit of 50 MB (got ${input.file_size_bytes} bytes).`,
        { maxSizeBytes: MAX_DOCUMENT_SIZE_BYTES, providedSizeBytes: input.file_size_bytes }
      );
    }

    if (!ALLOWED_DOCUMENT_MIMES.includes(input.mime_type as AllowedDocumentMime)) {
      throw new ValidationError(
        `Unsupported MIME type "${input.mime_type}". Supported types are: ${ALLOWED_DOCUMENT_MIMES.join(', ')}.`,
        { allowedMimeTypes: ALLOWED_DOCUMENT_MIMES, providedMimeType: input.mime_type }
      );
    }

    const docId = crypto.randomUUID();
    const sanitizedFileName = input.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `uploads/${customerId}/${docId}-${sanitizedFileName}`;
    const expiresAt = new Date(Date.now() + UPLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();

    const docRecord = await this.documentsRepo.create({
      customer_id: customerId,
      file_name: input.file_name,
      mime_type: input.mime_type,
      file_size_bytes: input.file_size_bytes,
      storage_key: storageKey,
      status: 'upload_pending',
      expires_at: expiresAt,
      page_count: (input as CreateUploadIntentInput).page_count
    });

    const signedUrl = await this.storageService.createUploadSignedUrl(
      storageKey,
      input.mime_type,
      UPLOAD_URL_EXPIRY_SECONDS
    );

    const uploadUrl = signedUrl.uploadUrl || signedUrl.url;
    const token = signedUrl.token;

    return {
      document_id: docRecord.id,
      storage_key: storageKey,
      upload_url: uploadUrl,
      upload_token: token,
      expires_at: expiresAt,
      expires_in_seconds: UPLOAD_URL_EXPIRY_SECONDS,
      max_size_bytes: MAX_DOCUMENT_SIZE_BYTES,
      allowed_mimes: ALLOWED_DOCUMENT_MIMES,
      allowed_mime_types: ALLOWED_DOCUMENT_MIMES
    };
  }

  /**
   * Finalizes document upload after client binary transfer.
   */
  async finalizeUpload(
    user: { id: string; role: string },
    documentId: string,
    input: FinalizeUploadInput = {}
  ): Promise<DocumentMetadata> {
    const doc = await this.documentsRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document "${documentId}" not found.`);
    }

    if (user.role !== 'admin' && doc.customer_id !== user.id) {
      throw new AuthError(
        403,
        'FORBIDDEN',
        `Forbidden: You do not have permission to finalize document "${documentId}".`
      );
    }

    if (doc.status === 'purged') {
      throw new DocumentError(410, 'DOCUMENT_PURGED', `Document "${documentId}" has already been purged.`);
    }

    if (new Date(doc.expires_at).getTime() < Date.now()) {
      await this.documentsRepo.update(documentId, { status: 'failed' });
      throw new DocumentError(
        400,
        'UPLOAD_EXPIRED',
        'Upload intent window has expired. Please create a new upload intent.'
      );
    }

    if (this.storageService.verifyObject) {
      const verification = await this.storageService.verifyObject(doc.storage_key, doc.mime_type);
      if (!verification.valid) {
        await this.documentsRepo.update(documentId, { status: 'failed' });
        throw new DocumentError(
          400,
          'INVALID_PAYLOAD',
          verification.error || 'Magic bytes or MIME verification failed for uploaded file.',
          { details: verification }
        );
      }

      if (input.checksum_sha256 && verification.sha256) {
        if (input.checksum_sha256.toLowerCase() !== verification.sha256.toLowerCase()) {
          await this.documentsRepo.update(documentId, { status: 'failed' });
          throw new DocumentError(
            400,
            'CHECKSUM_MISMATCH',
            'Uploaded document SHA-256 checksum does not match the provided checksum.',
            {
              expected: input.checksum_sha256,
              computed: verification.sha256
            }
          );
        }
      }

      const updated = await this.documentsRepo.update(documentId, {
        status: 'ready',
        checksum_sha256: verification.sha256 ?? doc.checksum_sha256,
        file_size_bytes: verification.sizeBytes ?? doc.file_size_bytes,
        ...(input.page_count !== undefined ? { page_count: input.page_count } : {})
      });

      if (!updated) {
        throw new DocumentError(500, 'INTERNAL_ERROR', `Failed to finalize document "${documentId}".`);
      }

      return updated;
    }

    const updated = await this.documentsRepo.update(documentId, {
      status: 'ready',
      ...(input.checksum_sha256 ? { checksum_sha256: input.checksum_sha256 } : {}),
      ...(input.page_count !== undefined ? { page_count: input.page_count } : {})
    });

    return updated!;
  }

  /**
   * Executes sandboxed, trusted document conversion to normalized PDF (Phase 06).
   */
  async convertDocument(
    documentId: string,
    customerId?: string,
    fileBuffer?: Buffer,
    timeoutMs: number = DEFAULT_CONVERSION_TIMEOUT_MS
  ): Promise<ConversionResult> {
    const document = await this.documentsRepo.findById(documentId);
    if (!document) {
      throw new DocumentsError(404, 'DOCUMENT_NOT_FOUND', `Document '${documentId}' not found.`);
    }

    if (customerId && document.customer_id !== customerId) {
      throw new DocumentsError(403, 'FORBIDDEN', 'Access denied to document owned by another customer.');
    }

    if (document.status === 'purged') {
      throw new DocumentsError(410, 'DOCUMENT_PURGED', 'This document has expired and was purged.');
    }

    let sourceBuffer = fileBuffer;
    if (!sourceBuffer) {
      const storageObj = await this.storageService.getObject(document.storage_key);
      if (!storageObj) {
        throw new DocumentsError(
          400,
          'SOURCE_FILE_NOT_FOUND',
          'Source file not found in storage. Ensure upload completed before conversion.'
        );
      }
      sourceBuffer = storageObj.data;
    } else {
      await this.storageService.putObject(document.storage_key, sourceBuffer, document.mime_type);
    }

    await this.documentsRepo.update(documentId, {
      status: 'converting'
    });

    if (!this.converter) {
      throw new DocumentsError(500, 'CONVERTER_UNAVAILABLE', 'Document converter not configured.');
    }

    try {
      const result = await withSandboxTimeout(
        () =>
          this.converter!.convert(
            documentId,
            sourceBuffer!,
            document.mime_type,
            timeoutMs
          ),
        timeoutMs
      );

      await this.storageService.putObject(
        result.converted_storage_key,
        result.pdf_buffer,
        'application/pdf'
      );

      const sourceChecksum = crypto.createHash('sha256').update(sourceBuffer).digest('hex');

      await this.documentsRepo.update(documentId, {
        status: 'ready',
        page_count: result.page_count,
        checksum_sha256: sourceChecksum,
        converted_checksum_sha256: result.checksum_sha256,
        converted_storage_key: result.converted_storage_key,
        conversion_metadata: {
          source_format: document.mime_type,
          target_format: 'pdf',
          duration_ms: result.duration_ms,
          page_count: result.page_count,
          dimensions: result.dimensions,
          has_color: result.has_color,
          converted_at: new Date().toISOString()
        }
      });

      return result;
    } catch (err: unknown) {
      await this.documentsRepo.update(documentId, {
        status: 'failed'
      });

      if (err instanceof SecuritySandboxError || err instanceof DocumentsError) {
        throw err;
      }

      const message = err instanceof Error ? err.message : 'Conversion failed unexpectedly.';
      throw new DocumentsError(500, 'CONVERSION_FAILED', message);
    }
  }

  /**
   * Retrieves document metadata by ID. Supports (documentId, customerId?) or (user, documentId).
   */
  async getDocument(
    userOrDocId: string | { id: string; role: string },
    docIdOrCustomerId?: string
  ): Promise<DocumentMetadata> {
    const documentId = typeof userOrDocId === 'string' ? userOrDocId : docIdOrCustomerId!;
    const user = typeof userOrDocId === 'object' ? userOrDocId : undefined;
    const customerId = typeof userOrDocId === 'string' ? docIdOrCustomerId : undefined;

    const document = await this.documentsRepo.findById(documentId);
    if (!document) {
      throw new DocumentsError(404, 'DOCUMENT_NOT_FOUND', `Document '${documentId}' not found.`);
    }

    if (user) {
      const isOwner = document.customer_id === user.id;
      const isAdmin = user.role === 'admin';
      if (!isOwner && !isAdmin) {
        throw new AuthError(403, 'FORBIDDEN', `Forbidden: Access denied to document "${documentId}".`);
      }
    } else if (customerId && document.customer_id !== customerId) {
      throw new DocumentsError(403, 'FORBIDDEN', 'Access denied to document owned by another customer.');
    }

    return document;
  }

  /**
   * Retrieves a signed download URL for the converted or ready PDF.
   */
  async getDownloadUrl(
    userOrDocId: string | { id: string; role: string },
    docIdOrCustomerId?: string
  ): Promise<any> {
    const documentId = typeof userOrDocId === 'string' ? userOrDocId : docIdOrCustomerId!;
    const user = typeof userOrDocId === 'object' ? userOrDocId : undefined;
    const customerId = typeof userOrDocId === 'string' ? docIdOrCustomerId : undefined;

    const document = await this.documentsRepo.findById(documentId);
    if (!document) {
      throw new DocumentsError(404, 'DOCUMENT_NOT_FOUND', `Document '${documentId}' not found.`);
    }

    if (user) {
      const isOwner = document.customer_id === user.id;
      const isAdmin = user.role === 'admin';
      if (!isOwner && !isAdmin) {
        throw new AuthError(403, 'FORBIDDEN', `Forbidden: You do not own document "${documentId}".`);
      }
    } else if (customerId && document.customer_id !== customerId) {
      throw new DocumentsError(403, 'FORBIDDEN', 'Access denied to document owned by another customer.');
    }

    if (document.status === 'purged') {
      throw new DocumentsError(410, 'DOCUMENT_PURGED', `Document "${documentId}" has been purged.`);
    }

    if (document.status !== 'ready') {
      throw new DocumentsError(
        400,
        'DOCUMENT_NOT_READY',
        `Document conversion is not ready (current status: '${document.status}').`
      );
    }

    const keyToDownload = document.converted_storage_key || document.storage_key;
    const signedUrl = await this.storageService.createDownloadSignedUrl(
      keyToDownload,
      DOWNLOAD_URL_EXPIRY_SECONDS
    );

    const downloadUrl = signedUrl.downloadUrl || signedUrl.url;

    return {
      document_id: document.id,
      download_url: downloadUrl,
      expires_at: signedUrl.expires_at || signedUrl.expiresAt,
      expires_in_seconds: DOWNLOAD_URL_EXPIRY_SECONDS,
      checksum_sha256: document.converted_checksum_sha256 || document.checksum_sha256,
      content_type: 'application/pdf'
    };
  }

  /**
   * Deletes a document record and storage object.
   */
  async deleteDocument(
    user: { id: string; role: string },
    documentId: string
  ): Promise<{ success: boolean; message: string }> {
    const doc = await this.documentsRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document "${documentId}" not found.`);
    }

    if (user.role !== 'admin' && doc.customer_id !== user.id) {
      throw new AuthError(403, 'FORBIDDEN', `Forbidden: You do not own document "${documentId}".`);
    }

    await this.storageService.deleteObject(doc.storage_key);
    if (doc.converted_storage_key) {
      await this.storageService.deleteObject(doc.converted_storage_key);
    }

    await this.documentsRepo.update(documentId, {
      status: 'purged',
      purged_at: new Date().toISOString()
    });

    return {
      success: true,
      message: `Document "${documentId}" has been purged from storage.`
    };
  }
}
