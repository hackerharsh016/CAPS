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

// Domain Repositories & Services
import { MockShopsRepository, IShopsRepository } from './modules/shops/shops.repository.js';
import { ShopsService } from './modules/shops/shops.service.js';
import { shopsRoutes } from './modules/shops/shops.routes.js';

import { MockPrintersRepository, IPrintersRepository } from './modules/printers/printers.repository.js';
import { PrintersService } from './modules/printers/printers.service.js';
import { printersRoutes } from './modules/printers/printers.routes.js';

import { MockDocumentsRepository, IDocumentsRepository } from './modules/documents/documents.repository.js';
import { MockStorageService, IStorageService } from './modules/documents/storage.service.js';
import {
  TrustedDocumentConverter,
  IDocumentConverter
} from './modules/documents/document-converter.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { documentsRoutes } from './modules/documents/documents.routes.js';
import { PrivacyRetentionService } from './modules/documents/privacy-retention.service.js';
import { privacyCleanupRoutes } from './modules/documents/privacy-cleanup.routes.js';

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

import { MockPaymentsRepository, IPaymentsRepository } from './modules/payments/payments.repository.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { WebhookService } from './modules/payments/webhook.service.js';
import { webhookRoutes } from './modules/payments/webhook.routes.js';
import { PayAtCounterService } from './modules/payments/pay-at-counter.service.js';
import { payAtCounterRoutes } from './modules/payments/pay-at-counter.routes.js';
import { createRazorpayClient, IRazorpayClient } from './modules/payments/razorpay.service.js';

import {
  MockJobEventsRepository,
  IJobEventsRepository,
  MockDocumentDeletionLogsRepository,
  IDocumentDeletionLogsRepository
} from './modules/events/events.repository.js';

import { MockFirebaseClient, type IFirebaseClient } from './integrations/firebase/firebase.client.js';
import {
  MockUserFcmTokensRepository,
  type IUserFcmTokensRepository,
  MockNotificationOutboxRepository,
  type INotificationOutboxRepository
} from './modules/notifications/notifications.repository.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';

