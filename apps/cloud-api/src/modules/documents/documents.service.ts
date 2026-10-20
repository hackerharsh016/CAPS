/**
 * Documents Service for CAPS.
 * Orchestrates upload intent creation, sandboxed conversion execution,
 * storage operations, and metadata persistence.
 */

import crypto from 'node:crypto';
import type {
  CreateUploadIntentDto,
  UploadIntentResponseDto,
  DocumentMetadata,
  ConversionResult,
  DownloadUrlResponseDto,
  AllowedDocumentMime
} from './documents.types.js';
import {
  ALLOWED_DOCUMENT_MIMES,
  MAX_DOCUMENT_SIZE_BYTES,
  DEFAULT_CONVERSION_TIMEOUT_MS
} from './documents.types.js';
import type { IDocumentsRepository } from './documents.repository.js';
import type { IStorageService } from './storage.service.js';
import type { IDocumentConverter } from './document-converter.js';
import { SecuritySandboxError, withSandboxTimeout } from './security-sandbox.js';

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

export class DocumentsService {
  constructor(
    private readonly documentsRepo: IDocumentsRepository,
    private readonly storageService: IStorageService,
    private readonly converter: IDocumentConverter
  ) {}

  /**
   * Generates a pre-signed upload intent and reserves a document record.
   */
  async createUploadIntent(
    customerId: string,
    dto: CreateUploadIntentDto
  ): Promise<UploadIntentResponseDto> {
    if (!customerId) {
      throw new DocumentsError(400, 'INVALID_CUSTOMER_ID', 'Customer ID is required.');
    }

    if (!dto.file_name || dto.file_name.trim().length === 0) {
      throw new DocumentsError(400, 'INVALID_FILE_NAME', 'File name cannot be empty.');
    }

    if (!ALLOWED_DOCUMENT_MIMES.includes(dto.mime_type as AllowedDocumentMime)) {
      throw new DocumentsError(
        400,
        'UNSUPPORTED_MIME',
        `MIME type '${dto.mime_type}' is not supported for document ingestion.`
      );
    }

    if (dto.file_size_bytes <= 0) {
      throw new DocumentsError(400, 'INVALID_FILE_SIZE', 'File size must be greater than zero.');
    }

    if (dto.file_size_bytes > MAX_DOCUMENT_SIZE_BYTES) {
      throw new DocumentsError(
        400,
        'FILE_TOO_LARGE',
        `File size exceeds maximum allowed size of ${MAX_DOCUMENT_SIZE_BYTES / 1024 / 1024} MB.`
      );
    }

    const docId = crypto.randomUUID();
    const sanitizedFileName = dto.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `uploads/${customerId}/${docId}-${sanitizedFileName}`;

    const docRecord = await this.documentsRepo.create({
      customer_id: customerId,
      file_name: dto.file_name,
      mime_type: dto.mime_type,
      file_size_bytes: dto.file_size_bytes,
      storage_key: storageKey,
      status: 'upload_pending'
    });

    const signedUrl = await this.storageService.createUploadSignedUrl(storageKey, 900); // 15 min

    return {
      document_id: docRecord.id,
      storage_key: storageKey,
      upload_url: signedUrl.url,
      upload_token: signedUrl.token,
      expires_at: signedUrl.expires_at,
      max_size_bytes: MAX_DOCUMENT_SIZE_BYTES,
      allowed_mimes: ALLOWED_DOCUMENT_MIMES
    };
  }

  /**
   * Executes sandboxed, trusted document conversion to normalized PDF.
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

    // Retrieve file buffer: either provided in-memory or from object storage
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
      // Store in storage if provided directly
      await this.storageService.putObject(document.storage_key, sourceBuffer, document.mime_type);
    }

    // Set status to converting
    await this.documentsRepo.update(documentId, {
      status: 'converting'
    });

    try {
      const result = await withSandboxTimeout(
        () =>
          this.converter.convert(
            documentId,
            sourceBuffer,
            document.mime_type,
            timeoutMs
          ),
        timeoutMs
      );

      // Save converted PDF to object storage
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

      if (err instanceof SecuritySandboxError) {
        throw err;
      }
      if (err instanceof DocumentsError) {
        throw err;
      }

      const message = err instanceof Error ? err.message : 'Conversion failed unexpectedly.';
      throw new DocumentsError(500, 'CONVERSION_FAILED', message);
    }
  }

  /**
   * Retrieves document metadata by ID.
   */
  async getDocument(documentId: string, customerId?: string): Promise<DocumentMetadata> {
    const document = await this.documentsRepo.findById(documentId);
    if (!document) {
      throw new DocumentsError(404, 'DOCUMENT_NOT_FOUND', `Document '${documentId}' not found.`);
    }

    if (customerId && document.customer_id !== customerId) {
      throw new DocumentsError(403, 'FORBIDDEN', 'Access denied to document owned by another customer.');
    }

    return document;
  }

  /**
   * Retrieves a signed download URL for the converted PDF.
   */
  async getDownloadUrl(documentId: string, customerId?: string): Promise<DownloadUrlResponseDto> {
    const document = await this.getDocument(documentId, customerId);

    if (document.status !== 'ready' || !document.converted_storage_key) {
      throw new DocumentsError(
        400,
        'DOCUMENT_NOT_READY',
        `Document conversion is not ready (current status: '${document.status}').`
      );
    }

    const signedUrl = await this.storageService.createDownloadSignedUrl(
      document.converted_storage_key,
      300 // 5 minutes
    );

    return {
      document_id: document.id,
      download_url: signedUrl.url,
      expires_at: signedUrl.expires_at,
      checksum_sha256: document.converted_checksum_sha256,
      content_type: 'application/pdf'
    };
  }
}
