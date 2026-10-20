/**
 * Supabase Auth Client implementation for CAPS Customer Web.
 * Connects to Supabase GoTrue Auth REST endpoints with full token lifecycle,
 * cookie synchronization, auto-refresh, and security invariants.
 *
 * Conforms to Master Implementation Plan Section 3 and SRS Section 4.1.
 */

import type {
  AuthChangeEvent,
  AuthError,
  AuthSession,
  AuthStateChangeCallback,
  AuthUser,
  UserRole
} from './types';
import {
  type AuthStorageAdapter,
  clearSessionFromStorage,
  createDefaultStorage,
  loadSessionFromStorage,
  saveSessionToStorage
} from './storage';

export interface SupabaseAuthClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  storage?: AuthStorageAdapter | undefined;
  customFetch?: typeof fetch | undefined;
  /** Security check: will throw if service role key is passed */
  serviceRoleKey?: never;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
  name?: string | undefined;
  phone?: string | undefined;
  role?: UserRole | undefined;
}

export interface OtpCredentials {
  email?: string | undefined;
  phone?: string | undefined;
}

export interface VerifyOtpCredentials {
  email?: string | undefined;
  phone?: string | undefined;
  token: string;
  type?: 'signup' | 'sms' | 'recovery' | 'magiclink' | undefined;
}

export class SupabaseAuthClient {
  private readonly baseUrl: string;
  private readonly anonKey: string;
  private readonly storage: AuthStorageAdapter;
  private readonly fetchImpl: typeof fetch;
  private readonly listeners = new Set<AuthStateChangeCallback>();
  private activeSession: AuthSession | null = null;
  private refreshPromise: Promise<AuthSession | null> | null = null;

  constructor(config: SupabaseAuthClientConfig) {
    // Security check: Assert that no server service-role key is provided
    if ('serviceRoleKey' in config && config.serviceRoleKey) {
      throw new Error(
        'SECURITY VIOLATION: Supabase service-role key must NEVER be passed to client-side auth'
      );
    }

    if (!config.supabaseUrl || typeof config.supabaseUrl !== 'string') {
      throw new Error('SupabaseAuthClient requires a valid supabaseUrl');
    }

    if (!config.supabaseAnonKey || typeof config.supabaseAnonKey !== 'string') {
      throw new Error('SupabaseAuthClient requires a valid supabaseAnonKey');
    }

    // Clean base URL trailing slashes
    this.baseUrl = config.supabaseUrl.replace(/\/+$/, '');
    this.anonKey = config.supabaseAnonKey;
    this.storage = config.storage ?? createDefaultStorage();
    this.fetchImpl =
      config.customFetch ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : (undefined as unknown as typeof fetch));

