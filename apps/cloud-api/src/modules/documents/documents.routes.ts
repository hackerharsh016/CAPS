import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DocumentsService } from './documents.service.js';
import type { IStorageService } from './storage.service.js';

export interface DocumentsPluginOptions {
  documentsService: DocumentsService;
  storageService: IStorageService;
}

const createUploadIntentSchema = z
  .object({
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

export const documentsRoutes: FastifyPluginAsync<DocumentsPluginOptions> = async (
  fastify,
  options
) => {
  const { documentsService, storageService } = options;

  // Support binary buffer content types for direct storage endpoints
  fastify.addContentTypeParser(
    ['application/octet-stream', 'application/pdf', 'image/png', 'image/jpeg'],
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    }
  );

  // 1. POST /api/v1/documents/uploads (Initiate restricted upload intent)
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

      const input = {
        file_name: (parsed.data.file_name || parsed.data.fileName)!,
        mime_type: (parsed.data.mime_type || parsed.data.mimeType)!,
        file_size_bytes: (parsed.data.file_size_bytes ?? parsed.data.fileSizeBytes)!,
        page_count: parsed.data.page_count ?? parsed.data.pageCount
      };

      const result = await documentsService.createUploadIntent(
        request.user!,
        input
      );

      return reply.status(201).send({
        data: result
      });
    }
  );

  // 2. POST /api/v1/documents/:id/finalize (Verify upload, magic bytes, sha256 checksum)
  fastify.post(
    '/:id/finalize',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = finalizeUploadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid finalize upload payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const input = {
        checksum_sha256: parsed.data.checksum_sha256 || parsed.data.checksumSha256,
        page_count: parsed.data.page_count ?? parsed.data.pageCount
      };

      const result = await documentsService.finalizeUpload(
        request.user!,
        id,
        input
      );

      return reply.status(200).send({
        data: result
      });
    }
  );

  // 3. GET /api/v1/documents/:id/download (Generate short-lived signed download URL)
  fastify.get(
    '/:id/download',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await documentsService.getDownloadUrl(request.user!, id);

      return reply.status(200).send({
        data: result
      });
    }
  );

  // 4. GET /api/v1/documents/:id (Get document metadata)
  fastify.get(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await documentsService.getDocument(request.user!, id);

      return reply.status(200).send({
        data: result
      });
    }
  );

  // 5. DELETE /api/v1/documents/:id (Purge storage object and document record)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await documentsService.deleteDocument(request.user!, id);

      return reply.status(200).send(result);
    }
  );

  // 6. Direct Storage Service Endpoints (for test execution & storage simulation)
  // PUT /api/v1/documents/storage/upload?token=...
  fastify.put(
    '/storage/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { token?: string };
      if (!query.token) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Missing required storage token parameter.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const tokenResult = storageService.verifyToken(query.token, 'upload');
      if (!tokenResult.valid) {
        const statusCode = tokenResult.expired ? 403 : 403;
        return reply.status(statusCode).send({
          error: {
            code: tokenResult.expired ? 'TOKEN_EXPIRED' : 'FORBIDDEN',
            message: tokenResult.error || 'Invalid or expired upload token.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      let buffer: Buffer;
      const contentType = request.headers['content-type'] || 'application/octet-stream';

      if (Buffer.isBuffer(request.body)) {
        buffer = request.body;
      } else if (typeof request.body === 'object' && request.body !== null && 'fileBase64' in request.body) {
        buffer = Buffer.from((request.body as { fileBase64: string }).fileBase64, 'base64');
      } else if (typeof request.body === 'string') {
        buffer = Buffer.from(request.body);
      } else {
        buffer = Buffer.alloc(0);
      }

      await storageService.putObject(tokenResult.storageKey!, buffer, contentType);

      return reply.status(200).send({
        success: true,
        message: 'File successfully uploaded to storage.'
      });
    }
  );

  // GET /api/v1/documents/storage/download?token=...
  fastify.get(
    '/storage/download',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { token?: string };
      if (!query.token) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Missing required storage token parameter.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const tokenResult = storageService.verifyToken(query.token, 'download');
      if (!tokenResult.valid) {
        const statusCode = tokenResult.expired ? 403 : 403;
        return reply.status(statusCode).send({
          error: {
            code: tokenResult.expired ? 'TOKEN_EXPIRED' : 'FORBIDDEN',
            message: tokenResult.error || 'Invalid or expired download token.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const item = await storageService.getObject(tokenResult.storageKey!);
      if (!item) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Storage object not found or has been purged.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      return reply
        .status(200)
        .header('Content-Type', item.mimeType)
        .header('Content-Length', item.data.length)
        .send(item.data);
    }
  );
};
