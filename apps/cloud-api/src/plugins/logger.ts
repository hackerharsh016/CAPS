import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

/**
 * Sensitive field patterns that must never be recorded in audit logs.
 * Covers authentication secrets, raw payment keys, and binary/document content.
 */
const SENSITIVE_KEY_REGEX =
  /(password|current_password|new_password|token|secret|jwt|api_key|key_secret|razorpay_signature|raw_document|pdf_content|file_bytes|document_data|base64)/i;

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
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = redactSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
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

export function registerLogger(fastify: FastifyInstance): void {
  if (!fastify.hasRequestDecorator('requestId')) {
    fastify.decorateRequest('requestId', '');
  }

  // Propagate or generate request ID and attach to request and reply headers
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const headerId = request.headers['x-request-id'];
    const requestId =
      typeof headerId === 'string' && headerId.trim().length > 0
        ? headerId.trim()
        : crypto.randomUUID();

    request.requestId = requestId;
    request.id = requestId;
    reply.header('x-request-id', requestId);
  });

  // Log completion of request with structured, redacted telemetry
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const durationMs = reply.elapsedTime;
    request.log.info({
      type: 'audit_log',
      request_id: request.requestId,
      method: request.method,
      url: request.url,
      status_code: reply.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      ip: request.ip
    });
  });
}

export const loggerPlugin: FastifyPluginAsync = async fastify => {
  registerLogger(fastify);
};

(loggerPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
