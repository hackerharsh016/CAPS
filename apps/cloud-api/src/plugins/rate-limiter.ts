import type { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface RateLimiterOptions {
  max?: number;
  windowMs?: number;
  skip?: (request: FastifyRequest) => boolean;
  keyGenerator?: (request: FastifyRequest) => string;
}

interface ClientRecord {
  timestamps: number[];
}

export function registerRateLimiter(fastify: FastifyInstance, options: RateLimiterOptions = {}): void {
  const max = options.max ?? 100;
  const windowMs = options.windowMs ?? 60000;
  const skip = options.skip ?? ((req: FastifyRequest) => req.url === '/health' || req.url === '/ready');
  const keyGenerator =
    options.keyGenerator ??
    ((req: FastifyRequest) => {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0]!.trim();
      }
      return req.ip || '127.0.0.1';
    });

  const clientRecords = new Map<string, ClientRecord>();

  // Periodically clean up stale client records to avoid memory leaks
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, record] of clientRecords.entries()) {
      record.timestamps = record.timestamps.filter(ts => ts > cutoff);
      if (record.timestamps.length === 0) {
        clientRecords.delete(key);
      }
    }
  }, Math.max(windowMs, 30000));

  // Ensure timer does not prevent process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (skip(request)) {
      return;
    }

    const key = keyGenerator(request);
    const now = Date.now();
    const cutoff = now - windowMs;

    let record = clientRecords.get(key);
    if (!record) {
      record = { timestamps: [] };
      clientRecords.set(key, record);
    }

    // Retain only requests within the current sliding window
    record.timestamps = record.timestamps.filter(ts => ts > cutoff);

    const oldestTimestamp = record.timestamps[0] ?? now;
    const resetTimeEpochSeconds = Math.ceil((oldestTimestamp + windowMs) / 1000);

    if (record.timestamps.length >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));
      reply.header('x-ratelimit-limit', max);
      reply.header('x-ratelimit-remaining', 0);
      reply.header('x-ratelimit-reset', resetTimeEpochSeconds);
      reply.header('retry-after', retryAfterSeconds);

      return reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Limit of ${max} requests per ${Math.round(windowMs / 1000)}s exceeded. Please retry after ${retryAfterSeconds} seconds.`,
          request_id: request.requestId || 'unknown-request'
        }
      });
    }

    record.timestamps.push(now);
    const remaining = Math.max(0, max - record.timestamps.length);

    reply.header('x-ratelimit-limit', max);
    reply.header('x-ratelimit-remaining', remaining);
    reply.header('x-ratelimit-reset', resetTimeEpochSeconds);
  });
}

export const rateLimiterPlugin: FastifyPluginAsync<RateLimiterOptions> = async (
  fastify,
  options
) => {
  registerRateLimiter(fastify, options);
};

(rateLimiterPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
