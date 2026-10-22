/**
 * Print Jobs & Realtime Broadcast Routes (INT-D3-05).
 *
 * Implements:
 * - One-click print job approval: POST /api/v1/shops/:shopId/jobs/:jobId/approve
 *   Emits `job.approved` event on `caps:shop:<shopId>` and `caps:job:<jobId>` with status 'QUEUED'.
 * - Job execution progress updates: POST /api/v1/agent/jobs/status & POST /api/v1/jobs/:jobId/status
 *   Emits `job.status_updated` event on `caps:shop:<shopId>` and `caps:job:<jobId>`.
 * - Supabase Database Webhook handler: POST /api/v1/jobs/webhook
 *   Broadcasts realtime events on database INSERT/UPDATE mutations.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RealtimeService } from '../services/realtime.service.js';
import type { IPrintJobsRepository } from '../modules/print-jobs/print-jobs.repository.js';
import type { IShopsRepository } from '../modules/shops/shops.repository.js';
import type { PrintJobsService } from '../modules/print-jobs/print-jobs.service.js';

export interface JobsPluginOptions {
  realtimeService?: RealtimeService | undefined;
  jobsRepo?: IPrintJobsRepository | undefined;
  shopsRepo?: IShopsRepository | undefined;
  printJobsService?: PrintJobsService | undefined;
}

const statusUpdateSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  job_id: z.string().optional(),
  attempt_id: z.string().optional(),
  lease_token: z.string().optional(),
  status: z.string().transform(s => s.toUpperCase()),
  pages_printed: z.number().int().min(0).optional().default(0),
  total_pages: z.number().int().min(1).optional().default(1),
  spooler_job_id: z.number().int().nullable().optional(),
  error_code: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  timestamp: z.string().optional()
});

const createJobSchema = z.object({
  shop_id: z.string().min(1, 'shop_id is required'),
  shopId: z.string().optional(),
  customer_id: z.string().optional(),
  customerId: z.string().optional(),
  document_id: z.string().optional(),
  document_storage_key: z.string().optional(),
  priority_tier: z.enum(['urgent', 'flexible']).optional().default('flexible'),
  status: z.string().optional().default('pending_payment'),
  settings: z.record(z.unknown()).optional().default({})
});

const databaseWebhookSchema = z.object({
  type: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  table: z.string(),
  record: z.record(z.unknown()).optional(),
  old_record: z.record(z.unknown()).optional()
});

export const jobsRoutes: FastifyPluginAsync<JobsPluginOptions> = async (fastify, options) => {
  const realtimeService = options.realtimeService ?? new RealtimeService();
  const jobsRepo = options.jobsRepo;
  const shopsRepo = options.shopsRepo;
  const printJobsService = options.printJobsService;

  // 1. POST /shops/:shopId/jobs/:jobId/approve & /jobs/:jobId/approve
  // Step 2: Emit `job.approved` whenever shop owner approves a print job
  async function handleApproveJob(request: FastifyRequest, reply: FastifyReply) {
    if (fastify.authenticate) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const params = request.params as { shopId?: string; jobId?: string; id?: string };
    const jobId = params.jobId || params.id;
    let shopId = params.shopId;

    if (!jobId) {
      return reply.status(400).send({
        error: { code: 'INVALID_PAYLOAD', message: 'jobId is required.' }
      });
    }

    let job: any = null;

    if (printJobsService && request.user) {
      try {
        job = await printJobsService.approvePrintJob(request.user, jobId);
        shopId = job.shop_id || shopId;
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          error: { code: err.code || 'INTERNAL_ERROR', message: err.message }
        });
      }
    } else if (jobsRepo) {
      job = await jobsRepo.findById(jobId);
      if (!job) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Job "${jobId}" not found.` }
        });
      }

      shopId = job.shop_id || shopId;

      // Verify owner authorization if shopsRepo available
      if (shopsRepo && request.user && request.user.role === 'shop_owner') {
        const shop = await shopsRepo.findById(shopId!);
        if (shop && shop.owner_id !== request.user.id) {
          return reply.status(403).send({
            error: { code: 'FORBIDDEN', message: 'Forbidden: You do not own this shop.' }
          });
        }
      }

      job = await jobsRepo.update(jobId, {
        status: 'queued'
      });
    } else {
      // Standalone / mock mode
      shopId = shopId || '00000000-0000-0000-0000-000000000001';
      job = {
        id: jobId,
        shop_id: shopId,
        status: 'queued',
        priority_tier: 'flexible'
      };
    }

    const priorityClass = job?.priority_tier || 'flexible';

    // Step 1 & 2: Broadcast `job.approved` event on `caps:shop:<shopId>` and `caps:job:<jobId>`
    await realtimeService.emitJobApproved(shopId!, jobId, {
      status: 'QUEUED',
      priorityClass,
      approvedAt: new Date().toISOString(),
      ...(request.user?.id ? { actorId: request.user.id } : {})
    });

    return reply.status(200).send({
      success: true,
      jobId,
      shopId,
      status: 'QUEUED',
      data: {
        job
      }
    });
  }

  // 2. POST /agent/jobs/status & /jobs/:jobId/status
  // Step 3: Emit `job.status_updated` whenever agent posts status progress
  async function handleJobStatusUpdate(request: FastifyRequest, reply: FastifyReply) {
    if (fastify.authenticate) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const body = (request.body as Record<string, unknown>) || {};
    const params = (request.params as Record<string, unknown>) || {};
    const payload = {
      ...body,
      ...(params['jobId'] && !body['job_id'] ? { job_id: params['jobId'] } : {}),
      ...(params['id'] && !body['job_id'] ? { job_id: params['id'] } : {})
    };

    const parsed = statusUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid status update payload.',
          details: parsed.error.errors
        }
      });
    }

    const {
      job_id: jobId,
      status,
      pages_printed,
      total_pages,
      spooler_job_id,
      error_code,
      error_message
    } = parsed.data;

    if (!jobId) {
      return reply.status(400).send({
        error: { code: 'INVALID_PAYLOAD', message: 'job_id is required.' }
      });
    }

    let shopId =
      (request.body as any)?.shop_id ||
      request.agent?.shop_id ||
      '00000000-0000-0000-0000-000000000001';

    if (jobsRepo) {
      const existing = await jobsRepo.findById(jobId);
      if (existing) {
        shopId = existing.shop_id || shopId;
        await jobsRepo.update(jobId, {
          status: status.toLowerCase() as any
        });
      }
    }

    // Emit `job.status_updated` event on `caps:shop:<shopId>` and `caps:job:<jobId>`
    await realtimeService.emitJobStatusUpdated(shopId, jobId, {
      status,
      pages_printed,
      total_pages,
      spooler_job_id,
      error_code,
      error_message
    });

    return reply.status(200).send({
      success: true,
      job_id: jobId,
      status,
      acknowledged_at: new Date().toISOString()
    });
  }

  // 3. POST /agent/heartbeat
  async function handleAgentHeartbeat(request: FastifyRequest, reply: FastifyReply) {
    if (fastify.authenticate) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const body = (request.body as Record<string, unknown>) || {};
    const agentId = (body['device_id'] as string) || request.agent?.device_id || 'agent-001';
    const shopId =
      (body['shop_id'] as string) ||
      request.agent?.shop_id ||
      '00000000-0000-0000-0000-000000000001';

    await realtimeService.emitAgentHeartbeat(shopId, agentId, {
      status: (body['status'] as string) || 'ONLINE',
      printers: body['printers'],
      system_info: body['system_info']
    });

    return reply.status(200).send({
      success: true,
      shopId,
      agentId,
      acknowledged_at: new Date().toISOString()
    });
  }

  // 4. POST /jobs/webhook (Supabase Database Webhook Trigger)
  async function handleDatabaseWebhook(request: FastifyRequest, reply: FastifyReply) {
    const parsed = databaseWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_WEBHOOK_PAYLOAD', details: parsed.error.errors }
      });
    }

    const { type, table, record, old_record } = parsed.data;

    if (table === 'print_jobs' && record) {
      const jobId = (record['id'] as string) || '';
      const shopId = (record['shop_id'] as string) || '';
      const status = ((record['status'] as string) || '').toUpperCase();
      const oldStatus = ((old_record?.['status'] as string) || '').toUpperCase();

      if (type === 'INSERT') {
        await realtimeService.emitJobCreated(shopId, {
          id: jobId,
          shop_id: shopId,
          status,
          priority_tier: (record['priority_tier'] as string) || 'flexible'
        });
      } else if (type === 'UPDATE') {
        if ((status === 'QUEUED' || status === 'APPROVED') && oldStatus !== status) {
          await realtimeService.emitJobApproved(shopId, jobId, {
            status: 'QUEUED',
            priorityClass: (record['priority_tier'] as string) || 'flexible'
          });
        } else {
          await realtimeService.emitJobStatusUpdated(shopId, jobId, {
            status,
            pages_printed: Number(record['pages_printed'] || 0),
            total_pages: Number(record['total_pages'] || 1)
          });
        }
      }
    }

    return reply.status(200).send({
      received: true,
      broadcast: true,
      timestamp: new Date().toISOString()
    });
  }

  // 5. POST /jobs (Create Print Job & Emit `job.created`)
  async function handleCreateJob(request: FastifyRequest, reply: FastifyReply) {
    if (fastify.authenticate) {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;
    }

    const bodyResult = createJobSchema.safeParse(request.body || {});
    if (!bodyResult.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_PAYLOAD', details: bodyResult.error.errors }
      });
    }

    const b = bodyResult.data;
    const shopId = b.shop_id || b.shopId!;
    const customerId = request.user?.id || b.customer_id || b.customerId || 'cust-001';

    let job: any;
    if (jobsRepo) {
      job = await jobsRepo.create({
        shop_id: shopId,
        customer_id: customerId,
        document_storage_key: b.document_storage_key || 'uploads/default.pdf',
        settings: b.settings,
        priority_tier: b.priority_tier as any,
        price_total_paise: 1000,
        price_breakdown: {},
        status: (b.status as any) || 'pending_payment'
      });
    } else {
      job = {
        id: `job-${Date.now()}`,
        shop_id: shopId,
        customer_id: customerId,
        status: b.status || 'pending_payment',
        priority_tier: b.priority_tier || 'flexible'
      };
    }

    // Emit `job.created` on `caps:shop:<shopId>` and `caps:job:<jobId>`
    await realtimeService.emitJobCreated(shopId, job);

    return reply.status(201).send({
      data: job
    });
  }

  // Mount routes with canonical and alias endpoints
  fastify.post('/shops/:shopId/jobs/:jobId/approve', handleApproveJob);
  fastify.post('/api/v1/shops/:shopId/jobs/:jobId/approve', handleApproveJob);
  fastify.post('/jobs/:id/approve', handleApproveJob);
  fastify.post('/api/v1/jobs/:id/approve', handleApproveJob);

  fastify.post('/agent/jobs/status', handleJobStatusUpdate);
  fastify.post('/api/v1/agent/jobs/status', handleJobStatusUpdate);
  fastify.post('/jobs/:jobId/status', handleJobStatusUpdate);
  fastify.post('/api/v1/jobs/:jobId/status', handleJobStatusUpdate);

  fastify.post('/agent/heartbeat', handleAgentHeartbeat);
  fastify.post('/api/v1/agent/heartbeat', handleAgentHeartbeat);

  fastify.post('/jobs/webhook', handleDatabaseWebhook);
  fastify.post('/api/v1/jobs/webhook', handleDatabaseWebhook);

  fastify.post('/jobs', handleCreateJob);
  fastify.post('/api/v1/jobs', handleCreateJob);
};
