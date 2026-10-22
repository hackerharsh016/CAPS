import { buildApp } from './app.js';
import { validateEnv, tryLoadLocalEnv } from './config/env.js';

async function bootstrap() {
  tryLoadLocalEnv();
  const env = validateEnv(process.env);
  const app = buildApp({ env });

  try {
    const address = await app.listen({ host: env.HOST, port: env.PORT });
    app.log.info(`[CAPS Cloud API] Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`[CAPS Cloud API] Received ${signal}, closing server...`);
      await app.close();
      process.exit(0);
    });
  }
}

bootstrap().catch(err => {
  console.error('[CAPS Cloud API] Fatal bootstrap error:', err);
  process.exit(1);
});
