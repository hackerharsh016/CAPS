/**
 * Fastify route plugin for Agent Pairing, Claim, Heartbeat & Status Reporting endpoints.
 * Mounted under /api/v1 namespace.
 * - POST /api/v1/shops/:shopId/agents/pairing-code (Generate short-lived single-use pairing code)
 * - POST /api/v1/agents/pair (Enroll agent device with DPAPI guidance, NO service-role keys)
 * - POST /api/v1/agents/heartbeat (Agent heartbeat reporting)
 * - POST /api/v1/shops/:shopId/agents/:deviceId/revoke (Device revocation)
 * - GET  /api/v1/shops/:shopId/agents (List paired devices for a shop)
 * - POST /api/v1/agents/claim (Contract-first agent exclusive job claim)
 * - POST /api/v1/agents/download-grant (Signed 5-minute transient download grant)
 * - POST /api/v1/agents/status (Contract-first job status update)
 * - POST /api/v1/agents/leases/renew (Claim lease heartbeat/renewal)
 * - POST /api/v1/shops/:shopId/jobs/:jobId/approve (Owner confirmation gate)
 * - POST /api/v1/shops/:shopId/leases/reconcile (Expired lease reconciliation)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AgentClaimService } from './agent-claim.service.js';
import type { PairingService } from './pairing.service.js';

export interface AgentsRoutesOptions {
  agentClaimService: AgentClaimService;
  pairingService: PairingService;
}

const claimRequestSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  agent_device_id: z.string().min(1, 'agent_device_id is required'),
  shop_id: z.string().uuid('shop_id must be a valid UUID'),
  requested_printer_id: z.string().optional(),
  lease_duration_seconds: z.number().int().min(30).max(600).optional(),
  timestamp: z.string().default(() => new Date().toISOString()),
  idempotency_key: z.string().optional()
});

const renewLeaseSchema = z.object({
  job_id: z.string().min(1, 'job_id is required'),
  attempt_id: z.string().min(1, 'attempt_id is required'),
  lease_token: z.string().min(1, 'lease_token is required'),
  extend_seconds: z.number().int().min(30).max(300).optional()
});

const generatePairingCodeSchema = z.object({
  ttl_seconds: z.number().int().min(60).max(1800).optional()
});

const pairAgentDeviceSchema = z.object({
  pairing_code: z.string().min(1, 'pairing_code is required'),
  device_fingerprint: z.string().min(1, 'device_fingerprint is required'),
  device_name: z.string().min(1, 'device_name is required'),
  agent_version: z.string().optional()
});

const heartbeatSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  agent_version: z.string().optional(),
  metrics: z.record(z.unknown()).optional()
});

const revokeDeviceSchema = z.object({
  reason: z.string().optional()
});

const downloadGrantSchema = z.object({
  job_id: z.string().uuid('job_id must be a valid UUID'),
  attempt_id: z.string().min(1, 'attempt_id is required'),
  lease_token: z.string().min(16, 'lease_token must be at least 16 characters')
});

const jobStatusUpdateSchema = z.object({
  contract_version: z.string().default('1.0.0'),
  job_id: z.string().uuid('job_id must be a valid UUID'),
  attempt_id: z.string().min(1, 'attempt_id is required'),
  lease_token: z.string().min(16, 'lease_token must be at least 16 characters'),
  status: z.enum([
    'CLAIMED',
    'DOWNLOADING',
    'RENDERING',
    'PRINTING',
    'COMPLETED',
    'FAILED'
  ]),
  spooler_job_id: z.number().int().min(1).nullable().optional(),
  pages_printed: z.number().int().min(0),
  total_pages: z.number().int().min(1),
  error_code: z.string().nullable().optional(),
  error_message: z.string().max(1000).nullable().optional(),
  timestamp: z.string().default(() => new Date().toISOString())
});

export const agentsRoutes: FastifyPluginAsync<AgentsRoutesOptions> = async (
  fastify,
  options
) => {
  const { agentClaimService, pairingService } = options;

  /**
   * POST /api/v1/shops/:shopId/agents/pairing-code
   * Owner generates a short-lived single-use pairing code.
   */
  fastify.post(
    '/shops/:shopId/agents/pairing-code',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const parsed = generatePairingCodeSchema.safeParse(request.body || {});
      const ttl = parsed.success ? parsed.data.ttl_seconds : 600;

      const result = await pairingService.generatePairingCode(
        request.user!,
        shopId,
        ttl
      );

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * POST /api/v1/agents/pair
   * Public onboarding: Agent exchanges single-use pairing code for per-device credentials.
   * Strictly never returns or reveals master service-role keys!
   */
  fastify.post(
    '/agents/pair',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = pairAgentDeviceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid agent pairing payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const result = await pairingService.pairDevice(parsed.data);

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * POST /api/v1/agents/heartbeat
   * Agent sends periodic telemetry & heartbeat.
   * Immediately rejects revoked devices with 403 REVOKED_DEVICE.
   */
  fastify.post(
    '/agents/heartbeat',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = heartbeatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid agent heartbeat payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const result = await pairingService.recordHeartbeat(parsed.data);

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/agents/:deviceId/revoke
   * Owner revokes an agent device immediately.
   */
  fastify.post(
    '/shops/:shopId/agents/:deviceId/revoke',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId, deviceId } = request.params as {
        shopId: string;
        deviceId: string;
      };
      const parsed = revokeDeviceSchema.safeParse(request.body || {});
      const reason = parsed.success ? parsed.data.reason : undefined;

      const result = await pairingService.revokeDevice(
        request.user!,
        shopId,
        deviceId,
        reason
      );

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * GET /api/v1/shops/:shopId/agents
   * Owner lists paired devices for their shop.
   */
  fastify.get(
    '/shops/:shopId/agents',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };
      const devices = await pairingService.listDevices(request.user!, shopId);

      return reply.status(200).send({
        data: {
          devices
        }
      });
    }
  );

  /**
   * POST /api/v1/agents/claim
   * Agent Exclusive Claim RPC conforming to @caps/print-contracts schema.
   */
  fastify.post(
    '/agents/claim',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = claimRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid job claim request payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const claimResult = await agentClaimService.claimJob(
        request.user!,
        parsed.data
      );

      return reply.status(200).send({
        data: claimResult,
        ...claimResult
      });
    }
  );

  /**
   * POST /api/v1/agents/download-grant
   * Returns a signed 5-minute transient download grant for claimed job.
   */
  fastify.post(
    '/agents/download-grant',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = downloadGrantSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid download grant request payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const result = await agentClaimService.generateDownloadGrant(
        request.user!,
        parsed.data
      );

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * POST /api/v1/agents/status
   * Agent reports execution status updates conforming to @caps/print-contracts schema.
   */
  fastify.post(
    '/agents/status',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = jobStatusUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid job status update payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const result = await agentClaimService.updateJobStatus(
        request.user!,
        parsed.data
      );

      return reply.status(200).send({
        data: result,
        ...result
      });
    }
  );

  /**
   * POST /api/v1/agents/leases/renew
   * Agent Heartbeat & Claim Lease Extension.
   */
  fastify.post(
    '/agents/leases/renew',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = renewLeaseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid lease renewal request payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      const result = await agentClaimService.renewLease(
        request.user!,
        parsed.data
      );

      return reply.status(200).send({
        data: result
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/jobs/:jobId/approve
   * Owner Confirmation Gate (ADR 0004 MVP requirement).
   */
  fastify.post(
    '/shops/:shopId/jobs/:jobId/approve',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { jobId } = request.params as { shopId: string; jobId: string };

      const updated = await agentClaimService.approveJob(request.user!, jobId);

      return reply.status(200).send({
        data: {
          job: updated
        }
      });
    }
  );

  /**
   * POST /api/v1/shops/:shopId/leases/reconcile
   * Reconciles expired agent claim leases and recovers jobs for retry.
   */
  fastify.post(
    '/shops/:shopId/leases/reconcile',
    {
      preHandler: [
        fastify.authenticate,
        fastify.authorize(['shop_owner', 'agent', 'admin'])
      ]
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { shopId } = request.params as { shopId: string };

      const result = await agentClaimService.reconcileExpiredLeases(shopId);

      return reply.status(200).send({
        data: result
      });
    }
  );
};
