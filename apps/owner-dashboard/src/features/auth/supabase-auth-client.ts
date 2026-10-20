/**
 * Typed Supabase Auth client for CAPS Shop Owner Dashboard.
 * Enforces role guards upon authentication to prevent customers from
 * accessing shop owner capabilities.
 *
 * Security Invariant: SUPABASE_SERVICE_ROLE_KEY is strictly forbidden.
 */

import type {
  AuthError,
  AuthSession,
  AuthUser,
  UserProfile,
  UserRole,
  AuthChangeEvent,
  AuthStateChangeCallback
} from './types';
import type { AuthStorageAdapter } from './storage';
import { MemoryStorageAdapter } from './storage';

export interface SupabaseAuthClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  storage?: AuthStorageAdapter | undefined;
  customFetch?: typeof fetch | undefined;
}

export interface SignInCredentials {
  email: string;
  password?: string | undefined;
}

export class RoleGuardError extends Error {
  readonly code = 'ROLE_NOT_AUTHORIZED';
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'RoleGuardError';
  }
}

export class SupabaseAuthClient {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly storage: AuthStorageAdapter;
  private readonly fetchFn: typeof fetch;
  private listeners: Set<AuthStateChangeCallback> = new Set();
  private currentSession: AuthSession | null = null;
  private currentUserProfile: UserProfile | null = null;

