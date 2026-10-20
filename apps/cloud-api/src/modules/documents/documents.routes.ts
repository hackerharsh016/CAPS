/**
 * Unified Documents Routes for CAPS.
 * Supports Phase 03 uploads/finalization and Phase 06 trusted PDF conversion.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DocumentsService, DocumentsError } from './documents.service.js';
import type { IStorageService } from './storage.service.js';
import { SecuritySandboxError } from './security-sandbox.js';
import { ALLOWED_DOCUMENT_MIMES, MAX_DOCUMENT_SIZE_BYTES, type AllowedDocumentMime } from './documents.types.js';

export interface DocumentsPluginOptions {
  documentsService: DocumentsService;
  storageService?: IStorageService | undefined;
}

const createUploadIntentSchema = z
  .object({
    customer_id: z.string().uuid().optional(),
    file_name: z.string().min(1, 'File name cannot be empty').max(255).optional(),
    fileName: z.string().min(1, 'File name cannot be empty').max(255).optional(),
    mime_type: z.string().optional(),
    mimeType: z.string().optional(),
    file_size_bytes: z.number().int().positive('File size must be positive').optional(),
    fileSizeBytes: z.number().int().positive('File size must be positive').optional(),
    page_count: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional()
  })
  .refine(data => Boolean(data.file_name || data.fileName), {
    message: 'File name (file_name or fileName) is required.'
  })
  .refine(data => Boolean(data.mime_type || data.mimeType), {
    message: 'MIME type (mime_type or mimeType) is required.'
  })
  .refine(data => Boolean(data.file_size_bytes !== undefined || data.fileSizeBytes !== undefined), {
    message: 'File size in bytes (file_size_bytes or fileSizeBytes) is required.'
  });

const finalizeUploadSchema = z.object({
  checksum_sha256: z.string().optional(),
  checksumSha256: z.string().optional(),
  page_count: z.number().int().positive().optional(),
  pageCount: z.number().int().positive().optional()
});

const convertDocumentSchema = z.object({
  customer_id: z.string().uuid().optional(),
  timeout_ms: z.number().int().positive().optional(),
  file_base64: z.string().optional()
});

export const documentsRoutes: FastifyPluginAsync<DocumentsPluginOptions> = async (
  fastify,
  options
) => {
  const { documentsService, storageService } = options;

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof SecuritySandboxError || err instanceof DocumentsError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message
        }
      });
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    const statusCode = (err as any).statusCode || 500;
    const code = (err as any).code || 'INTERNAL_SERVER_ERROR';

    return reply.status(statusCode).send({
      error: {
        code,
        message
      }
    });
  }

  // Support binary buffer content types for direct storage simulation
  fastify.addContentTypeParser(
    ['application/octet-stream', 'application/pdf', 'image/png', 'image/jpeg'],
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  // 1. Phase 03: POST /uploads (Authenticated)
  fastify.post(
    '/uploads',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createUploadIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid document upload payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      try {
        const intent = await documentsService.createUploadIntent(request.user!, {
          file_name: (parsed.data.file_name || parsed.data.fileName)!,
          mime_type: (parsed.data.mime_type || parsed.data.mimeType)!,
          file_size_bytes: (parsed.data.file_size_bytes ?? parsed.data.fileSizeBytes)!,
          page_count: parsed.data.page_count ?? parsed.data.pageCount
        });

        return reply.status(201).send({ data: intent });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 2. Phase 06: POST /upload-intent
  fastify.post('/upload-intent', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createUploadIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid upload intent payload.',
          details: parsed.error.errors
        }
      });
    }

    const { file_name, fileName, mime_type, mimeType, file_size_bytes, fileSizeBytes } = parsed.data;
    const finalMime = mime_type || mimeType;
    const finalSize = file_size_bytes ?? fileSizeBytes;

    if (finalMime && !ALLOWED_DOCUMENT_MIMES.includes(finalMime as AllowedDocumentMime)) {
      return reply.status(400).send({
        error: {
          code: 'UNSUPPORTED_MIME',
          message: `Unsupported MIME type "${finalMime}".`
        }
      });
    }

    if (typeof finalSize === 'number' && finalSize > MAX_DOCUMENT_SIZE_BYTES) {
      return reply.status(400).send({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds maximum limit of 50 MB.'
        }
      });
    }

    const customerId =
      parsed.data.customer_id ??
      (request.headers['x-customer-id'] as string | undefined);

    if (!customerId) {
      return reply.status(400).send({
        error: {
          code: 'MISSING_CUSTOMER_ID',
          message: 'Customer ID must be provided in body or x-customer-id header.'
        }
      });
    }

    try {
      const intent = await documentsService.createUploadIntent(customerId, {
        file_name: (file_name || fileName)!,
        mime_type: finalMime!,
        file_size_bytes: finalSize!
      });

      return reply.status(201).send({
        data: {
          ...intent,
          upload_url: intent.upload_url.replace('/api/v1/documents/storage/upload', '/api/v1/storage/upload')
        }
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 3. Phase 03: POST /:id/finalize
  fastify.post(
    '/:id/finalize',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = finalizeUploadSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid finalize upload payload.',
            details: parsed.error.errors
          }
        });
      }

      try {
        const finalized = await documentsService.finalizeUpload(request.user!, id, {
          checksum_sha256: parsed.data.checksum_sha256 || parsed.data.checksumSha256,
          page_count: parsed.data.page_count ?? parsed.data.pageCount
        });

        return reply.status(200).send({ data: finalized });
      } catch (err: unknown) {
        return handleError(err, reply);
      }
    }
  );

  // 4. Phase 06: POST /:documentId/convert
  fastify.post('/:documentId/convert', async (request: FastifyRequest, reply: FastifyReply) => {
    const { documentId } = request.params as { documentId: string };
    const bodyResult = convertDocumentSchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid conversion request payload.',
          details: bodyResult.error.errors
        }
      });
    }

    const customerId =
      bodyResult.data.customer_id ??
      (request.headers['x-customer-id'] as string | undefined);
    const timeoutMs = bodyResult.data.timeout_ms;
    const fileBuffer = bodyResult.data.file_base64
      ? Buffer.from(bodyResult.data.file_base64, 'base64')
      : undefined;

    try {
      const result = await documentsService.convertDocument(
        documentId,
        customerId,
        fileBuffer,
        timeoutMs
      );

      return reply.status(200).send({
        data: {
          document_id: result.document_id,
          page_count: result.page_count,
          dimensions: result.dimensions,
          has_color: result.has_color,
          checksum_sha256: result.checksum_sha256,
          duration_ms: result.duration_ms,
          status: 'ready'
        }
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 5. GET /:id or /:documentId
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const { id } = request.params as { id: string };
    const customerId = request.headers['x-customer-id'] as string | undefined;
    const user = request.user || (customerId ? { id: customerId, role: 'customer' } : undefined);

    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication token or customer ID required.'
        }
      });
    }

    try {
      const doc = await documentsService.getDocument(user, id);
      return reply.status(200).send({ data: doc });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 6. GET /:id/download or /:documentId/download
  fastify.get('/:id/download', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const { id } = request.params as { id: string };
    const customerId = request.headers['x-customer-id'] as string | undefined;
    const user = request.user || (customerId ? { id: customerId, role: 'customer' } : undefined);

    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication token or customer ID required.'
        }
      });
    }

    try {
      const download = await documentsService.getDownloadUrl(user, id);
      if (request.headers['x-customer-id'] && download.download_url) {
        download.download_url = download.download_url.replace(
          '/api/v1/documents/storage/download',
          '/api/v1/storage/download'
        );
      }
      return reply.status(200).send({ data: download });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 7. DELETE /:id
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const { id } = request.params as { id: string };
    const customerId = request.headers['x-customer-id'] as string | undefined;
    const user = request.user || (customerId ? { id: customerId, role: 'customer' } : undefined);

    if (!user) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication token or customer ID required.'
        }
      });
    }

    try {
      const result = await documentsService.deleteDocument(user, id);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 8. Direct Storage Simulation Endpoints (PUT /storage/upload, GET /storage/download)
  if (storageService) {
    fastify.put('/storage/upload', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { token?: string };
      if (!query.token) {
        return reply.status(400).send({
          error: { code: 'INVALID_PAYLOAD', message: 'Missing required storage token parameter.' }
        });
      }

      if (storageService.verifyToken) {
        const tokenResult = storageService.verifyToken(query.token, 'upload');
        if (!tokenResult.valid) {
          return reply.status(403).send({
            error: { code: tokenResult.expired ? 'TOKEN_EXPIRED' : 'FORBIDDEN', message: tokenResult.error }
          });
        }

        let buffer: Buffer;
        const contentType = (request.headers['content-type'] as string) || 'application/octet-stream';

        if (Buffer.isBuffer(request.body)) {
          buffer = request.body;
        } else if (typeof request.body === 'object' && request.body !== null && 'fileBase64' in (request.body as any)) {
          buffer = Buffer.from((request.body as { fileBase64: string }).fileBase64, 'base64');
        } else if (typeof request.body === 'string') {
          buffer = Buffer.from(request.body);
        } else {
          buffer = Buffer.alloc(0);
        }

        await storageService.putObject(tokenResult.storageKey!, buffer, contentType);
        return reply.status(200).send({ success: true, message: 'File successfully uploaded to storage.' });
      }

      return reply.status(200).send({ success: true });
    });

    fastify.get('/storage/download', async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { token?: string; key?: string };
      const storageKey = query.key;

      if (query.token && storageService.verifyToken) {
        const tokenResult = storageService.verifyToken(query.token, 'download');
        if (!tokenResult.valid) {
          return reply.status(403).send({
            error: { code: tokenResult.expired ? 'TOKEN_EXPIRED' : 'FORBIDDEN', message: tokenResult.error }
          });
        }
        const item = await storageService.getObject(tokenResult.storageKey!);
        if (!item) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Storage object not found or has been purged.' }
          });
        }
        return reply
          .status(200)
          .header('Content-Type', item.contentType || (item as any).mimeType || 'application/octet-stream')
          .send(item.data);
      }

      if (storageKey) {
        const item = await storageService.getObject(storageKey);
        if (!item) {
          return reply.status(404).send({
            error: { code: 'NOT_FOUND', message: 'Storage object not found.' }
          });
        }
        return reply
          .status(200)
          .header('Content-Type', item.contentType || (item as any).mimeType || 'application/octet-stream')
          .send(item.data);
      }

      return reply.status(400).send({ error: { code: 'INVALID_PAYLOAD', message: 'Missing key or token' } });
    });
  }
};
