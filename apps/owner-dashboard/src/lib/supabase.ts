/**
 * Supabase client factory and configuration for CAPS Shop Owner Dashboard.
 * Enforces browser/server client separation and security invariants.
 *
 * Invariant: SUPABASE_SERVICE_ROLE_KEY is strictly forbidden in owner web bundles.
 */

import { SupabaseAuthClient } from '../features/auth/supabase-auth-client';
import {
  BrowserCookieStorageAdapter,
  MemoryStorageAdapter,
  type AuthStorageAdapter
} from '../features/auth/storage';

export interface SupabaseEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/**
 * Asserts that server service-role keys are never leaked to client bundles.
 */
function assertNoServerSecrets(): void {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  if (env && ('SUPABASE_SERVICE_ROLE_KEY' in env || 'SERVICE_ROLE_KEY' in env)) {
    throw new Error(
      'SECURITY VIOLATION: SUPABASE_SERVICE_ROLE_KEY is present in client runtime environment! This key must NEVER be exposed to web clients.'
    );
  }
}

/**
 * Validates and retrieves browser-safe Supabase configuration.
 */
export function getSupabaseEnv(): SupabaseEnvConfig {
  assertNoServerSecrets();

  const supabaseUrl =
    process.env['NEXT_PUBLIC_SUPABASE_URL'] || 'http://localhost:54321';

  const supabaseAnonKey =
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || 'mock-anon-key-caps-owner-dashboard';

  return { supabaseUrl, supabaseAnonKey };
}

let browserClientInstance: SupabaseAuthClient | null = null;

/**
 * Returns a singleton SupabaseAuthClient for browser execution.
 */
export function getSupabaseBrowserClient(options?: {
  customFetch?: typeof fetch | undefined;
  storage?: AuthStorageAdapter | undefined;
}): SupabaseAuthClient {
  assertNoServerSecrets();

  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  if (typeof window === 'undefined') {
    // In SSR / server execution, return isolated non-singleton client
    const config: {
      supabaseUrl: string;
      supabaseAnonKey: string;
      storage: AuthStorageAdapter;
      customFetch?: typeof fetch | undefined;
    } = {
      supabaseUrl,
      supabaseAnonKey,
      storage: options?.storage ?? new MemoryStorageAdapter()
    };
    if (options?.customFetch !== undefined) {
      config.customFetch = options.customFetch;
    }
    return new SupabaseAuthClient(config);
  }

  if (!browserClientInstance) {
    const config: {
      supabaseUrl: string;
      supabaseAnonKey: string;
      storage: AuthStorageAdapter;
      customFetch?: typeof fetch | undefined;
    } = {
      supabaseUrl,
      supabaseAnonKey,
      storage: options?.storage ?? new BrowserCookieStorageAdapter()
    };
    if (options?.customFetch !== undefined) {
      config.customFetch = options.customFetch;
    }
    browserClientInstance = new SupabaseAuthClient(config);
  }

  return browserClientInstance;
}

/**
 * Resets the cached singleton client (useful for unit testing).
 */
export function resetSupabaseBrowserClient(): void {
  browserClientInstance = null;
}