    // Hydrate cached session from storage if present
    this.activeSession = loadSessionFromStorage(this.storage);
  }

  /**
   * Returns default headers for Supabase GoTrue Auth API requests.
   */
  private getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.anonKey
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      headers['Authorization'] = `Bearer ${this.anonKey}`;
    }
    return headers;
  }

  /**
   * Evaluates if a session token is expired or within the 60s refresh window.
   */
  public isSessionExpired(session: AuthSession, bufferSeconds = 60): boolean {
    const now = Math.floor(Date.now() / 1000);
    return session.expires_at <= now + bufferSeconds;
  }

  /**
   * Dispatches auth state changes to all registered listeners.
   */
  private notifyListeners(event: AuthChangeEvent, session: AuthSession | null): void {
    this.activeSession = session;
    if (session) {
      saveSessionToStorage(this.storage, session);
    } else {
      clearSessionFromStorage(this.storage);
    }
    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch (err) {
        console.error('Error in auth state change listener:', err);
      }
    }
  }

  /**
   * Registers a callback invoked whenever the auth state changes.
   * Returns an unsubscribe function.
   */
  public onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    this.listeners.add(callback);
    // Fire initial state
    try {
      callback('INITIAL_SESSION', this.activeSession);
    } catch (err) {
      console.error('Error in initial auth listener:', err);
    }
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Retrieves the current authenticated session.
   * Transparently refreshes the token if it has expired.
   */
  public async getSession(): Promise<AuthSession | null> {
    const cached = this.activeSession ?? loadSessionFromStorage(this.storage);
    if (!cached) {
      return null;
    }

    // If still valid, return directly
    if (!this.isSessionExpired(cached)) {
      this.activeSession = cached;
      return cached;
    }

    // Token is expired; attempt auto-refresh
    return this.refreshSession(cached.refresh_token);
  }

  /**
   * Refreshes the session using the refresh token.
   * Concurrency-safe: deduplicates in-flight refresh requests.
   */
  public async refreshSession(refreshToken: string): Promise<AuthSession | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await this.fetchImpl(
          `${this.baseUrl}/auth/v1/token?grant_type=refresh_token`,
          {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ refresh_token: refreshToken })
          }
        );

        if (!response.ok) {
          // Token is rejected or expired on server; clear session
          this.notifyListeners('SIGNED_OUT', null);
          return null;
        }

        const data = (await response.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          token_type: string;
          user: AuthUser;
        };

        const now = Math.floor(Date.now() / 1000);
        const newSession: AuthSession = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          expires_at: now + data.expires_in,
          token_type: data.token_type ?? 'bearer',
          user: data.user
        };

        this.notifyListeners('TOKEN_REFRESHED', newSession);
        return newSession;
      } catch (error) {
        console.error('Failed to refresh Supabase session:', error);
        this.notifyListeners('SIGNED_OUT', null);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Signs in a customer using email and password.
   */
  public async signInWithPassword(credentials: SignInCredentials): Promise<{
    session: AuthSession;
    user: AuthUser;
  }> {
    const response = await this.fetchImpl(`${this.baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password
      })
    });

    if (!response.ok) {
      let errBody: { error_description?: string; msg?: string; message?: string } = {};
      try {
        errBody = (await response.json()) as typeof errBody;
      } catch {
        // Ignore json parse error
      }
      const message =
        errBody.error_description || errBody.msg || errBody.message || 'Invalid login credentials';
      const error: AuthError = {
        code: 'INVALID_CREDENTIALS',
        message,
        status: response.status
      };
      throw error;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: AuthUser;
    };

    const now = Math.floor(Date.now() / 1000);
    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: now + data.expires_in,
      token_type: data.token_type ?? 'bearer',
      user: data.user
    };

    this.notifyListeners('SIGNED_IN', session);
    return { session, user: session.user };
  }

  /**
   * Signs up a new customer account.
   */
  public async signUp(credentials: SignUpCredentials): Promise<{
    user: AuthUser;
    session: AuthSession | null;
  }> {
    const payload: {
      email: string;
      password: string;
      data?: Record<string, unknown>;
    } = {
      email: credentials.email,
      password: credentials.password
    };

    const userData: Record<string, unknown> = {};
    if (credentials.name !== undefined) {
      userData['name'] = credentials.name;
    }
    if (credentials.phone !== undefined) {
      userData['phone'] = credentials.phone;
    }
    if (credentials.role !== undefined) {
      userData['role'] = credentials.role;
    } else {
      userData['role'] = 'customer';
    }

    payload.data = userData;

    const response = await this.fetchImpl(`${this.baseUrl}/auth/v1/signup`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errBody: { msg?: string; message?: string } = {};
      try {
        errBody = (await response.json()) as typeof errBody;
      } catch {
        // Ignore
      }
      const message = errBody.msg || errBody.message || 'Failed to create account';
      const error: AuthError = {
        code: 'SIGNUP_FAILED',
        message,
        status: response.status
      };
      throw error;
    }

    const data = (await response.json()) as {
      id?: string;
      email?: string;
      user?: AuthUser;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    const user: AuthUser = data.user ?? {
      id: data.id ?? '',
      email: data.email ?? credentials.email,
      created_at: new Date().toISOString()
    };

    let session: AuthSession | null = null;
    if (data.access_token && data.refresh_token) {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = data.expires_in ?? 3600;
      session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: expiresIn,
        expires_at: now + expiresIn,
        token_type: data.token_type ?? 'bearer',
        user
      };
      this.notifyListeners('SIGNED_IN', session);
    }

    return { user, session };
  }

  /**
   * Sends an OTP to the customer's phone or email.
   */
  public async signInWithOtp(credentials: OtpCredentials): Promise<{ message: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}/auth/v1/otp`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(credentials)
    });

    if (!response.ok) {
      let errBody: { msg?: string; message?: string } = {};
      try {
        errBody = (await response.json()) as typeof errBody;
      } catch {
        // Ignore
      }
      const error: AuthError = {
        code: 'OTP_REQUEST_FAILED',
        message: errBody.msg || errBody.message || 'Failed to request OTP',
        status: response.status
      };
      throw error;
    }

    return { message: 'OTP sent successfully' };
  }

  /**
   * Verifies an OTP and establishes a customer session.
   */
  public async verifyOtp(credentials: VerifyOtpCredentials): Promise<{
    session: AuthSession;
    user: AuthUser;
  }> {
    const response = await this.fetchImpl(`${this.baseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        email: credentials.email,
        phone: credentials.phone,
        token: credentials.token,
        type: credentials.type ?? (credentials.phone ? 'sms' : 'magiclink')
      })
    });

    if (!response.ok) {
      let errBody: { msg?: string; message?: string } = {};
      try {
        errBody = (await response.json()) as typeof errBody;
      } catch {
        // Ignore
      }
      const error: AuthError = {
        code: 'INVALID_OTP',
        message: errBody.msg || errBody.message || 'Invalid or expired OTP',
        status: response.status
      };
      throw error;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      token_type: string;
      user: AuthUser;
    };

    const now = Math.floor(Date.now() / 1000);
    const session: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: now + data.expires_in,
      token_type: data.token_type ?? 'bearer',
      user: data.user
    };

    this.notifyListeners('SIGNED_IN', session);
    return { session, user: session.user };
  }

  /**
   * Signs out the current customer and purges local sessions and cookies.
   */
  public async signOut(): Promise<void> {
    const session = this.activeSession ?? loadSessionFromStorage(this.storage);
    if (session?.access_token) {
      try {
        await this.fetchImpl(`${this.baseUrl}/auth/v1/logout`, {
          method: 'POST',
          headers: this.getHeaders(session.access_token)
        });
      } catch (err) {
        // Continue clearing client session even if network call fails
        console.warn('Network call during signOut failed:', err);
      }
    }

    this.notifyListeners('SIGNED_OUT', null);
  }

  /**
   * Retrieves the current user details from Supabase using an access token.
   */
  public async getUser(accessToken?: string): Promise<AuthUser | null> {
    const token = accessToken ?? this.activeSession?.access_token;
    if (!token) {
      return null;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: this.getHeaders(token)
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as AuthUser;
  }
}
