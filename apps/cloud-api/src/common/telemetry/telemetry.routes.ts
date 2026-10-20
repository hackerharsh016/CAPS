import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { InMemoryTracer, defaultTracer } from './tracer.js';
import { MetricsCollector, defaultMetrics } from './metrics.js';
import { AlertManager, defaultAlertManager } from './alerts.js';

export interface TelemetryPluginOptions {
  tracer?: InMemoryTracer | undefined;
  metrics?: MetricsCollector | undefined;
  alertManager?: AlertManager | undefined;
}

const heartbeatSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  agentId: z.string().optional(),
  shop_id: z.string().min(1, 'shop_id is required'),
  shopId: z.string().optional(),
  version: z.string().default('1.0.0'),
  status: z.enum(['online', 'printing', 'idle', 'offline', 'error']).default('online'),
  printers: z
    .array(
      z.object({
        printer_id: z.string(),
        name: z.string(),
        status: z.enum(['online', 'offline', 'paper_jam', 'out_of_paper', 'error'])
      })
    )
    .optional(),
  system_info: z
    .object({
      hostname: z.string().optional(),
      os: z.string().optional(),
      cpu_percent: z.number().optional(),
      memory_mb: z.number().optional()
    })
    .optional(),
  timestamp: z.string().optional()
});

const simulateAlertSchema = z.object({
  rule_name: z.string().min(1),
  context: z.record(z.unknown()).optional()
});

export const telemetryRoutes: FastifyPluginAsync<TelemetryPluginOptions> = async (
  fastify,
  options
) => {
  const tracer = options.tracer ?? defaultTracer;
  const metrics = options.metrics ?? defaultMetrics;
  const alertManager = options.alertManager ?? defaultAlertManager;

  // 1. POST /api/v1/agents/heartbeat (Agent alive / version / status signal)
  fastify.post(
    '/agents/heartbeat',
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

      const agentId = parsed.data.agent_id || parsed.data.agentId!;
      const shopId = parsed.data.shop_id || parsed.data.shopId!;

      metrics.recordAgentHeartbeat({
        agent_id: agentId,
        shop_id: shopId,
        version: parsed.data.version,
        status: parsed.data.status,
        printers: parsed.data.printers,
        system_info: parsed.data.system_info,
        timestamp: parsed.data.timestamp || new Date().toISOString()
      });

      // Clear any pending offline alert for this agent
      alertManager.resolveByRule(`PRINT_AGENT_OFFLINE_${agentId}`);

      // Check if agent reported printer paper jam or error
      if (parsed.data.printers) {
        for (const p of parsed.data.printers) {
          if (p.status === 'paper_jam' || p.status === 'error') {
            alertManager.fireAlert({
              rule_name: `PRINTER_HARDWARE_ERROR_${p.printer_id}`,
              severity: 'warning',
              summary: `Printer Hardware Issue: ${p.name} (${p.status})`,
              description: `Agent ${agentId} reported printer ${p.name} status as ${p.status}.`,
              context: { agent_id: agentId, shop_id: shopId, printer_id: p.printer_id, status: p.status }
            });
          }
        }
      }

      return reply.status(200).send({
        status: 'acknowledged',
        timestamp: new Date().toISOString(),
        agent_id: agentId,
        shop_id: shopId
      });
    }
  );

  // 2. GET /api/v1/telemetry/metrics (Metrics snapshot)
  fastify.get(
    '/telemetry/metrics',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const snapshot = metrics.getMetricsSnapshot();
      return reply.status(200).send({
        data: snapshot
      });
    }
  );

  // 3. GET /api/v1/telemetry/alerts (Active and historical alerts)
  fastify.get(
    '/telemetry/alerts',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send({
        data: {
          active: alertManager.getActiveAlerts(),
          total_alerts: alertManager.getAllAlerts().length
        }
      });
    }
  );

  // 4. POST /api/v1/telemetry/alerts/simulate (Chaos testing / simulated incident trigger)
  fastify.post(
    '/telemetry/alerts/simulate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = simulateAlertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Invalid simulate alert payload.',
            request_id: request.requestId || 'unknown-request'
          }
        });
      }

      const alert = alertManager.simulateAlert(parsed.data.rule_name, parsed.data.context);

      return reply.status(201).send({
        data: alert
      });
    }
  );

  // 5. GET /api/v1/telemetry/traces/:correlationId (Retrieve sanitized trace spans)
  fastify.get(
    '/telemetry/traces/:correlationId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { correlationId } = request.params as { correlationId: string };
      const spans = tracer.getTraceByCorrelationId(correlationId);

      return reply.status(200).send({
        data: {
          correlation_id: correlationId,
          span_count: spans.length,
          spans
        }
      });
    }
  );
};
