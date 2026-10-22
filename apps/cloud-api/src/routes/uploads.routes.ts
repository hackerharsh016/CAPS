/**
 * Supabase Storage Upload & Download Routes (INT-D3-04).
 * Endpoints:
 * - POST /api/v1/uploads/presigned-url: Customer requests signed upload URL in Supabase Storage.
 * - GET /api/v1/documents/:documentId/download-url: Authorized agent or owner requests 5-minute signed download URL.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { StorageService, StorageError } from '../services/storage.service.js';
import type { IDocumentsRepository } from '../modules/documents/documents.repository.js';
import type { IPrintJobsRepository } from '../modules/print-jobs/print-jobs.repository.js';
import type { IJobAttemptsRepository } from '../modules/agents/attempts.repository.js';
import type { PrintJobRecord } from '../modules/print-jobs/print-jobs.types.js';

export interface UploadsPluginOptions {
  storageService?: StorageService | undefined;
  documentsRepo?: IDocumentsRepository | undefined;
  jobsRepo?: IPrintJobsRepository | undefined;
  attemptsRepo?: IJobAttemptsRepository | undefined;
}

const presignedUrlRequestSchema = z
  .object({
    file_name: z.string().min(1, 'File name cannot be empty').max(255).optional(),
    fileName: z.string().min(1, 'File name cannot be empty').max(255).optional(),
    mime_type: z.string().optional(),
    mimeType: z.string().optional(),
    file_size_bytes: z.number().int().positive('File size must be positive').optional(),
    fileSizeBytes: z.number().int().positive('File size must be positive').optional(),
    page_count: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional(),
    customer_id: z.string().optional(),
    customerId: z.string().optional()
  })
  .refine(data => Boolean(data.file_name || data.fileName), {
    message: 'File name (file_name or fileName) is required.'
  })
  .refine(data => Boolean(data.mime_type || data.mimeType), {
    message: 'MIME type (mime_type or mimeType) is required.'
  })
  .refine(data => data.file_size_bytes !== undefined || data.fileSizeBytes !== undefined, {
    message: 'File size in bytes (file_size_bytes or fileSizeBytes) is required.'
  });

export const uploadsRoutes: FastifyPluginAsync<UploadsPluginOptions> = async (fastify, options) => {
  const storageService = options.storageService ?? new StorageService();
  const documentsRepo = options.documentsRepo;
  const jobsRepo = options.jobsRepo;
  const attemptsRepo = options.attemptsRepo;

  function handleError(err: unknown, reply: FastifyReply) {
    if (err instanceof StorageError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {})
        }
      });
    }

    const statusCode = (err as any).statusCode || 500;
    const code = (err as any).code || 'INTERNAL_SERVER_ERROR';
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';

    return reply.status(statusCode).send({
      error: { code, message }
    });
  }

  async function handlePresignedUrl(request: FastifyRequest, reply: FastifyReply) {
    // 1. Authenticate if authorization header provided
    if (request.headers.authorization && fastify.authenticate) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const bodyResult = presignedUrlRequestSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid upload presigned URL request payload.',
          details: bodyResult.error.errors
        }
      });
    }

    const body = bodyResult.data;
    const fileName = (body.file_name || body.fileName)!;
    const mimeType = (body.mime_type || body.mimeType)!;
    const fileSizeBytes = (body.file_size_bytes ?? body.fileSizeBytes)!;
    const pageCount = body.page_count ?? body.pageCount;

    // Resolve customer identity
    const customerId =
      request.user?.id ||
      (request.headers['x-customer-id'] as string | undefined) ||
      body.customer_id ||
      body.customerId;

    if (!customerId) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message:
            'Authentication or customer identification required to request presigned upload URL.'
        }
      });
    }

    try {
      // 2. Validate metadata: MIME type === application/pdf and size <= 50MB
      storageService.validateUploadMetadata(mimeType, fileSizeBytes);

      // 3. Generate presigned upload URL in customer-documents bucket
      const presigned = await storageService.createPresignedUploadUrl({
        customerId,
        fileName,
        mimeType,
        fileSizeBytes
      });

      // 4. Create database record if documents repository is configured
      let docId = presigned.document_id;
      if (documentsRepo) {
        const docRecord = await documentsRepo.create({
          customer_id: customerId,
          file_name: fileName,
          mime_type: mimeType,
          file_size_bytes: fileSizeBytes,
          storage_key: presigned.storage_key,
          ...(pageCount ? { page_count: pageCount } : {}),
          status: 'upload_pending'
        });
        docId = docRecord.id;
      }

      return reply.status(200).send({
        data: {
          ...(docId ? { document_id: docId } : {}),
          storage_key: presigned.storage_key,
          upload_url: presigned.upload_url,
          ...(presigned.token ? { token: presigned.token } : {}),
          bucket: presigned.bucket,
          expires_at: presigned.expires_at,
          expires_in_seconds: presigned.expires_in_seconds
        }
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  }

  async function handleDownloadUrl(request: FastifyRequest, reply: FastifyReply) {
    // 1. Authenticate
    if (fastify.authenticate) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const { documentId } = request.params as { documentId: string };
    if (!documentId) {
      return reply.status(400).send({
        error: { code: 'INVALID_PAYLOAD', message: 'Document ID parameter is required.' }
      });
    }

    // 2. Lookup document
    if (!documentsRepo) {
      return reply.status(500).send({
        error: { code: 'SERVER_MISCONFIGURATION', message: 'Documents repository not configured.' }
      });
    }

    const doc =
      (await documentsRepo.findById(documentId)) ||
      (documentsRepo.findByStorageKey ? await documentsRepo.findByStorageKey(documentId) : null);

    if (!doc) {
      return reply.status(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Document "${documentId}" was not found.`
        }
      });
    }

    // 3. Authorize access
    const user = request.user;
    const agent = request.agent;

    let authorized = false;

    // A. Document Owner (Customer)
    if (user && user.role === 'customer' && user.id === doc.customer_id) {
      authorized = true;
    }

    // B. Desktop Print Agent
    else if (agent || (user && (user.role === 'PRINT_AGENT' || user.role === 'agent'))) {
      const agentDeviceId = agent?.device_id || user?.id;
      const agentShopId = agent?.shop_id;

      // Check active claim lease in documents repository
      if (agentDeviceId && documentsRepo.hasActiveLeaseForDocument) {
        authorized =
          (await documentsRepo.hasActiveLeaseForDocument(agentDeviceId, doc.id)) ||
          (await documentsRepo.hasActiveLeaseForDocument(agentDeviceId, doc.storage_key));
      }

      // Check active attempt in attempts repository
      if (!authorized && attemptsRepo && agentDeviceId && jobsRepo) {
        const jobsResult = agentShopId
          ? await jobsRepo.findAll({ shop_id: agentShopId })
          : { jobs: [] };
        const shopJobs: PrintJobRecord[] = jobsResult.jobs;
        const matchedJob = shopJobs.find(j => j.document_id === doc.id || j.id === doc.id);
        if (matchedJob) {
          const attempt = await attemptsRepo.findActiveByJobId(matchedJob.id);
          if (attempt && attempt.agent_device_id === agentDeviceId) {
            authorized = true;
          }
        }
      }

      // Check active job claimed by this agent
      if (!authorized && jobsRepo && agentDeviceId) {
        if (agentShopId) {
          const jobsResult = await jobsRepo.findAll({ shop_id: agentShopId });
          const shopJobs: PrintJobRecord[] = jobsResult.jobs;
          const job = shopJobs.find(
            j =>
              (j.document_id === doc.id || j.id === doc.id) &&
              j.claimed_by_agent_id === agentDeviceId
          );
          if (job) {
            authorized = true;
          }
        }
      }

      if (!authorized) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: `Forbidden: Agent does not possess an active claim lease for document "${doc.id}".`
          }
        });
      }
    }

    // C. Administrator
    else if (user && user.role === 'admin') {
      authorized = true;
    }

    // D. Shop Owner
    else if (user && user.role === 'shop_owner') {
      if (jobsRepo) {
        const jobsResult = await jobsRepo.findAll();
        const allJobs: PrintJobRecord[] = jobsResult.jobs;
        authorized = allJobs.some(j => j.document_id === doc.id || j.id === doc.id);
      }
      if (!authorized) {
        return reply.status(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Forbidden: Shop owner not authorized for document not assigned to their shop.'
          }
        });
      }
    }

    if (!authorized) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Forbidden: You do not have permission to download document "${doc.id}".`
        }
      });
    }

    try {
      // 4. Generate 5-minute signed secure download URL
      const signed = await storageService.createSignedDownloadUrl(doc.storage_key, 300);

      return reply.status(200).send({
        data: {
          document_id: doc.id,
          download_url: signed.downloadUrl,
          expires_at: signed.expiresAt,
          expires_in_seconds: signed.expiresInSeconds,
          checksum_sha256: doc.checksum_sha256,
          content_type: doc.mime_type || 'application/pdf'
        }
      });
    } catch (err: unknown) {
      return handleError(err, reply);
    }
  }

  // Register routes with canonical and alias paths
  fastify.post('/presigned-url', handlePresignedUrl);
  fastify.post('/uploads/presigned-url', handlePresignedUrl);
  fastify.post('/api/v1/uploads/presigned-url', handlePresignedUrl);

  fastify.get('/documents/:documentId/download-url', handleDownloadUrl);
  fastify.get('/api/v1/documents/:documentId/download-url', handleDownloadUrl);
  fastify.get('/:documentId/download-url', handleDownloadUrl);
};
