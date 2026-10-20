/**
 * Supabase client factory and configuration for CAPS Customer Web.
 * Enforces browser/server client separation and security invariants.
 *
 * Invariant: SUPABASE_SERVICE_ROLE_KEY is strictly forbidden in customer web bundles.
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
  // Check if someone accidentally embedded service role key into process.env in client
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

  const env = typeof process !== 'undefined' ? process.env : undefined;

  const supabaseUrl =
    (env ? env['NEXT_PUBLIC_SUPABASE_URL'] : undefined) ||
    'http://localhost:54321';

  const supabaseAnonKey =
    (env ? env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] : undefined) ||
    'mock-anon-key-caps-customer-web';

  return { supabaseUrl, supabaseAnonKey };
}

let browserClientInstance: SupabaseAuthClient | null = null;

/**
 * Returns a singleton SupabaseAuthClient for browser/client-side execution.
 * Synchronizes sessions across browser tabs, cookies, and localStorage.
 */
export function getSupabaseBrowserClient(options?: {
  customFetch?: typeof fetch | undefined;
  storage?: AuthStorageAdapter | undefined;
}): SupabaseAuthClient {
  assertNoServerSecrets();

  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();

  if (typeof window === 'undefined') {
    // In server environment, create an isolated non-singleton client
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
 * Creates an isolated server-side SupabaseAuthClient.
 * Reads cookies from an incoming request without mutating global memory.
 */
export function createSupabaseServerClient(cookieHeader?: string): SupabaseAuthClient {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  const memoryStorage = new MemoryStorageAdapter();

  if (cookieHeader) {
    // Populate session tokens from request cookie header if present
    const matchAccess = cookieHeader.match(/(^|;\s*)sb-access-token=([^;]*)/);
    const matchRefresh = cookieHeader.match(/(^|;\s*)sb-refresh-token=([^;]*)/);
    const matchSession = cookieHeader.match(/(^|;\s*)caps_auth_session=([^;]*)/);

    if (matchAccess && matchAccess[2]) {
      memoryStorage.setItem('sb-access-token', decodeURIComponent(matchAccess[2]));
    }
    if (matchRefresh && matchRefresh[2]) {
      memoryStorage.setItem('sb-refresh-token', decodeURIComponent(matchRefresh[2]));
    }
    if (matchSession && matchSession[2]) {
      memoryStorage.setItem('caps_auth_session', decodeURIComponent(matchSession[2]));
    }
  }

  return new SupabaseAuthClient({
    supabaseUrl,
    supabaseAnonKey,
    storage: memoryStorage
  });
}

/**
 * Resets the cached singleton client (primarily for testing).
 */
export function _resetBrowserClient(): void {
  browserClientInstance = null;
}
