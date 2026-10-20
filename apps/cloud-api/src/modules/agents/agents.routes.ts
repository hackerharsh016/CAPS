/**
 * Fastify route plugin for Agent Claim & Owner Confirmation endpoints.
 * Mounted under /api/v1 namespace.
 * - POST /api/v1/agents/claim (Contract-first agent exclusive job claim)
 * - POST /api/v1/agents/leases/renew (Claim lease heartbeat/renewal)
 * - POST /api/v1/shops/:shopId/jobs/:jobId/approve (Owner confirmation gate)
 * - POST /api/v1/shops/:shopId/leases/reconcile (Expired lease reconciliation)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AgentClaimService } from './agent-claim.service.js';

export interface AgentsRoutesOptions {
  agentClaimService: AgentClaimService;
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

export const agentsRoutes: FastifyPluginAsync<AgentsRoutesOptions> = async (
  fastify,
  options
) => {
  const { agentClaimService } = options;

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
