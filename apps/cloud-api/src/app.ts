import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Env, validateEnv } from './config/env.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { MockPaymentsRepository, IPaymentsRepository } from './modules/payments/payments.repository.js';
import { MockPrintJobsRepository, IPrintJobsRepository } from './modules/print-jobs/print-jobs.repository.js';
import { createRazorpayClient, IRazorpayClient } from './modules/payments/razorpay.service.js';
import { MockJobEventsRepository, IJobEventsRepository } from './modules/events/events.repository.js';

export interface AppOptions {
  env?: Env | undefined;
  printJobsRepo?: IPrintJobsRepository | undefined;
  paymentsRepo?: IPaymentsRepository | undefined;
  razorpayClient?: IRazorpayClient | undefined;
  jobEventsRepo?: IJobEventsRepository | undefined;
  paymentsService?: PaymentsService | undefined;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const env = options.env ?? validateEnv(process.env);

  const app = Fastify({
    logger: env.NODE_ENV !== 'test'
  });

  // CORS configuration
  app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true
  });

  // Initialize service dependencies if not supplied
  const printJobsRepo = options.printJobsRepo ?? new MockPrintJobsRepository();
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

  // Register feature routes under API v1 namespace
  app.register(paymentsRoutes, {
    prefix: '/api/v1/payments',
    paymentsService
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
