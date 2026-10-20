/**
 * Documents Routes for CAPS Trusted Conversion & Document Management.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DocumentsService, DocumentsError } from './documents.service.js';
import { SecuritySandboxError } from './security-sandbox.js';

export interface DocumentsPluginOptions {
  documentsService: DocumentsService;
}

const createUploadIntentSchema = z.object({
  customer_id: z.string().uuid().optional(),
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  file_size_bytes: z.number().int().positive()
});

const convertDocumentSchema = z.object({
  customer_id: z.string().uuid().optional(),
  timeout_ms: z.number().int().positive().optional(),
  file_base64: z.string().optional()
});

const documentParamsSchema = z.object({
  documentId: z.string().uuid()
});

export const documentsRoutes: FastifyPluginAsync<DocumentsPluginOptions> = async (
  fastify,
  options
) => {
  const { documentsService } = options;

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
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message
      }
    });
  }

  // 1. Create upload intent
  fastify.post('/upload-intent', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = createUploadIntentSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid upload intent payload.',
          details: parseResult.error.errors
        }
      });
    }

    const customerId =
      parseResult.data.customer_id ??
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
        file_name: parseResult.data.file_name,
        mime_type: parseResult.data.mime_type,
        file_size_bytes: parseResult.data.file_size_bytes
      });

      return reply.status(201).send({
        data: intent
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 2. Trigger sandboxed conversion
  fastify.post('/:documentId/convert', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = documentParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid document ID format.',
          details: paramsResult.error.errors
        }
      });
    }

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

    const documentId = paramsResult.data.documentId;
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

  // 3. Get document metadata
  fastify.get('/:documentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = documentParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid document ID format.',
          details: paramsResult.error.errors
        }
      });
    }

    const customerId = request.headers['x-customer-id'] as string | undefined;

    try {
      const doc = await documentsService.getDocument(paramsResult.data.documentId, customerId);
      return reply.status(200).send({
        data: doc
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });

  // 4. Get signed download URL
  fastify.get('/:documentId/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = documentParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid document ID format.',
          details: paramsResult.error.errors
        }
      });
    }

    const customerId = request.headers['x-customer-id'] as string | undefined;

    try {
      const download = await documentsService.getDownloadUrl(
        paramsResult.data.documentId,
        customerId
      );
      return reply.status(200).send({
        data: download
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  });
};
