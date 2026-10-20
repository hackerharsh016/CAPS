import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Env, validateEnv } from './config/env.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { webhookRoutes } from './modules/payments/webhook.routes.js';
import { WebhookService } from './modules/payments/webhook.service.js';
import { payAtCounterRoutes } from './modules/payments/pay-at-counter.routes.js';
import { PayAtCounterService } from './modules/payments/pay-at-counter.service.js';
import { MockPaymentsRepository, IPaymentsRepository } from './modules/payments/payments.repository.js';
import { MockPrintJobsRepository, IPrintJobsRepository } from './modules/print-jobs/print-jobs.repository.js';
import { MockShopsRepository, IShopsRepository } from './modules/shops/shops.repository.js';
import { MockPrintersRepository, IPrintersRepository } from './modules/printers/printers.repository.js';
import { createRazorpayClient, IRazorpayClient } from './modules/payments/razorpay.service.js';
import { MockJobEventsRepository, IJobEventsRepository } from './modules/events/events.repository.js';
import { QueueService } from './modules/queue/queue.service.js';
import { queueRoutes } from './modules/queue/queue.routes.js';
import { MockFirebaseClient, type IFirebaseClient } from './integrations/firebase/firebase.client.js';
import {
  MockUserFcmTokensRepository,
  type IUserFcmTokensRepository,
  MockNotificationOutboxRepository,
  type INotificationOutboxRepository
} from './modules/notifications/notifications.repository.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import {
  MockDocumentsRepository,
  type IDocumentsRepository
} from './modules/documents/documents.repository.js';
import {
  MockStorageService,
  type IStorageService
} from './modules/documents/storage.service.js';
import {
  TrustedDocumentConverter,
  type IDocumentConverter
} from './modules/documents/document-converter.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { documentsRoutes } from './modules/documents/documents.routes.js';

export interface AppOptions {
  env?: Env | undefined;
  shopsRepo?: IShopsRepository | undefined;
  printJobsRepo?: IPrintJobsRepository | undefined;
  printersRepo?: IPrintersRepository | undefined;
  paymentsRepo?: IPaymentsRepository | undefined;
  razorpayClient?: IRazorpayClient | undefined;
  jobEventsRepo?: IJobEventsRepository | undefined;
  firebaseClient?: IFirebaseClient | undefined;
  userFcmTokensRepo?: IUserFcmTokensRepository | undefined;
  notificationOutboxRepo?: INotificationOutboxRepository | undefined;
  documentsRepo?: IDocumentsRepository | undefined;
  storageService?: IStorageService | undefined;
  documentConverter?: IDocumentConverter | undefined;
  paymentsService?: PaymentsService | undefined;
  webhookService?: WebhookService | undefined;
  payAtCounterService?: PayAtCounterService | undefined;
  queueService?: QueueService | undefined;
  notificationsService?: NotificationsService | undefined;
  documentsService?: DocumentsService | undefined;
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

  // CORS configuration
  app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true
  });

  // Initialize service dependencies if not supplied
  const shopsRepo = options.shopsRepo ?? new MockShopsRepository();
  const printJobsRepo = options.printJobsRepo ?? new MockPrintJobsRepository();
  const printersRepo = options.printersRepo ?? new MockPrintersRepository();
  const paymentsRepo = options.paymentsRepo ?? new MockPaymentsRepository();
  const razorpayClient =
    options.razorpayClient ??
    createRazorpayClient({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      useMock: env.NODE_ENV === 'test' || !env.RAZORPAY_KEY_ID
    });
  const jobEventsRepo = options.jobEventsRepo ?? new MockJobEventsRepository();

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
    new QueueService(printJobsRepo, shopsRepo, printersRepo);

  const firebaseClient = options.firebaseClient ?? new MockFirebaseClient();
  const userFcmTokensRepo = options.userFcmTokensRepo ?? new MockUserFcmTokensRepository();
  const notificationOutboxRepo =
    options.notificationOutboxRepo ?? new MockNotificationOutboxRepository();
  const notificationsService =
    options.notificationsService ??
    new NotificationsService(
      firebaseClient,
      userFcmTokensRepo,
      notificationOutboxRepo,
      printJobsRepo,
      shopsRepo
    );

  const documentsRepo = options.documentsRepo ?? new MockDocumentsRepository();
  const storageService = options.storageService ?? new MockStorageService();
  const documentConverter = options.documentConverter ?? new TrustedDocumentConverter();
  const documentsService =
    options.documentsService ??
    new DocumentsService(documentsRepo, storageService, documentConverter);

  // Register feature routes under API v1 namespace
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

  app.register(queueRoutes, {
    prefix: '/api/v1',
    queueService
  });

  app.register(notificationsRoutes, {
    prefix: '/api/v1',
    notificationsService
  });

  app.register(documentsRoutes, {
    prefix: '/api/v1/documents',
    documentsService
  });

  // Health check endpoint
  app.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'caps-cloud-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  return app;
}
