import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Env, validateEnv } from './config/env.js';
import { registerLogger } from './plugins/logger.js';
import { registerErrorHandlers } from './plugins/error-handler.js';
import { registerRateLimiter, RateLimiterOptions } from './plugins/rate-limiter.js';
import {
  createAuthHooks,
  ITokenVerifier,
  SupabaseJwtVerifier
} from './plugins/auth.js';
import { MockShopsRepository, IShopsRepository } from './modules/shops/shops.repository.js';
import { ShopsService } from './modules/shops/shops.service.js';
import { shopsRoutes } from './modules/shops/shops.routes.js';
import { MockPrintersRepository, IPrintersRepository } from './modules/printers/printers.repository.js';
import { PrintersService } from './modules/printers/printers.service.js';
import { printersRoutes } from './modules/printers/printers.routes.js';
import { MockDocumentsRepository, IDocumentsRepository } from './modules/documents/documents.repository.js';
import { MockStorageService, IStorageService } from './modules/documents/storage.service.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { documentsRoutes } from './modules/documents/documents.routes.js';
import { MockQuotesRepository, IQuotesRepository } from './modules/pricing/quotes.repository.js';
import { QuotesService } from './modules/pricing/quotes.service.js';
import { quotesRoutes } from './modules/pricing/quotes.routes.js';
import { MockPrintJobsRepository, IPrintJobsRepository } from './modules/print-jobs/print-jobs.repository.js';
import { PrintJobsService } from './modules/print-jobs/print-jobs.service.js';
import { printJobsRoutes } from './modules/print-jobs/print-jobs.routes.js';
import { QueueService } from './modules/queue/queue.service.js';
import { queueRoutes } from './modules/queue/queue.routes.js';
import {
  RealtimeSignalsService,
  IRealtimeBroadcaster,
  InMemoryRealtimeBroadcaster
} from './modules/queue/realtime-signals.service.js';
import { MockAgentsRepository, IAgentsRepository } from './modules/agents/agents.repository.js';
import { MockJobAttemptsRepository, IJobAttemptsRepository } from './modules/agents/attempts.repository.js';
import { AgentClaimService } from './modules/agents/agent-claim.service.js';
import { PairingService } from './modules/agents/pairing.service.js';
import { agentsRoutes } from './modules/agents/agents.routes.js';

export interface ReadinessCheckResult {
  name: string;
  ok: boolean;
  message?: string | undefined;
}

export type ReadinessCheck = () => Promise<ReadinessCheckResult> | ReadinessCheckResult;

export interface AppOptions {
  env?: Env | undefined;
  tokenVerifier?: ITokenVerifier | undefined;
  rateLimitOptions?: Partial<RateLimiterOptions> | undefined;
  readinessChecks?: ReadinessCheck[] | undefined;
  shopsRepo?: IShopsRepository | undefined;
  printersRepo?: IPrintersRepository | undefined;
  documentsRepo?: IDocumentsRepository | undefined;
  storageService?: IStorageService | undefined;
  quotesRepo?: IQuotesRepository | undefined;
  jobsRepo?: IPrintJobsRepository | undefined;
  shopsService?: ShopsService | undefined;
  printersService?: PrintersService | undefined;
  documentsService?: DocumentsService | undefined;
  quotesService?: QuotesService | undefined;
  printJobsService?: PrintJobsService | undefined;
  queueService?: QueueService | undefined;
  agentsRepo?: IAgentsRepository | undefined;
  attemptsRepo?: IJobAttemptsRepository | undefined;
  agentClaimService?: AgentClaimService | undefined;
  pairingService?: PairingService | undefined;
  realtimeBroadcaster?: IRealtimeBroadcaster | undefined;
  realtimeSignalsService?: RealtimeSignalsService | undefined;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const env = options.env ?? validateEnv(process.env);

  const app = Fastify({
    logger: env.NODE_ENV !== 'test'
  });

  // 1. Register structured logger and request-id tracing
  registerLogger(app);

  // 2. Register global error handler enforcing CAPS §5.4 error response envelope
  registerErrorHandlers(app);

  // 3. Register sliding-window rate limiter
  const rateLimitOpts: RateLimiterOptions = {
    max: options.rateLimitOptions?.max ?? env.RATE_LIMIT_MAX,
    windowMs: options.rateLimitOptions?.windowMs ?? env.RATE_LIMIT_WINDOW_MS,
    skip: options.rateLimitOptions?.skip ?? ((req) => req.url === '/health' || req.url === '/ready')
  };
  registerRateLimiter(app, rateLimitOpts);

  // 4. Supabase JWT authentication and role authorization decorators
  const tokenVerifier =
    options.tokenVerifier ?? new SupabaseJwtVerifier(env.SUPABASE_JWT_SECRET);
  const { authenticate, authorize } = createAuthHooks(tokenVerifier);
  app.decorateRequest('user', null);
  app.decorate('tokenVerifier', tokenVerifier);
  app.decorate('authenticate', authenticate);
  app.decorate('authorize', authorize);

