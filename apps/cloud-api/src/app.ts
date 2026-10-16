import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Env, validateEnv } from './config/env.js';

export interface AppOptions {
  env?: Env;
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
