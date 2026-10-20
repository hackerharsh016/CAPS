import crypto from 'crypto';
import { ApiError, AuthError, NotFoundError, ValidationError } from '../../plugins/error-handler.js';
import type { IDocumentsRepository } from './documents.repository.js';
import type { IStorageService } from './storage.service.js';
import {
  ALLOWED_MIME_TYPES,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  UPLOAD_URL_EXPIRY_SECONDS,
  DOWNLOAD_URL_EXPIRY_SECONDS,
  type CreateUploadIntentInput,
  type DocumentMetadata,
  type FinalizeUploadInput,
  type UploadIntentResult,
  type DownloadUrlResult
} from './documents.types.js';

export class DocumentError extends ApiError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(statusCode, code, message, details);
    this.name = 'DocumentError';
  }
}

export class DocumentsService {
  constructor(
    private readonly documentsRepo: IDocumentsRepository,
    private readonly storageService: IStorageService
  ) {}

  async createUploadIntent(
    user: { id: string; role: string },
    input: CreateUploadIntentInput
  ): Promise<UploadIntentResult> {
    // 1. Validate file size (positive and <= 50MB)
    if (
      typeof input.file_size_bytes !== 'number' ||
      input.file_size_bytes <= 0 ||
      input.file_size_bytes > MAX_DOCUMENT_FILE_SIZE_BYTES
    ) {
      throw new ValidationError(
        `File size exceeds maximum permitted limit of 50 MB (got ${input.file_size_bytes} bytes).`,
        { maxSizeBytes: MAX_DOCUMENT_FILE_SIZE_BYTES, providedSizeBytes: input.file_size_bytes }
      );
    }

    // 2. Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(input.mime_type as (typeof ALLOWED_MIME_TYPES)[number])) {
      throw new ValidationError(
        `Unsupported MIME type "${input.mime_type}". Supported types are: ${ALLOWED_MIME_TYPES.join(', ')}.`,
        { allowedMimeTypes: ALLOWED_MIME_TYPES, providedMimeType: input.mime_type }
      );
    }

    // 3. Generate storage key scoped to customer
    const docUuid = crypto.randomUUID();
    const storageKey = `documents/${user.id}/${docUuid}`;

    // 4. Calculate upload intent expiry (15 minutes)
    const expiresAt = new Date(Date.now() + UPLOAD_URL_EXPIRY_SECONDS * 1000).toISOString();

    // 5. Store pending document metadata
    const doc = await this.documentsRepo.create({
      customer_id: user.id,
      file_name: input.file_name,
      mime_type: input.mime_type,
      file_size_bytes: input.file_size_bytes,
      page_count: input.page_count,
      storage_key: storageKey,
      status: 'upload_pending',
      expires_at: expiresAt
    });

    // 6. Generate signed upload URL
    const { uploadUrl, token } = await this.storageService.createUploadSignedUrl(
      storageKey,
      input.mime_type,
      UPLOAD_URL_EXPIRY_SECONDS
    );

    return {
      document_id: doc.id,
      storage_key: doc.storage_key,
      upload_url: uploadUrl,
      upload_token: token,
      expires_at: doc.expires_at,
      expires_in_seconds: UPLOAD_URL_EXPIRY_SECONDS,
      max_size_bytes: MAX_DOCUMENT_FILE_SIZE_BYTES,
      allowed_mime_types: ALLOWED_MIME_TYPES
    };
  }

  async finalizeUpload(
    user: { id: string; role: string },
    documentId: string,
    input: FinalizeUploadInput = {}
  ): Promise<DocumentMetadata> {
    const doc = await this.documentsRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document "${documentId}" not found.`);
    }

    // Tenant / Owner verification
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

    // Check if upload window expired
    if (new Date(doc.expires_at).getTime() < Date.now()) {
      await this.documentsRepo.update(documentId, { status: 'failed' });
      throw new DocumentError(
        400,
        'UPLOAD_EXPIRED',
        'Upload intent window has expired. Please create a new upload intent.'
      );
    }

    // Verify object in storage bucket (checks existence, magic bytes & checksum)
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

    // Verify SHA-256 checksum if provided by client
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

    // Mark document as ready and record verified metadata
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

  async getDownloadUrl(
    user: { id: string; role: string },
    documentId: string
  ): Promise<DownloadUrlResult> {
    const doc = await this.documentsRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document "${documentId}" not found.`);
    }

    if (doc.status === 'purged') {
      throw new DocumentError(410, 'DOCUMENT_PURGED', `Document "${documentId}" has been purged.`);
    }

    if (doc.status !== 'ready') {
      throw new DocumentError(
        400,
        'DOCUMENT_NOT_READY',
        `Document "${documentId}" is not ready for download (current status: ${doc.status}).`
      );
    }

    // Access control evaluation
    const isOwner = doc.customer_id === user.id;
    const isAdmin = user.role === 'admin';
    let isAuthorizedAgent = false;

    if (user.role === 'agent') {
      isAuthorizedAgent = await this.documentsRepo.hasActiveLeaseForDocument(user.id, doc.id);
    }

    if (!isOwner && !isAdmin && !isAuthorizedAgent) {
      throw new AuthError(
        403,
        'FORBIDDEN',
        user.role === 'agent'
          ? `Forbidden: Agent does not possess an active claim lease for document "${documentId}".`
          : `Forbidden: You do not own document "${documentId}".`
      );
    }

    // Generate short-lived signed download URL (strictly 300 seconds / 5 minutes per ADR 0007)
    const { downloadUrl, expiresAt } = await this.storageService.createDownloadSignedUrl(
      doc.storage_key,
      DOWNLOAD_URL_EXPIRY_SECONDS
    );

    return {
      document_id: doc.id,
      download_url: downloadUrl,
      expires_at: expiresAt,
      expires_in_seconds: DOWNLOAD_URL_EXPIRY_SECONDS
    };
  }

  async getDocument(
    user: { id: string; role: string },
    documentId: string
  ): Promise<DocumentMetadata> {
    const doc = await this.documentsRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document "${documentId}" not found.`);
    }

    const isOwner = doc.customer_id === user.id;
    const isAdmin = user.role === 'admin';
    let isAuthorizedAgent = false;

    if (user.role === 'agent') {
      isAuthorizedAgent = await this.documentsRepo.hasActiveLeaseForDocument(user.id, doc.id);
    }

    if (!isOwner && !isAdmin && !isAuthorizedAgent) {
      throw new AuthError(
        403,
        'FORBIDDEN',
        `Forbidden: Access denied to document "${documentId}".`
      );
    }

    return doc;
  }

  async deleteDocument(
    user: { id: string; role: string },
    documentId: string
  ): Promise<{ success: boolean; message: string }> {
    const doc = await this.documentsRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Document "${documentId}" not found.`);
    }

    // Owner or admin only
    if (user.role !== 'admin' && doc.customer_id !== user.id) {
      throw new AuthError(
        403,
        'FORBIDDEN',
        `Forbidden: You do not own document "${documentId}".`
      );
    }

    // Purge underlying object in cloud storage bucket
    await this.storageService.deleteObject(doc.storage_key);

    // Update document record to purged
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
