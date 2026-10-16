import { describe, it, expect } from 'vitest';
import { validateEnv } from '../src/config/env.js';

describe('Cloud API — Environment Validation', () => {
  it('applies standard defaults when optional variables are omitted', () => {
    const env = validateEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('correctly parses custom valid environment configuration', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      PORT: '8080',
      HOST: '127.0.0.1',
      CORS_ORIGINS: 'https://customer.caps.com, https://owner.caps.com',
      SUPABASE_URL: 'https://project.supabase.co'
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.CORS_ORIGINS).toEqual(['https://customer.caps.com', 'https://owner.caps.com']);
    expect(env.SUPABASE_URL).toBe('https://project.supabase.co');
  });

  it('rejects malformed NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'invalid_env' as unknown as 'development' })).toThrowError(
      /Environment validation failed/
    );
  });

  it('rejects invalid non-numeric or non-positive PORT values', () => {
    expect(() => validateEnv({ PORT: 'not-a-port' })).toThrowError(/Environment validation failed/);
    expect(() => validateEnv({ PORT: '-10' })).toThrowError(/Environment validation failed/);
  });

  it('rejects malformed SUPABASE_URL', () => {
    expect(() => validateEnv({ SUPABASE_URL: 'not-a-valid-url' })).toThrowError(
      /Environment validation failed/
    );
  });
});