  // 5. CORS configuration
  app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true
  });

  // 6. Initialize shop, printer, document, quote, and print-job domain repositories and services
  const shopsRepo = options.shopsRepo ?? new MockShopsRepository();
  const printersRepo = options.printersRepo ?? new MockPrintersRepository();
  const documentsRepo = options.documentsRepo ?? new MockDocumentsRepository();
  const storageService = options.storageService ?? new MockStorageService();
  const quotesRepo = options.quotesRepo ?? new MockQuotesRepository();
  const jobsRepo = options.jobsRepo ?? new MockPrintJobsRepository();
  const agentsRepo = options.agentsRepo ?? new MockAgentsRepository();
  const attemptsRepo = options.attemptsRepo ?? new MockJobAttemptsRepository();

  const shopsService =
    options.shopsService ?? new ShopsService(shopsRepo);
  const printersService =
    options.printersService ?? new PrintersService(printersRepo, shopsRepo);
  const documentsService =
    options.documentsService ?? new DocumentsService(documentsRepo, storageService);
  const quotesService =
    options.quotesService ?? new QuotesService(quotesRepo, shopsRepo);
  const printJobsService =
    options.printJobsService ??
    new PrintJobsService(jobsRepo, shopsRepo, quotesRepo, documentsRepo);
  const queueService =
    options.queueService ??
    new QueueService(jobsRepo, shopsRepo, printersRepo);
  const realtimeBroadcaster =
    options.realtimeBroadcaster ?? new InMemoryRealtimeBroadcaster();
  const realtimeSignalsService =
    options.realtimeSignalsService ??
    new RealtimeSignalsService(
      realtimeBroadcaster,
      jobsRepo,
      shopsRepo,
      agentsRepo,
      attemptsRepo,
      printersRepo
    );
  const agentClaimService =
    options.agentClaimService ??
    new AgentClaimService(
      jobsRepo,
      shopsRepo,
      printersRepo,
      agentsRepo,
      attemptsRepo,
      documentsRepo,
      realtimeSignalsService
    );
  const pairingService =
    options.pairingService ??
    new PairingService(agentsRepo, shopsRepo, agentClaimService);

  // 7. Register domain routes under API v1 namespace
  app.register(shopsRoutes, {
    prefix: '/api/v1/shops',
    shopsService
  });

  app.register(printersRoutes, {
    prefix: '/api/v1/shops',
    printersService
  });

  app.register(queueRoutes, {
    prefix: '/api/v1/shops',
    queueService,
    realtimeSignalsService
  });

  app.register(agentsRoutes, {
    prefix: '/api/v1',
    agentClaimService,
    pairingService,
    realtimeSignalsService
  });

  app.register(documentsRoutes, {
    prefix: '/api/v1/documents',
    documentsService,
    storageService
  });

  app.register(quotesRoutes, {
    prefix: '/api/v1/quotes',
    quotesService
  });

  app.register(printJobsRoutes, {
    prefix: '/api/v1/print-jobs',
    printJobsService
  });

  // 8. Auth verification & role testing routes
  app.get(
    '/api/v1/auth/me',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      return reply.status(200).send({
        data: {
          user: request.user
        }
      });
    }
  );

  app.get(
    '/api/v1/auth/owner-only',
    { preHandler: [app.authenticate, app.authorize(['shop_owner', 'admin'])] },
    async (request, reply) => {
      return reply.status(200).send({
        data: {
          access: 'granted',
          role: request.user?.role
        }
      });
    }
  );

  app.get(
    '/api/v1/auth/agent-only',
    { preHandler: [app.authenticate, app.authorize(['agent', 'admin'])] },
    async (request, reply) => {
      return reply.status(200).send({
        data: {
          access: 'granted',
          role: request.user?.role
        }
      });
    }
  );

  // 9. Liveness check endpoint
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'caps-cloud-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // 10. Readiness check endpoint with dependency checks
  const defaultReadinessChecks: ReadinessCheck[] = [
    () => ({
      name: 'database',
      ok: Boolean(
        shopsRepo &&
          printersRepo &&
          documentsRepo &&
          quotesRepo &&
          jobsRepo &&
          queueService &&
          agentsRepo &&
          attemptsRepo &&
          agentClaimService &&
          pairingService &&
          realtimeSignalsService
      ),
      message: 'Repositories operational'
    }),
    () => ({
      name: 'storage',
      ok: Boolean(storageService),
      message: 'Document storage operational'
    }),
    () => {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      return {
        name: 'memory',
        ok: heapUsedMB < 1024,
        message: `Heap used: ${heapUsedMB} MB`
      };
    }
  ];

  const readinessChecks = options.readinessChecks ?? defaultReadinessChecks;

  app.get('/ready', async (_request, reply) => {
    const results: Record<string, string> = {};
    const errors: string[] = [];

    for (const check of readinessChecks) {
      try {
        const res = await check();
        results[res.name] = res.ok ? 'ok' : 'error';
        if (!res.ok) {
          errors.push(res.message ? `${res.name}: ${res.message}` : `${res.name} check failed`);
        }
      } catch (err) {
        results['unknown'] = 'error';
        errors.push(err instanceof Error ? err.message : 'Unknown check failure');
      }
    }

    const isHealthy = errors.length === 0;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? 'ready' : 'unhealthy',
      service: 'caps-cloud-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: results,
      ...(errors.length > 0 ? { errors } : {})
    });
  });

  return app;
}
