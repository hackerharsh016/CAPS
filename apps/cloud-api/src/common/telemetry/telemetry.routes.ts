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

  // 1. GET /api/v1/telemetry/metrics (Metrics snapshot)
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
