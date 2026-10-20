/**
 * Auth session storage adapter for CAPS Customer Web.
 * Synchronizes session tokens with browser cookies so Next.js Middleware and
 * Server Components can authenticate requests without client roundtrips.
 */

import type { AuthSession } from './types';

export interface AuthStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string, maxAgeSeconds?: number): void;
  removeItem(key: string): void;
}

export const SESSION_STORAGE_KEY = 'caps_auth_session';
export const ACCESS_TOKEN_COOKIE = 'sb-access-token';
export const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';

/**
 * In-memory storage adapter for testing and non-browser environments.
 */
export class MemoryStorageAdapter implements AuthStorageAdapter {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Cookie and localStorage synchronized storage adapter for browser environments.
 * Sets SameSite=Lax and Path=/ so Next.js Edge Middleware can read tokens.
 */
export class BrowserCookieStorageAdapter implements AuthStorageAdapter {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    // Try localStorage first for structured session object
    try {
      const localVal = window.localStorage.getItem(key);
      if (localVal) {
        return localVal;
      }
    } catch {
      // localStorage may be disabled or throw in restricted browsing
    }

    // Fall back to cookie lookup
    return this.getCookie(key);
  }

  setItem(key: string, value: string, maxAgeSeconds = 604800): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Persist to localStorage
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Ignore localStorage write failures (e.g. private mode quota)
    }

    // Sync cookies
    this.setCookie(key, value, maxAgeSeconds);
  }

  removeItem(key: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore
    }

    this.deleteCookie(key);
  }

  private getCookie(name: string): string | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
    return match && match[3] ? decodeURIComponent(match[3]) : null;
  }

  private setCookie(name: string, value: string, maxAgeSeconds: number): void {
    if (typeof document === 'undefined') {
      return;
    }
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
  }

  private deleteCookie(name: string): void {
    if (typeof document === 'undefined') {
      return;
    }
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

/**
 * Creates the appropriate storage adapter depending on execution context.
 */
export function createDefaultStorage(): AuthStorageAdapter {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return new BrowserCookieStorageAdapter();
  }
  return new MemoryStorageAdapter();
}

/**
 * Serializes and saves an AuthSession to storage and cookies.
 */
export function saveSessionToStorage(storage: AuthStorageAdapter, session: AuthSession): void {
  const maxAge = session.expires_in > 0 ? session.expires_in : 3600;
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session), maxAge);
  storage.setItem(ACCESS_TOKEN_COOKIE, session.access_token, maxAge);
  storage.setItem(REFRESH_TOKEN_COOKIE, session.refresh_token, 604800); // 7 days for refresh token
}

/**
 * Clears an AuthSession from storage and cookies.
 */
export function clearSessionFromStorage(storage: AuthStorageAdapter): void {
  storage.removeItem(SESSION_STORAGE_KEY);
  storage.removeItem(ACCESS_TOKEN_COOKIE);
  storage.removeItem(REFRESH_TOKEN_COOKIE);
}

/**
 * Loads an AuthSession from storage if available.
 */
export function loadSessionFromStorage(storage: AuthStorageAdapter): AuthSession | null {
  const serialized = storage.getItem(SESSION_STORAGE_KEY);
  if (!serialized) {
    return null;
  }
  try {
    return JSON.parse(serialized) as AuthSession;
  } catch {
    return null;
  }
}
