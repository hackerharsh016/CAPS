import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SupabaseAuthClient } from '../../src/features/auth/supabase-auth-client';
import {
  MemoryStorageAdapter,
  SESSION_STORAGE_KEY,
  ACCESS_TOKEN_COOKIE
} from '../../src/features/auth/storage';
import { getSupabaseEnv, _resetBrowserClient } from '../../src/lib/supabase';
import type { AuthSession, AuthUser } from '../../src/features/auth/types';

describe('Supabase Auth Client and Security Guards', () => {
  let memoryStorage: MemoryStorageAdapter;

  beforeEach(() => {
    memoryStorage = new MemoryStorageAdapter();
    _resetBrowserClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    _resetBrowserClient();
  });

  describe('Security and Secret Isolation', () => {
    it('throws security error if serviceRoleKey is passed to client config', () => {
      expect(() => {
        new SupabaseAuthClient({
          supabaseUrl: 'https://example.supabase.co',
          supabaseAnonKey: 'valid-anon-key',
          // @ts-expect-error Testing runtime security violation
          serviceRoleKey: 'secret-service-role-key-123'
        });
      }).toThrow(/SECURITY VIOLATION/);
    });

    it('getSupabaseEnv throws security error if process.env.SUPABASE_SERVICE_ROLE_KEY exists', () => {
      const originalEnv = process.env['SUPABASE_SERVICE_ROLE_KEY'];
      try {
        process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'leaked-service-key';
        expect(() => getSupabaseEnv()).toThrow(/SECURITY VIOLATION/);
      } finally {
        if (originalEnv !== undefined) {
          process.env['SUPABASE_SERVICE_ROLE_KEY'] = originalEnv;
        } else {
          delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
        }
      }
    });

    it('requires valid supabaseUrl and supabaseAnonKey', () => {
      expect(() => {
        new SupabaseAuthClient({
          supabaseUrl: '',
          supabaseAnonKey: 'anon-key'
        });
      }).toThrow(/valid supabaseUrl/);

      expect(() => {
        new SupabaseAuthClient({
          supabaseUrl: 'https://example.supabase.co',
          supabaseAnonKey: ''
        });
      }).toThrow(/valid supabaseAnonKey/);
    });
  });

  describe('Authentication Lifecycle against API endpoints', () => {
    const mockUser: AuthUser = {
      id: 'usr-123e4567-e89b-12d3-a456-426614174000',
      email: 'customer@caps-print.test',
      phone: '+919876543210',
      created_at: new Date().toISOString(),
      user_metadata: { name: 'Customer Test', role: 'customer' }
    };

    it('signs in with valid password and stores tokens', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'jwt-access-token-123',
          refresh_token: 'refresh-token-456',
          expires_in: 3600,
          token_type: 'bearer',
          user: mockUser
        })
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const result = await client.signInWithPassword({
        email: 'customer@caps-print.test',
        password: 'ValidPassword123!'
      });

      expect(result.user.id).toBe(mockUser.id);
      expect(result.session.access_token).toBe('jwt-access-token-123');

      // Verify token persisted in storage
      expect(memoryStorage.getItem(ACCESS_TOKEN_COOKIE)).toBe('jwt-access-token-123');
      expect(memoryStorage.getItem(SESSION_STORAGE_KEY)).toContain('jwt-access-token-123');

      // Verify fetch arguments
      expect(mockFetch).toHaveBeenCalledWith(
        'https://caps-test.supabase.co/auth/v1/token?grant_type=password',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            apikey: 'anon-key-abc'
          })
        })
      );
    });

    it('throws structured AuthError on invalid credentials', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error_description: 'Invalid login credentials'
        })
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      await expect(
        client.signInWithPassword({
          email: 'wrong@test.com',
          password: 'BadPassword'
        })
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 400,
        message: 'Invalid login credentials'
      });

      expect(memoryStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });

    it('signs up a new customer account', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: mockUser.id,
          user: mockUser,
          access_token: 'new-acc-token',
          refresh_token: 'new-ref-token',
          expires_in: 3600
        })
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const result = await client.signUp({
        email: 'customer@caps-print.test',
        password: 'Password123!',
        name: 'New Customer',
        phone: '+919999988888',
        role: 'customer'
      });

      expect(result.user.id).toBe(mockUser.id);
      expect(result.session?.access_token).toBe('new-acc-token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://caps-test.supabase.co/auth/v1/signup',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('New Customer')
        })
      );
    });

    it('requests OTP and verifies OTP session', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({})
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'otp-access-token',
            refresh_token: 'otp-refresh-token',
            expires_in: 3600,
            user: mockUser
          })
        });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const otpReq = await client.signInWithOtp({ phone: '+919876543210' });
      expect(otpReq.message).toContain('OTP sent successfully');

      const otpVerify = await client.verifyOtp({
        phone: '+919876543210',
        token: '123456',
        type: 'sms'
      });
      expect(otpVerify.session.access_token).toBe('otp-access-token');
    });

    it('signs out and purges storage and cookies', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      // Seed session
      const now = Math.floor(Date.now() / 1000);
      const session: AuthSession = {
        access_token: 'active-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: 'bearer',
        user: mockUser
      };
      memoryStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      memoryStorage.setItem(ACCESS_TOKEN_COOKIE, 'active-token');

      await client.signOut();

      expect(memoryStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
      expect(memoryStorage.getItem(ACCESS_TOKEN_COOKIE)).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://caps-test.supabase.co/auth/v1/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer active-token'
          })
        })
      );
    });
  });

  describe('Session Refresh and Expiration Management', () => {
    it('returns valid session without network refresh if unexpired', async () => {
      const mockFetch = vi.fn();
      const now = Math.floor(Date.now() / 1000);

      const validSession: AuthSession = {
        access_token: 'valid-access-token',
        refresh_token: 'valid-refresh-token',
        expires_in: 3600,
        expires_at: now + 1800, // 30 minutes in the future
        token_type: 'bearer',
        user: {
          id: 'usr-1',
          created_at: new Date().toISOString()
        }
      };

      memoryStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(validSession));

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const session = await client.getSession();
      expect(session?.access_token).toBe('valid-access-token');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('automatically refreshes session when expired', async () => {
      const now = Math.floor(Date.now() / 1000);

      const expiredSession: AuthSession = {
        access_token: 'expired-access-token',
        refresh_token: 'old-refresh-token',
        expires_in: 3600,
        expires_at: now - 100, // In the past
        token_type: 'bearer',
        user: {
          id: 'usr-1',
          created_at: new Date().toISOString()
        }
      };

      memoryStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expiredSession));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-refreshed-token',
          refresh_token: 'new-refresh-token-2',
          expires_in: 3600,
          token_type: 'bearer',
          user: expiredSession.user
        })
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const session = await client.getSession();
      expect(session?.access_token).toBe('new-refreshed-token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://caps-test.supabase.co/auth/v1/token?grant_type=refresh_token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refresh_token: 'old-refresh-token' })
        })
      );
    });

    it('purges storage if refresh token is rejected by server', async () => {
      const now = Math.floor(Date.now() / 1000);

      const expiredSession: AuthSession = {
        access_token: 'expired-access-token',
        refresh_token: 'revoked-refresh-token',
        expires_in: 3600,
        expires_at: now - 100,
        token_type: 'bearer',
        user: {
          id: 'usr-1',
          created_at: new Date().toISOString()
        }
      };

      memoryStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(expiredSession));

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid refresh token' })
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const session = await client.getSession();
      expect(session).toBeNull();
      expect(memoryStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    });

    it('emits onAuthStateChange events on login, refresh, and logout', async () => {
      const events: string[] = [];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'tok-1',
          refresh_token: 'ref-1',
          expires_in: 3600,
          user: { id: 'usr-1', created_at: '' }
        })
      });

      const client = new SupabaseAuthClient({
        supabaseUrl: 'https://caps-test.supabase.co',
        supabaseAnonKey: 'anon-key-abc',
        storage: memoryStorage,
        customFetch: mockFetch as unknown as typeof fetch
      });

      const unsubscribe = client.onAuthStateChange((event) => {
        events.push(event);
      });

      expect(events).toEqual(['INITIAL_SESSION']);

      await client.signInWithPassword({ email: 'test@caps.in', password: 'pass' });
      expect(events).toContain('SIGNED_IN');

      await client.signOut();
      expect(events).toContain('SIGNED_OUT');

      unsubscribe();
    });
  });
});