  constructor(config: SupabaseAuthClientConfig) {
    if (!config.supabaseUrl) {
      throw new Error('SupabaseAuthClient requires a valid supabaseUrl.');
    }
    if (!config.supabaseAnonKey) {
      throw new Error('SupabaseAuthClient requires a valid supabaseAnonKey.');
    }

    // Invariant: Fail loud if service role key is mistakenly supplied
    if (
      config.supabaseAnonKey.includes('service_role') ||
      (typeof process !== 'undefined' &&
        process.env &&
        'SUPABASE_SERVICE_ROLE_KEY' in process.env &&
        process.env['SUPABASE_SERVICE_ROLE_KEY'] === config.supabaseAnonKey)
    ) {
      throw new Error(
        'SECURITY INVARIANT VIOLATION: SUPABASE_SERVICE_ROLE_KEY supplied to client bundle!'
      );
    }

    this.supabaseUrl = config.supabaseUrl.replace(/\/$/, '');
    this.supabaseAnonKey = config.supabaseAnonKey;
    this.storage = config.storage ?? new MemoryStorageAdapter();
    this.fetchFn = config.customFetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch));

    // Restore session from storage
    this.currentSession = this.storage.getSession();
    if (this.currentSession) {
      this.currentUserProfile = this.deriveProfileFromSession(this.currentSession);
    }
  }

  /**
   * Helper to construct authorized fetch headers.
   */
  private getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.supabaseAnonKey
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Extracts or constructs a UserProfile from session metadata.
   */
  private deriveProfileFromSession(session: AuthSession): UserProfile {
    const meta = session.user.user_metadata ?? {};
    const appMeta = session.user.app_metadata ?? {};
    const role: UserRole = (appMeta['role'] as UserRole) || (meta['role'] as UserRole) || 'shop_owner';
    const name = (meta['name'] as string) || (meta['full_name'] as string) || 'Shop Owner';
    const phone = (meta['phone'] as string) || '';

    return {
      id: session.user.id,
      role,
      name,
      phone,
      ...(session.user.email ? { email: session.user.email } : {}),
      created_at: session.user.created_at
    };
  }

  /**
   * Validates that the user's role satisfies the Owner Dashboard requirements.
   * Throws RoleGuardError if user is only a customer.
   */
  public assertOwnerRole(role: UserRole): void {
    if (role === 'customer') {
      throw new RoleGuardError(
        'Access denied: Customer accounts cannot access the Shop Owner Dashboard. Please use the Customer App.'
      );
    }
  }

  /**
   * Signs in a shop owner with email and password.
   * Enforces role validation immediately after token acquisition.
   */
  async signInWithPassword(credentials: SignInCredentials): Promise<{
    user: AuthUser;
    session: AuthSession;
    profile: UserProfile;
  }> {
    if (!credentials.email || !credentials.password) {
      throw {
        code: 'VALIDATION_ERROR',
        message: 'Email and password are required.',
        status: 400
      } satisfies AuthError;
    }

    const endpoint = `${this.supabaseUrl}/auth/v1/token?grant_type=password`;

    const response = await this.fetchFn(endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password
      })
    });

    if (!response.ok) {
      let errData: { error_description?: string; msg?: string; message?: string } = {};
      try {
        errData = (await response.json()) as typeof errData;
      } catch {
        // use default message
      }
      const message =
        errData.error_description || errData.msg || errData.message || 'Invalid login credentials.';
      throw {
        code: response.status === 400 ? 'INVALID_CREDENTIALS' : 'AUTH_ERROR',
        message,
        status: response.status
      } satisfies AuthError;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: {
        id: string;
        email?: string;
        phone?: string;
        user_metadata?: Record<string, unknown>;
        app_metadata?: Record<string, unknown>;
        created_at: string;
      };
    };

    const nowSeconds = Math.floor(Date.now() / 1000);
    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: nowSeconds + data.expires_in,
      token_type: data.token_type || 'bearer',
      user: {
        id: data.user.id,
        email: data.user.email,
        phone: data.user.phone,
        user_metadata: data.user.user_metadata,
        app_metadata: data.user.app_metadata,
        created_at: data.user.created_at
      }
    };

    // Role check: ensure user is NOT customer
    const profile = this.deriveProfileFromSession(session);
    try {
      this.assertOwnerRole(profile.role);
    } catch (err) {
      // Clear any partial session immediately
      this.storage.removeSession();
      this.currentSession = null;
      this.currentUserProfile = null;
      throw err;
    }

    this.currentSession = session;
    this.currentUserProfile = profile;
    this.storage.setSession(session);
    this.notifyListeners('SIGNED_IN', session);

    return { user: session.user, session, profile };
  }

  /**
   * Refreshes the active session using the refresh token.
   */
  async refreshSession(): Promise<AuthSession | null> {
    const existing = this.storage.getSession();
    if (!existing || !existing.refresh_token) {
      return null;
    }

    const endpoint = `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          refresh_token: existing.refresh_token
        })
      });

      if (!response.ok) {
        this.signOut();
        return null;
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
        token_type: string;
        user: {
          id: string;
          email?: string;
          phone?: string;
          user_metadata?: Record<string, unknown>;
          app_metadata?: Record<string, unknown>;
          created_at: string;
        };
      };

      const nowSeconds = Math.floor(Date.now() / 1000);
      const session: AuthSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: nowSeconds + data.expires_in,
        token_type: data.token_type || 'bearer',
        user: {
          id: data.user.id,
          email: data.user.email,
          phone: data.user.phone,
          user_metadata: data.user.user_metadata,
          app_metadata: data.user.app_metadata,
          created_at: data.user.created_at
        }
      };

      const profile = this.deriveProfileFromSession(session);
      this.assertOwnerRole(profile.role);

      this.currentSession = session;
      this.currentUserProfile = profile;
      this.storage.setSession(session);
      this.notifyListeners('TOKEN_REFRESHED', session);

      return session;
    } catch {
      this.signOut();
      return null;
    }
  }

  /**
   * Signs out the user, clearing session from storage and cookies.
   */
  async signOut(): Promise<void> {
    const session = this.currentSession;
    if (session) {
      try {
        await this.fetchFn(`${this.supabaseUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: this.getHeaders(session.access_token)
        });
      } catch {
        // Even if network fails, proceed with local logout
      }
    }

    this.currentSession = null;
    this.currentUserProfile = null;
    this.storage.removeSession();
    this.notifyListeners('SIGNED_OUT', null);
  }

  /**
   * Gets the current cached session or checks if it's expired.
   */
  getSession(): AuthSession | null {
    if (!this.currentSession) {
      this.currentSession = this.storage.getSession();
      if (this.currentSession) {
        this.currentUserProfile = this.deriveProfileFromSession(this.currentSession);
      }
    }

    if (this.currentSession) {
      const now = Math.floor(Date.now() / 1000);
      if (this.currentSession.expires_at <= now) {
        return null;
      }
    }

    return this.currentSession;
  }

  /**
   * Gets the active owner user profile.
   */
  getProfile(): UserProfile | null {
    const session = this.getSession();
    if (!session) return null;
    return this.currentUserProfile ?? this.deriveProfileFromSession(session);
  }

  /**
   * Subscribes to auth state changes.
   */
  onAuthStateChange(callback: AuthStateChangeCallback): { unsubscribe: () => void } {
    this.listeners.add(callback);
    // Fire initial state
    const session = this.getSession();
    callback('INITIAL_SESSION', session);

    return {
      unsubscribe: () => {
        this.listeners.delete(callback);
      }
    };
  }

  private notifyListeners(event: AuthChangeEvent, session: AuthSession | null): void {
    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch (err) {
        console.error('Error in onAuthStateChange listener:', err);
      }
    }
  }
}
