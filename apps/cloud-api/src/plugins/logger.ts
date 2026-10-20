import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { defaultTracer, sanitizeTraceData, type InMemoryTracer } from '../common/telemetry/tracer.js';
import { defaultMetrics, type MetricsCollector } from '../common/telemetry/metrics.js';
import { defaultAlertManager, type AlertManager } from '../common/telemetry/alerts.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    correlationId: string;
  }
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-supabase-key',
  'x-razorpay-signature'
]);

/**
 * Deeply sanitizes payloads to protect sensitive credentials and document contents.
 */
export function redactSensitiveData(data: unknown): unknown {
  return sanitizeTraceData(data);
}

/**
 * Sanitizes HTTP headers for logging.
 */
export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface LoggerPluginOptions {
  tracer?: InMemoryTracer | undefined;
  metrics?: MetricsCollector | undefined;
  alertManager?: AlertManager | undefined;
}

export function registerLogger(fastify: FastifyInstance, options: LoggerPluginOptions = {}): void {
  const tracer = options.tracer ?? defaultTracer;
  const metrics = options.metrics ?? defaultMetrics;
  const alertManager = options.alertManager ?? defaultAlertManager;

  if (!fastify.hasRequestDecorator('requestId')) {
    fastify.decorateRequest('requestId', '');
  }
  if (!fastify.hasRequestDecorator('correlationId')) {
    fastify.decorateRequest('correlationId', '');
  }

  // Propagate or generate request ID and correlation ID and attach to headers
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerReqId = request.headers['x-request-id'];
    const requestId =
      typeof headerReqId === 'string' && headerReqId.trim().length > 0
        ? headerReqId.trim()
        : crypto.randomUUID();

    const headerCorrId = request.headers['x-correlation-id'];
    const correlationId =
      typeof headerCorrId === 'string' && headerCorrId.trim().length > 0
        ? headerCorrId.trim()
        : requestId;

    request.requestId = requestId;
    request.correlationId = correlationId;
    request.id = requestId;

    reply.header('x-request-id', requestId);
    reply.header('x-correlation-id', correlationId);

    // Start distributed span for request
    const span = tracer.startSpan({
      name: `${request.method} ${request.url}`,
      correlationId,
      requestId,
      attributes: {
        method: request.method,
        url: request.url,
        ip: request.ip
      }
    });

    (request as unknown as Record<string, unknown>)['__spanId'] = span.spanId;
  });

  // Log completion of request with structured, redacted telemetry and record metrics
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const durationMs = reply.elapsedTime;
    const spanId = (request as unknown as Record<string, unknown>)['__spanId'] as string | undefined;

    if (spanId) {
      tracer.endSpan(spanId, {
        status: reply.statusCode >= 400 ? 'error' : 'ok'
      });
    }

    const routePattern = request.routeOptions?.url || request.url;
    metrics.recordHttpRequest(request.method, routePattern, reply.statusCode, durationMs);

    if (reply.statusCode >= 500) {
      alertManager.fireAlert({
        rule_name: 'HIGH_5XX_ERROR_RATE',
        severity: 'critical',
        summary: `HTTP 5xx Server Error on ${request.method} ${routePattern}`,
        description: `Server responded with status ${reply.statusCode} during request processing.`,
        context: {
          request_id: request.requestId,
          correlation_id: request.correlationId,
          status_code: reply.statusCode,
          route: routePattern
        }
      });
    }

    request.log.info({
      type: 'audit_log',
      request_id: request.requestId,
      correlation_id: request.correlationId,
      method: request.method,
      url: request.url,
      status_code: reply.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      ip: request.ip
    });
  });
}

export const loggerPlugin: FastifyPluginAsync<LoggerPluginOptions> = async (fastify, opts) => {
  registerLogger(fastify, opts);
};

(loggerPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