import { DocumentCleanupJob } from './jobs/document-cleanup.job.js';
import { PrivacyCleanupWorker } from './jobs/privacy-cleanup.worker.js';

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
  jobsRepo?: IPrintJobsRepository | undefined;
  printJobsRepo?: IPrintJobsRepository | undefined;
  printersRepo?: IPrintersRepository | undefined;
  documentsRepo?: IDocumentsRepository | undefined;
  storageService?: IStorageService | undefined;
  documentConverter?: IDocumentConverter | undefined;
  quotesRepo?: IQuotesRepository | undefined;
  paymentsRepo?: IPaymentsRepository | undefined;
  razorpayClient?: IRazorpayClient | undefined;
  jobEventsRepo?: IJobEventsRepository | undefined;
  deletionLogsRepo?: IDocumentDeletionLogsRepository | undefined;
  firebaseClient?: IFirebaseClient | undefined;
  userFcmTokensRepo?: IUserFcmTokensRepository | undefined;
  notificationOutboxRepo?: INotificationOutboxRepository | undefined;
  agentsRepo?: IAgentsRepository | undefined;
  attemptsRepo?: IJobAttemptsRepository | undefined;
  shopsService?: ShopsService | undefined;
  printersService?: PrintersService | undefined;
  documentsService?: DocumentsService | undefined;
  privacyRetentionService?: PrivacyRetentionService | undefined;
  quotesService?: QuotesService | undefined;
  printJobsService?: PrintJobsService | undefined;
  paymentsService?: PaymentsService | undefined;
  webhookService?: WebhookService | undefined;
  payAtCounterService?: PayAtCounterService | undefined;
  queueService?: QueueService | undefined;
  notificationsService?: NotificationsService | undefined;
  documentCleanupJob?: DocumentCleanupJob | undefined;
  agentClaimService?: AgentClaimService | undefined;
  pairingService?: PairingService | undefined;
  realtimeBroadcaster?: IRealtimeBroadcaster | undefined;
  realtimeSignalsService?: RealtimeSignalsService | undefined;
  privacyCleanupWorker?: PrivacyCleanupWorker | undefined;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const env = options.env ?? validateEnv(process.env);

  const app = Fastify({
    logger: env.NODE_ENV !== 'test'
  });

  // Preserve raw body buffer for secure HMAC-SHA256 webhook signature validation
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const raw = body.toString('utf-8');
        (req as unknown as { rawBody: string }).rawBody = raw;
        const json = raw.trim().length === 0 ? {} : JSON.parse(raw);
        done(null, json);
      } catch (err: unknown) {
        const error = err as Error & { statusCode?: number };
        error.statusCode = 400;
        done(error, undefined);
      }
    }
  );

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

  // 6. Initialize repositories
  const shopsRepo = options.shopsRepo ?? new MockShopsRepository();
  const printersRepo = options.printersRepo ?? new MockPrintersRepository();
  const jobsRepo = options.jobsRepo ?? options.printJobsRepo ?? new MockPrintJobsRepository();
  const printJobsRepo = jobsRepo;
  const paymentsRepo = options.paymentsRepo ?? new MockPaymentsRepository();
  const razorpayClient =
    options.razorpayClient ??
    createRazorpayClient({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      useMock: env.NODE_ENV === 'test' || !env.RAZORPAY_KEY_ID
    });
  const jobEventsRepo = options.jobEventsRepo ?? new MockJobEventsRepository();
  const deletionLogsRepo =
    options.deletionLogsRepo ?? new MockDocumentDeletionLogsRepository();
  const firebaseClient = options.firebaseClient ?? new MockFirebaseClient();
  const userFcmTokensRepo =
    options.userFcmTokensRepo ?? new MockUserFcmTokensRepository();
  const notificationOutboxRepo =
    options.notificationOutboxRepo ?? new MockNotificationOutboxRepository();
  const documentsRepo = options.documentsRepo ?? new MockDocumentsRepository();
  const storageService = options.storageService ?? new MockStorageService();
  const documentConverter =
    options.documentConverter ?? new TrustedDocumentConverter();
  const quotesRepo = options.quotesRepo ?? new MockQuotesRepository();
  const agentsRepo = options.agentsRepo ?? new MockAgentsRepository();
  const attemptsRepo = options.attemptsRepo ?? new MockJobAttemptsRepository();

  // 7. Initialize domain services
  const shopsService = options.shopsService ?? new ShopsService(shopsRepo);
  const printersService =
    options.printersService ?? new PrintersService(printersRepo, shopsRepo);
  const documentsService =
    options.documentsService ??
    new DocumentsService(documentsRepo, storageService, documentConverter);
  const quotesService =
    options.quotesService ?? new QuotesService(quotesRepo, shopsRepo);
  const printJobsService =
    options.printJobsService ??
    new PrintJobsService(jobsRepo, shopsRepo, quotesRepo, documentsRepo);
  const paymentsService =
    options.paymentsService ??
    new PaymentsService(printJobsRepo, paymentsRepo, razorpayClient, jobEventsRepo);
  const webhookSecret =
    env.RAZORPAY_WEBHOOK_SECRET ?? 'mock_webhook_secret_for_testing';
  const webhookService =
    options.webhookService ??
    new WebhookService(
      printJobsRepo,
      paymentsRepo,
      razorpayClient,
      jobEventsRepo,
      webhookSecret
    );
  const payAtCounterService =
    options.payAtCounterService ??
    new PayAtCounterService(shopsRepo, printJobsRepo, paymentsRepo, jobEventsRepo);
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
      realtimeSignalsService,
      storageService
    );
  const pairingService =
    options.pairingService ??
    new PairingService(agentsRepo, shopsRepo, agentClaimService);
  const notificationsService =
    options.notificationsService ??
    new NotificationsService(
      firebaseClient,
      userFcmTokensRepo,
      notificationOutboxRepo,
      printJobsRepo,
      shopsRepo
    );
  const privacyRetentionService =
    options.privacyRetentionService ??
    new PrivacyRetentionService(
      printJobsRepo,
      documentsRepo,
      storageService,
      deletionLogsRepo,
      jobEventsRepo
    );
  const privacyCleanupWorker =
    options.privacyCleanupWorker ??
    new PrivacyCleanupWorker({
      printJobsRepo: jobsRepo,
      documentsRepo,
      storageService
    });

  // 8. Register feature routes under API v1 namespace
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
    realtimeSignalsService,
    privacyCleanupWorker
  });

  app.register(documentsRoutes, {
    prefix: '/api/v1/documents',
    documentsService,
    storageService
  });

  app.register(privacyCleanupRoutes, {
    prefix: '/api/v1/documents',
    privacyService: privacyRetentionService
  });

  app.register(quotesRoutes, {
    prefix: '/api/v1/quotes',
    quotesService
  });

  app.register(printJobsRoutes, {
    prefix: '/api/v1/print-jobs',
    printJobsService
  });

  app.register(paymentsRoutes, {
    prefix: '/api/v1/payments',
    paymentsService
  });

  app.register(webhookRoutes, {
    prefix: '/api/v1',
    webhookService
  });

  app.register(payAtCounterRoutes, {
    prefix: '/api/v1',
    payAtCounterService
  });

  app.register(notificationsRoutes, {
    prefix: '/api/v1',
    notificationsService
  });

  // 9. Auth verification & role testing routes
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

  // 10. Liveness check endpoint
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'caps-cloud-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // 11. Readiness check endpoint with dependency checks
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
          realtimeSignalsService &&
          paymentsRepo &&
          jobEventsRepo
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
