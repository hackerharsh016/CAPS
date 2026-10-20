import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { buildApp } from '../src/app.js';
import { validateEnv } from '../src/config/env.js';
import { createTestJwt, SupabaseJwtVerifier } from '../src/plugins/auth.js';
import { InMemoryTracer, sanitizeTraceData } from '../src/common/telemetry/tracer.js';
import { MetricsCollector } from '../src/common/telemetry/metrics.js';
import { AlertManager } from '../src/common/telemetry/alerts.js';
import type { FastifyInstance } from 'fastify';

describe('Cloud API — Telemetry, Distributed Tracing and Incident Runbooks (P07-M02-F03)', () => {
  const jwtSecret = 'test-jwt-secret-for-telemetry-and-tracing-32-chars';
  const env = validateEnv({
    NODE_ENV: 'test',
    PORT: '4000',
    HOST: '127.0.0.1',
    SUPABASE_JWT_SECRET: jwtSecret
  });

  let app: FastifyInstance;
  let tracer: InMemoryTracer;
  let metrics: MetricsCollector;
  let alertManager: AlertManager;

  const testUserId = '11111111-1111-1111-1111-111111111111';
  const testUserToken = createTestJwt(
    { sub: testUserId, role: 'customer', app_metadata: { role: 'customer' } },
    jwtSecret
  );

  beforeAll(async () => {
    tracer = new InMemoryTracer();
    metrics = new MetricsCollector();
    alertManager = new AlertManager();

    app = buildApp({
      env,
      tokenVerifier: new SupabaseJwtVerifier(jwtSecret),
      tracer,
      metrics,
      alertManager
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    tracer.clear();
    metrics.clear();
    alertManager.clear();
  });

  describe('1. Distributed Correlation Tracing & Context Propagation', () => {
    it('propagates client-supplied X-Correlation-ID and X-Request-ID in response headers and trace spans', async () => {
      const clientCorrelationId = 'caps-corr-12345-order-abc';
      const clientRequestId = 'caps-req-67890';

      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-correlation-id': clientCorrelationId,
          'x-request-id': clientRequestId
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(clientCorrelationId);
      expect(response.headers['x-request-id']).toBe(clientRequestId);

      // Verify trace span recorded in tracer
      const spans = tracer.getTraceByCorrelationId(clientCorrelationId);
      expect(spans.length).toBeGreaterThanOrEqual(1);
      const rootSpan = spans[0];
      expect(rootSpan).toBeDefined();
      expect(rootSpan?.correlationId).toBe(clientCorrelationId);
      expect(rootSpan?.requestId).toBe(clientRequestId);
      expect(rootSpan?.status).toBe('ok');
    });

    it('generates new unique correlation and request IDs when omitted by client', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      expect(response.statusCode).toBe(200);
      const correlationId = response.headers['x-correlation-id'] as string;
      const requestId = response.headers['x-request-id'] as string;

      expect(correlationId).toBeDefined();
      expect(requestId).toBeDefined();
      expect(correlationId.length).toBeGreaterThan(10);
      expect(requestId.length).toBeGreaterThan(10);
    });
  });

  describe('2. PII, Credentials, and Document Payload Sanitization (Zero-Leak Guarantee)', () => {
    it('sanitizes raw PDF headers, buffers, and base64 document content', () => {
      const sensitivePayload = {
        file_name: 'private_passport.pdf',
        pdf_raw: '%PDF-1.4\n%Binary confidential content\n%%EOF',
        binary_buffer: Buffer.from('%PDF-1.4\nSecret content'),
        unlabelled_blob: 'JVBERi0xLjQKJVRlc3QgQ0FQUwo=', // Base64 encoding of %PDF-1.4
        base64_data: 'JVBERi0xLjQKJVRlc3QgQ0FQUwo='
      };

      const sanitized = sanitizeTraceData(sensitivePayload) as Record<string, unknown>;
      expect(sanitized.file_name).toBe('private_passport.pdf');
      expect(sanitized.pdf_raw).toBe('[REDACTED_DOCUMENT_PDF]');
      expect(sanitized.binary_buffer).toContain('[BINARY_BUFFER_REDACTED');
      expect(sanitized.unlabelled_blob).toBe('[REDACTED_DOCUMENT_BASE64_PDF]');
      expect(sanitized.base64_data).toBe('[REDACTED]');
    });

    it('sanitizes authentication JWT tokens, passwords, and payment card numbers', () => {
      const sampleJwt = testUserToken;
      const sensitivePayload = {
        user: 'alice@example.com',
        auth_token: sampleJwt,
        password: 'SuperSecretPassword123!',
        card_number: '4111-2222-3333-4444',
        razorpay_signature: 'fake_razorpay_hmac_signature_hex'
      };

      const sanitized = sanitizeTraceData(sensitivePayload) as Record<string, unknown>;
      expect(sanitized.user).toBe('alice@example.com');
      expect(sanitized.auth_token).toBe('[REDACTED]');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.card_number).toBe('[REDACTED]');
      expect(sanitized.razorpay_signature).toBe('[REDACTED]');
    });

    it('traces request and inspection endpoint without leaking Bearer tokens or PDF bytes', async () => {
      const correlationId = 'trace-no-leak-test-999';

      // 1. Manually record a trace with sensitive data
      const span = tracer.startSpan({
        name: 'ProcessDocumentOrder',
        correlationId,
        attributes: {
          file_name: 'tax_return.pdf',
          token: testUserToken,
          raw_document: '%PDF-1.4 secret content',
          payment_key: 'rzp_live_secret_key'
        }
      });

      tracer.addSpanEvent(span.spanId, 'document_verified', {
        pdf_data: '%PDF-1.4 header bytes',
        customer_jwt: testUserToken
      });

      tracer.endSpan(span.spanId, { status: 'ok' });

      // 2. Fetch trace from inspection endpoint
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/telemetry/traces/${correlationId}`
      });

      expect(response.statusCode).toBe(200);
      const traceData = response.json().data;
      expect(traceData.span_count).toBe(1);

      const spanResult = traceData.spans[0];
      // Attributes must be redacted
      expect(spanResult.attributes.file_name).toBe('tax_return.pdf');
      expect(spanResult.attributes.token).toBe('[REDACTED]');
      expect(spanResult.attributes.raw_document).toBe('[REDACTED]');
      expect(spanResult.attributes.payment_key).toBe('[REDACTED]');

      // Events must also be redacted
      expect(spanResult.events[0].data.pdf_data).toBe('[REDACTED_DOCUMENT_PDF]');
      expect(spanResult.events[0].data.customer_jwt).toBe('[REDACTED]');

      // Raw JSON string of entire response must NOT contain raw PDF or JWT
      const rawText = response.body;
      expect(rawText).not.toContain('%PDF-1.4');
      expect(rawText).not.toContain(testUserToken);
    });

    it('traces failed order without leaking credentials and marks span error status', async () => {
      const correlationId = 'failed-order-correlation-id';

      const span = tracer.startSpan({
        name: 'OrderCheckout',
        correlationId,
        attributes: {
          order_id: 'ord_12345',
          secret_token: 'secret_jwt_token'
        }
      });

      tracer.endSpan(span.spanId, {
        status: 'error',
        error: {
          code: 'PAYMENT_DECLINED',
          message: 'Insufficient balance on customer account.'
        }
      });

      const spans = tracer.getTraceByCorrelationId(correlationId);
      expect(spans.length).toBe(1);
      expect(spans[0].status).toBe('error');
      expect(spans[0].error?.code).toBe('PAYMENT_DECLINED');
      expect(spans[0].error?.message).toContain('Insufficient balance');
      expect(spans[0].attributes.secret_token).toBe('[REDACTED]');
    });
  });

  describe('3. Agent Heartbeat Telemetry & Hardware Monitoring (POST /api/v1/agents/heartbeat)', () => {
    it('accepts and records agent heartbeat telemetry', async () => {
      const agentId = 'agent-north-hub-01';
      const shopId = crypto.randomUUID();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/heartbeat',
        payload: {
          agent_id: agentId,
          shop_id: shopId,
          version: '1.2.0',
          status: 'idle',
          printers: [
            { printer_id: 'p1', name: 'HP LaserJet Pro', status: 'online' },
            { printer_id: 'p2', name: 'Canon ImageRunner', status: 'online' }
          ],
          system_info: {
            hostname: 'SHOP-PC-WIN11',
            os: 'Windows 11 Pro',
            cpu_percent: 12.5,
            memory_mb: 8192
          }
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('acknowledged');
      expect(body.agent_id).toBe(agentId);

      // Verify metrics recorded
      expect(metrics.isAgentOnline(agentId)).toBe(true);
      expect(metrics.getActiveAgents().length).toBe(1);
    });

    it('fires printer hardware error alert when agent reports paper jam or printer fault', async () => {
      const agentId = 'agent-south-hub-02';
      const shopId = crypto.randomUUID();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/heartbeat',
        payload: {
          agent_id: agentId,
          shop_id: shopId,
          version: '1.2.0',
          status: 'error',
          printers: [{ printer_id: 'p_faulty', name: 'Epson WorkForce', status: 'paper_jam' }]
        }
      });

      expect(response.statusCode).toBe(200);

      // Verify alert fired
      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.length).toBeGreaterThanOrEqual(1);
      const paperJamAlert = activeAlerts.find(a => a.rule_name.includes('p_faulty'));
      expect(paperJamAlert).toBeDefined();
      expect(paperJamAlert?.severity).toBe('warning');
      expect(paperJamAlert?.summary).toContain('paper_jam');
    });

    it('rejects invalid heartbeat payload with 400 INVALID_PAYLOAD', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/heartbeat',
        payload: {
          // Missing agent_id and shop_id
          version: '1.0.0'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_PAYLOAD');
    });
  });

  describe('4. Metrics Collection & Snapshot (GET /api/v1/telemetry/metrics)', () => {
    it('aggregates HTTP request counts, error counts, and latency statistics', async () => {
      // Execute a few test requests
      await app.inject({ method: 'GET', url: '/health' });
      await app.inject({ method: 'GET', url: '/health' });
      await app.inject({ method: 'GET', url: '/non-existent-route-for-metric' }); // 404

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/telemetry/metrics'
      });

      expect(response.statusCode).toBe(200);
      const snapshot = response.json().data;
      expect(snapshot.http_requests_total['GET /health 200']).toBeGreaterThanOrEqual(2);
      expect(snapshot.latency_ms.sample_count).toBeGreaterThanOrEqual(3);
      expect(snapshot.uptime_seconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('5. Incident Alerting & Simulation (GET & POST /api/v1/telemetry/alerts)', () => {
    it('simulates failure alert via POST /api/v1/telemetry/alerts/simulate for incident drills', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/telemetry/alerts/simulate',
        payload: {
          rule_name: 'HIGH_5XX_ERROR_RATE',
          context: {
            simulation: true,
            error_rate_percent: 45.2,
            target_service: 'caps-cloud-api'
          }
        }
      });

      expect(response.statusCode).toBe(201);
      const alert = response.json().data;
      expect(alert.rule_name).toBe('HIGH_5XX_ERROR_RATE');
      expect(alert.severity).toBe('critical');
      expect(alert.status).toBe('firing');

      // Verify active alerts query reflects the simulated incident
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/telemetry/alerts'
      });

      expect(listRes.statusCode).toBe(200);
      const activeList = listRes.json().data.active;
      expect(
        activeList.some((a: { rule_name: string }) => a.rule_name === 'HIGH_5XX_ERROR_RATE')
      ).toBe(true);
    });
  });
});
