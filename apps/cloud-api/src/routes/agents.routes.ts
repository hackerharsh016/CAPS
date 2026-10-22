/**
 * Fastify route plugin for Agent Pairing, Claim, Heartbeat & Status Reporting endpoints.
 * Mounts singular /api/v1/agent/* and plural /api/v1/agents/* baselines identically.
 *
 * Interfaces:
 * - POST /api/v1/agent/pair & /api/v1/agents/pair
 * - POST /api/v1/agent/heartbeat & /api/v1/agents/heartbeat
 * - POST /api/v1/agent/jobs/claim & /api/v1/agents/claim
 * - POST /api/v1/agent/jobs/status & /api/v1/agents/status & /api/v1/agent/jobs/:job_id/status
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { AgentClaimService } from '../modules/agents/agent-claim.service.js';
import type { PairingService } from '../modules/agents/pairing.service.js';
import type { RealtimeSignalsService } from '../modules/queue/realtime-signals.service.js';
import type { PrivacyCleanupWorker } from '../jobs/privacy-cleanup.worker.js';
import type { MetricsCollector } from '../common/telemetry/metrics.js';
import type { AlertManager } from '../common/telemetry/alerts.js';
import {
  claimRequestSchema,
  renewLeaseSchema,
  generatePairingCodeSchema,
  pairAgentDeviceSchema,
  agentPairingHeartbeatSchema,
  agentTelemetryHeartbeatSchema,
  revokeDeviceSchema,
  downloadGrantSchema,
  jobStatusUpdateSchema,
  reconcileRequestSchema,
  resolveUnresolvedSchema
} from './agents.schema.js';

export interface AgentsRoutesOptions {
  agentClaimService: AgentClaimService;
  pairingService: PairingService;
  realtimeSignalsService?: RealtimeSignalsService | undefined;
  privacyCleanupWorker?: PrivacyCleanupWorker | undefined;
  metrics?: MetricsCollector | undefined;
  alertManager?: AlertManager | undefined;
}

export const agentsRoutes: FastifyPluginAsync<AgentsRoutesOptions> = async (fastify, options) => {
  const { agentClaimService, pairingService, realtimeSignalsService, privacyCleanupWorker } =
    options;

  const prefix = fastify.prefix || '';
  const isAgentPrefixed = prefix.endsWith('/agent') || prefix.endsWith('/agents');

  const routeAliases = (pluralPath: string, singularPath: string): string[] => {
    if (isAgentPrefixed) {
      // Strips leading /agents or /agent to mount relative to prefix
      const strippedPlural = pluralPath.replace(/^\/agents/, '') || '/';
      const strippedSingular = singularPath.replace(/^\/agent/, '') || '/';
      const set = new Set([strippedPlural, strippedSingular]);
      return Array.from(set);
    }
    return Array.from(new Set([pluralPath, singularPath]));
  };

  /**
   * POST /api/v1/shops/:shopId/agents/pairing-code
   * Owner generates a short-lived single-use pairing code.
   */
  if (!isAgentPrefixed) {
    fastify.post(
      '/shops/:shopId/agents/pairing-code',
      {
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])]
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { shopId } = request.params as { shopId: string };
        const parsed = generatePairingCodeSchema.safeParse(request.body || {});
        const ttl = parsed.success ? parsed.data.ttl_seconds : 600;

        const result = await pairingService.generatePairingCode(request.user!, shopId, ttl);

        return reply.status(200).send({
          data: result
        });
      }
    );
  }

  /**
   * POST /api/v1/agent/pair & /api/v1/agents/pair
   * Public onboarding: Agent exchanges single-use pairing code for per-device credentials.
   * Transparently accepts (device_fingerprint, device_name) or (hostname, os_version, fingerprint).
   */
  const handlePair = async (request: FastifyRequest, reply: FastifyReply) => {
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
      data: result,
      ...result,
      device_token: result.device_secret
    });
  };

  for (const path of routeAliases('/agents/pair', '/agent/pair')) {
    fastify.post(path, handlePair);
  }

  /**
   * POST /api/v1/agent/heartbeat & /api/v1/agents/heartbeat
   * Agent sends periodic telemetry & heartbeat.
   * Immediately rejects revoked devices with 403 REVOKED_DEVICE.
   */
  const handleHeartbeat = {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.headers.authorization) {
        await fastify.authenticate(request, reply);
        if (reply.sent) return;
        await fastify.authorize(['agent', 'admin'])(request, reply);
      }
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const pairingResult = agentPairingHeartbeatSchema.safeParse(request.body);
      if (pairingResult.success) {
        const result = await pairingService.recordHeartbeat(pairingResult.data);
        return reply.status(200).send({
          contract_version: '1.0.0',
          acknowledged: true,
          status: 'acknowledged',
          server_time: new Date().toISOString(),
          data: result
        });
      }

      const telemetryResult = agentTelemetryHeartbeatSchema.safeParse(request.body);
      if (telemetryResult.success) {
        const data = telemetryResult.data;
        const agentId = data.agent_id || data.agentId!;
        const shopId = data.shop_id || data.shopId!;

        if (options.metrics) {
          options.metrics.recordAgentHeartbeat({
            agent_id: agentId,
            shop_id: shopId,
            version: data.version,
            status: data.status,
            printers: data.printers,
            system_info: data.system_info,
            timestamp: data.timestamp || new Date().toISOString()
          });
        }

        if (options.alertManager) {
          options.alertManager.resolveByRule(`PRINT_AGENT_OFFLINE_${agentId}`);
          if (data.printers) {
            for (const p of data.printers) {
              if (p.status === 'paper_jam' || p.status === 'error') {
                options.alertManager.fireAlert({
                  rule_name: `PRINTER_HARDWARE_ERROR_${p.printer_id}`,
                  severity: 'warning',
                  summary: `Printer Hardware Issue: ${p.name} (${p.status})`,
                  description: `Agent ${agentId} reported printer ${p.name} status as ${p.status}.`,
                  context: {
                    agent_id: agentId,
                    shop_id: shopId,
                    printer_id: p.printer_id,
                    status: p.status
                  }
                });
              }
            }
          }
        }

        return reply.status(200).send({
          contract_version: '1.0.0',
          acknowledged: true,
          status: 'acknowledged',
          server_time: new Date().toISOString(),
          timestamp: new Date().toISOString(),
          agent_id: agentId,
          shop_id: shopId
        });
      }

      return reply.status(400).send({
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Invalid agent heartbeat payload.',
          request_id: request.requestId || 'unknown-request',
          details: telemetryResult.error.errors
        }
      });
    }
  };

  for (const path of routeAliases('/agents/heartbeat', '/agent/heartbeat')) {
    fastify.post(
      path,
      handleHeartbeat.preHandler ? { preHandler: handleHeartbeat.preHandler } : {},
      handleHeartbeat.handler
    );
  }

  /**
   * POST /api/v1/shops/:shopId/agents/:deviceId/revoke
   * Owner revokes an agent device immediately.
   */
  if (!isAgentPrefixed) {
    fastify.post(
      '/shops/:shopId/agents/:deviceId/revoke',
      {
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])]
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { shopId, deviceId } = request.params as {
          shopId: string;
          deviceId: string;
        };
        const parsed = revokeDeviceSchema.safeParse(request.body || {});
        const reason = parsed.success ? parsed.data.reason : undefined;

        const result = await pairingService.revokeDevice(request.user!, shopId, deviceId, reason);

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
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])]
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
  }

  /**
   * POST /api/v1/agent/jobs/claim & /api/v1/agents/claim
   * Exclusive Job Claim conforming strictly to job-claim-response.schema.json.
   * Wraps job payload under response.job (job.job_id, job.attempt_id, job.lease_token, job.settings, job.download_url).
   */
  const handleClaim = {
    preHandler: [fastify.authenticate, fastify.authorize(['agent', 'admin'])],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
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

      const claimResult = await agentClaimService.claimJob(request.user!, parsed.data);

      let finalJob = claimResult.job;
      if (
        finalJob &&
        (request.url.includes('/agent/jobs/claim') || request.url.includes('/agent/claim')) &&
        finalJob.download_url.startsWith('/')
      ) {
        const host = request.headers.host || '127.0.0.1:4000';
        const protocol = request.protocol || 'http';
        finalJob = {
          ...finalJob,
          download_url: `${protocol}://${host}${finalJob.download_url}`
        };
      }

      return reply.status(200).send({
        contract_version: claimResult.contract_version || '1.0.0',
        claimed: claimResult.claimed,
        job: finalJob
      });
    }
  };

  const claimPaths = isAgentPrefixed
    ? ['/claim', '/jobs/claim']
    : ['/agents/claim', '/agent/claim', '/agents/jobs/claim', '/agent/jobs/claim'];

  for (const path of claimPaths) {
    fastify.post(path, { preHandler: handleClaim.preHandler }, handleClaim.handler);
  }

  /**
   * POST /api/v1/agent/download-grant & /api/v1/agents/download-grant
   * Returns a signed 5-minute transient download grant for claimed job.
   */
  const handleDownloadGrant = {
    preHandler: [fastify.authenticate, fastify.authorize(['agent', 'admin'])],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
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

      const result = await agentClaimService.generateDownloadGrant(request.user!, parsed.data);

      return reply.status(200).send({
        data: result
      });
    }
  };

  for (const path of routeAliases('/agents/download-grant', '/agent/download-grant')) {
    fastify.post(path, { preHandler: handleDownloadGrant.preHandler }, handleDownloadGrant.handler);
  }

  /**
   * POST /api/v1/agent/jobs/status, /api/v1/agents/status, /api/v1/agent/jobs/:job_id/status
   * Agent reports execution status updates conforming to job-status-update-response.schema.json.
   * Accepts both uppercase and lowercase status enums, validating lease_token, pages_printed, and total_pages.
   */
  const handleStatus = {
    preHandler: [fastify.authenticate, fastify.authorize(['agent', 'admin'])],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, unknown>) || {};
      const params = (request.params as Record<string, unknown>) || {};
      const payload = {
        ...body,
        ...(params['job_id'] && !body['job_id'] ? { job_id: params['job_id'] } : {})
      };

      const parsed = jobStatusUpdateSchema.safeParse(payload);
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

      if (!parsed.data.job_id) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'job_id is required either in path or body.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const result = await agentClaimService.updateJobStatus(
        request.user!,
        parsed.data as Parameters<typeof agentClaimService.updateJobStatus>[1]
      );

      return reply.status(200).send({
        contract_version: result.contract_version || '1.0.0',
        success: result.success,
        job_id: result.job_id,
        status: result.status,
        acknowledged_at: result.acknowledged_at
      });
    }
  };

  const statusPaths = isAgentPrefixed
    ? ['/status', '/jobs/status', '/jobs/:job_id/status']
    : [
        '/agents/status',
        '/agent/status',
        '/agents/jobs/status',
        '/agent/jobs/status',
        '/agents/jobs/:job_id/status',
        '/agent/jobs/:job_id/status'
      ];

  for (const path of statusPaths) {
    fastify.post(path, { preHandler: handleStatus.preHandler }, handleStatus.handler);
  }

  /**
   * POST /api/v1/agent/leases/renew & /api/v1/agents/leases/renew
   * Agent Heartbeat & Claim Lease Extension.
   */
  const handleRenewLease = {
    preHandler: [fastify.authenticate, fastify.authorize(['agent', 'admin'])],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
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

      const result = await agentClaimService.renewLease(request.user!, parsed.data);

      return reply.status(200).send({
        data: result
      });
    }
  };

  for (const path of routeAliases('/agents/leases/renew', '/agent/leases/renew')) {
    fastify.post(path, { preHandler: handleRenewLease.preHandler }, handleRenewLease.handler);
  }

  /**
   * POST /api/v1/shops/:shopId/jobs/:jobId/approve
   * Owner Confirmation Gate (ADR 0004 MVP requirement).
   */
  if (!isAgentPrefixed) {
    fastify.post(
      '/shops/:shopId/jobs/:jobId/approve',
      {
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])]
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { jobId, shopId } = request.params as { shopId: string; jobId: string };

        const updated = await agentClaimService.approveJob(request.user!, jobId);

        return reply.status(200).send({
          success: true,
          jobId,
          shopId,
          status: 'approved',
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
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'agent', 'admin'])]
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { shopId } = request.params as { shopId: string };

        const result = await agentClaimService.reconcileExpiredLeases(shopId);

        return reply.status(200).send({
          data: result
        });
      }
    );
  }

  /**
   * POST /api/v1/agent/reconcile & /api/v1/agents/reconcile
   * Missed-event reconciliation & active lease recovery for reconnecting agent.
   */
  const handleReconcile = {
    preHandler: [fastify.authenticate, fastify.authorize(['agent', 'admin'])],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reconcileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid agent reconciliation payload.',
            request_id: request.requestId || 'unknown-request',
            details: parsed.error.errors
          }
        });
      }

      if (!realtimeSignalsService) {
        return reply.status(503).send({
          error: {
            code: 'REALTIME_SERVICE_UNAVAILABLE',
            message: 'Realtime reconciliation service not configured.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const body = parsed.data;
      const device = await pairingService.getDevice(body.device_id);
      if (!device) {
        return reply.status(404).send({
          error: {
            code: 'DEVICE_NOT_FOUND',
            message: `Agent device '${body.device_id}' not found.`,
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const result = await realtimeSignalsService.reconcileAgent(device.shop_id, body);
      return reply.status(200).send({
        data: result
      });
    }
  };

  for (const path of routeAliases('/agents/reconcile', '/agent/reconcile')) {
    fastify.post(path, { preHandler: handleReconcile.preHandler }, handleReconcile.handler);
  }

  /**
   * POST /api/v1/shops/:shopId/jobs/:jobId/resolve-unresolved
   * Shop Owner or Admin manually resolves a job stuck in 'requires_review'.
   * Prevents uncontrolled duplicate physical printing on uncertain spooler outcomes.
   */
  if (!isAgentPrefixed) {
    fastify.post(
      '/shops/:shopId/jobs/:jobId/resolve-unresolved',
      {
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])]
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { jobId } = request.params as { shopId: string; jobId: string };
        const parsed = resolveUnresolvedSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'Invalid unresolved job resolution payload.',
              request_id: request.requestId || 'unknown-request',
              details: parsed.error.errors
            }
          });
        }

        const result = await agentClaimService.resolveUnresolvedJob(
          request.user!,
          jobId,
          parsed.data.resolution,
          parsed.data.notes
        );

        return reply.status(200).send({
          data: result
        });
      }
    );

    /**
     * POST /api/v1/admin/privacy-cleanup
     * On-demand privacy retention sweeper. Purges expired documents and completed jobs.
     */
    const handlePrivacyCleanup = async (request: FastifyRequest, reply: FastifyReply) => {
      if (!privacyCleanupWorker) {
        return reply.status(503).send({
          error: {
            code: 'PRIVACY_WORKER_UNAVAILABLE',
            message: 'Privacy cleanup worker is not configured.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const { now_ms } = (request.body as { now_ms?: number } | undefined) || {};
      const result = await privacyCleanupWorker.runCleanup(now_ms);

      return reply.status(200).send({
        data: result
      });
    };

    fastify.post(
      '/admin/privacy-cleanup',
      {
        preHandler: [fastify.authenticate, fastify.authorize(['admin'])]
      },
      handlePrivacyCleanup
    );

    fastify.post(
      '/shops/:shopId/privacy-cleanup',
      {
        preHandler: [fastify.authenticate, fastify.authorize(['shop_owner', 'admin'])]
      },
      handlePrivacyCleanup
    );
  }
};
