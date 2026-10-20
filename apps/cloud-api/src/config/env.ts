import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001')
    .transform(val => val.split(',').map(s => s.trim())),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10).optional(),
  SUPABASE_JWT_SECRET: z
    .string()
    .min(16)
    .default('caps-jwt-secret-dev-and-testing-default-at-least-32-chars'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map(err => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`[CAPS Cloud API] Environment validation failed:\n${errorDetails}`);
  }
  return result.data;
}
