import crypto from 'node:crypto';

export interface TraceAttributes {
  [key: string]: unknown;
}

export interface TraceSpan {
  spanId: string;
  traceId: string;
  parentSpanId?: string | undefined;
  name: string;
  correlationId: string;
  requestId?: string | undefined;
  jobId?: string | undefined;
  attemptId?: string | undefined;
  shopId?: string | undefined;
  userId?: string | undefined;
  attributes: TraceAttributes;
  events: Array<{ name: string; timestamp: string; data?: unknown }>;
  startTimeMs: number;
  endTimeMs?: number | undefined;
  durationMs?: number | undefined;
  status: 'ok' | 'error';
  error?: {
    code?: string | undefined;
    message: string;
    stack?: string | undefined;
  } | undefined;
}

const SENSITIVE_KEY_REGEX =
  /(password|current_password|new_password|token|secret|jwt|api_key|payment_key|key|razorpay_signature|auth|authorization|cookie|set_cookie|credit_card|card_number|cvv|pdf_content|raw_document|file_bytes|document_data|base64)/i;

const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BASE64_PDF_PATTERN = /^JVBERi0/; // Base64 encoding of "%PDF-"

/**
 * Deeply sanitizes payloads to ensure zero leakage of PII, secrets, or document binaries.
 */
export function sanitizeTraceData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (Buffer.isBuffer(data)) {
    return `[BINARY_BUFFER_REDACTED len=${data.length}]`;
  }

  if (typeof data === 'string') {
    if (data.startsWith('%PDF-')) {
      return '[REDACTED_DOCUMENT_PDF]';
    }
    if (BASE64_PDF_PATTERN.test(data)) {
      return '[REDACTED_DOCUMENT_BASE64_PDF]';
    }
    if (JWT_PATTERN.test(data)) {
      return '[REDACTED_JWT]';
    }
    // Credit card number pattern (13-16 digits with optional dashes/spaces)
    if (/^\b(?:\d[ -]*?){13,16}\b$/.test(data)) {
      return '[REDACTED_PAYMENT_CARD]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeTraceData(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeTraceData(value);
      }
    }
    return sanitized;
  }

  return data;
}

export class InMemoryTracer {
  private readonly spans = new Map<string, TraceSpan>();
  private readonly correlationMap = new Map<string, string[]>(); // correlationId -> spanIds[]
  private readonly maxSpans: number;

  constructor(maxSpans = 5000) {
    this.maxSpans = maxSpans;
  }

  startSpan(params: {
    name: string;
    correlationId: string;
    requestId?: string | undefined;
    jobId?: string | undefined;
    attemptId?: string | undefined;
    shopId?: string | undefined;
    userId?: string | undefined;
    parentSpanId?: string | undefined;
    attributes?: TraceAttributes | undefined;
  }): TraceSpan {
    const spanId = crypto.randomUUID();
    const traceId = params.correlationId; // Use correlation ID as root trace identifier

    const span: TraceSpan = {
      spanId,
      traceId,
      parentSpanId: params.parentSpanId,
      name: params.name,
      correlationId: params.correlationId,
      requestId: params.requestId,
      jobId: params.jobId,
      attemptId: params.attemptId,
      shopId: params.shopId,
      userId: params.userId,
      attributes: (sanitizeTraceData(params.attributes || {}) as TraceAttributes) || {},
      events: [],
      startTimeMs: Date.now(),
      status: 'ok'
    };

    if (this.spans.size >= this.maxSpans) {
      // Evict oldest span
      const oldestKey = this.spans.keys().next().value;
      if (oldestKey) {
        this.spans.delete(oldestKey);
      }
    }

    this.spans.set(spanId, span);

    const spanList = this.correlationMap.get(params.correlationId) || [];
    spanList.push(spanId);
    this.correlationMap.set(params.correlationId, spanList);

    return span;
  }

  addSpanEvent(spanId: string, eventName: string, eventData?: unknown): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.events.push({
        name: eventName,
        timestamp: new Date().toISOString(),
        data: sanitizeTraceData(eventData)
      });
    }
  }

  endSpan(
    spanId: string,
    outcome?: { status?: 'ok' | 'error'; error?: Error | { code?: string; message: string } }
  ): TraceSpan | null {
    const span = this.spans.get(spanId);
    if (!span) return null;

    span.endTimeMs = Date.now();
    span.durationMs = Math.max(0, span.endTimeMs - span.startTimeMs);

    if (outcome?.status) {
      span.status = outcome.status;
    }
    if (outcome?.error) {
      span.status = 'error';
      span.error = {
        code: 'code' in outcome.error ? outcome.error.code : undefined,
        message: outcome.error.message
      };
    }

    return span;
  }

  getSpan(spanId: string): TraceSpan | null {
    const span = this.spans.get(spanId);
    return span ? { ...span } : null;
  }

  getTraceByCorrelationId(correlationId: string): TraceSpan[] {
    const spanIds = this.correlationMap.get(correlationId) || [];
    return spanIds
      .map(id => this.spans.get(id))
      .filter((s): s is TraceSpan => s !== undefined)
      .map(s => ({ ...s }));
  }

  clear(): void {
    this.spans.clear();
    this.correlationMap.clear();
  }
}

export const defaultTracer = new InMemoryTracer();
