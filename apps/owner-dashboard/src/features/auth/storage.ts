/**
 * Storage adapter interface and implementations for CAPS Owner Dashboard.
 * Synchronizes session tokens with browser cookies so Next.js Edge Middleware
 * can inspect auth state server-side without extra network roundtrips.
 */

import type { AuthSession } from './types';

export interface AuthStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  getSession: () => AuthSession | null;
  setSession: (session: AuthSession) => void;
  removeSession: () => void;
}

const SESSION_STORAGE_KEY = 'caps_owner_auth_session';
const ACCESS_TOKEN_COOKIE = 'sb-access-token';
const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';
const SESSION_COOKIE = 'caps_auth_session';
const ROLE_COOKIE = 'caps_user_role';

export class MemoryStorageAdapter implements AuthStorageAdapter {
  private storage = new Map<string, string>();

  getItem(key: string): string | null {
    return this.storage.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }

  getSession(): AuthSession | null {
    const raw = this.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthSession;
    } catch {
      return null;
    }
  }

  setSession(session: AuthSession): void {
    this.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  removeSession(): void {
    this.removeItem(SESSION_STORAGE_KEY);
  }
}

export class BrowserCookieStorageAdapter implements AuthStorageAdapter {
  getItem(key: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage may fail in restricted/private modes
    }
  }

  removeItem(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  getSession(): AuthSession | null {
    const raw = this.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return this.readSessionFromCookies();
    }
    try {
      return JSON.parse(raw) as AuthSession;
    } catch {
      return this.readSessionFromCookies();
    }
  }

  setSession(session: AuthSession): void {
    this.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    this.writeSessionCookies(session);
  }

  removeSession(): void {
    this.removeItem(SESSION_STORAGE_KEY);
    this.clearSessionCookies();
  }

  private writeSessionCookies(session: AuthSession): void {
    if (typeof document === 'undefined') return;

    const maxAge = Math.max(0, session.expires_at - Math.floor(Date.now() / 1000));
    const role =
      (session.user.user_metadata?.['role'] as string | undefined) ??
      (session.user.app_metadata?.['role'] as string | undefined) ??
      'shop_owner';

    document.cookie = `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(session.access_token)}; path=/; max-age=${maxAge}; SameSite=Lax`;
    document.cookie = `${REFRESH_TOKEN_COOKIE}=${encodeURIComponent(session.refresh_token)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${maxAge}; SameSite=Lax`;
    document.cookie = `${ROLE_COOKIE}=${encodeURIComponent(role)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  }

  private clearSessionCookies(): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${ACCESS_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    document.cookie = `${REFRESH_TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }

  private readSessionFromCookies(): AuthSession | null {
    if (typeof document === 'undefined') return null;

    const cookies = document.cookie.split(';').reduce<Record<string, string>>((acc, pair) => {
      const [k, v] = pair.trim().split('=');
      if (k && v) {
        acc[k] = decodeURIComponent(v);
      }
      return acc;
    }, {});

    const accessToken = cookies[ACCESS_TOKEN_COOKIE];
    const refreshToken = cookies[REFRESH_TOKEN_COOKIE];
    const roleCookie =
      (cookies[ROLE_COOKIE] as 'customer' | 'shop_owner' | 'admin') || 'shop_owner';

    if (!accessToken) return null;

    return {
      access_token: accessToken,
      refresh_token: refreshToken ?? '',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: 'cookie-session-user',
        email: undefined,
        user_metadata: { role: roleCookie },
        created_at: new Date().toISOString()
      }
    };
  }
}
