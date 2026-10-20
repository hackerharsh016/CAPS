import { describe, it, expect, beforeEach } from 'vitest';
import {
  SupabaseAuthClient,
  RoleGuardError
} from '../src/features/auth/supabase-auth-client';
import { MemoryStorageAdapter } from '../src/features/auth/storage';

describe('SupabaseAuthClient — Security & Role Guards', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  it('strictly rejects initialization with a service-role key (security invariant)', () => {
    expect(() => {
      new SupabaseAuthClient({
        supabaseUrl: 'http://localhost:54321',
        supabaseAnonKey: 'supabase_service_role_secret_key_123',
        storage
      });
    }).toThrow(/SECURITY INVARIANT VIOLATION/);
  });

  it('authenticates shop_owner successfully and stores session', async () => {
    const mockFetch: typeof fetch = async (input, _init) => {
      const url = input.toString();
      if (url.includes('/auth/v1/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock-jwt-owner',
            refresh_token: 'mock-refresh-owner',
            expires_in: 3600,
            token_type: 'bearer',
            user: {
              id: 'owner-uuid-1',
              email: 'owner@campusprint.com',
              phone: '+919876543210',
              user_metadata: { role: 'shop_owner', name: 'Ramesh Gupta' },
              created_at: new Date().toISOString()
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const client = new SupabaseAuthClient({
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'mock-anon-key',
      storage,
      customFetch: mockFetch
    });

    const result = await client.signInWithPassword({
      email: 'owner@campusprint.com',
      password: 'SecurePassword123!'
    });

    expect(result.session.access_token).toBe('mock-jwt-owner');
    expect(result.profile.role).toBe('shop_owner');
    expect(result.profile.name).toBe('Ramesh Gupta');
    expect(storage.getSession()?.access_token).toBe('mock-jwt-owner');
  });

  it('strictly rejects login and clears session if user has customer role', async () => {
    const mockFetch: typeof fetch = async (input, _init) => {
      const url = input.toString();
      if (url.includes('/auth/v1/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock-jwt-customer',
            refresh_token: 'mock-refresh-customer',
            expires_in: 3600,
            token_type: 'bearer',
            user: {
              id: 'customer-uuid-99',
              email: 'student@college.edu',
              phone: '+919999999999',
              user_metadata: { role: 'customer', name: 'Student Customer' },
              created_at: new Date().toISOString()
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const client = new SupabaseAuthClient({
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'mock-anon-key',
      storage,
      customFetch: mockFetch
    });

    await expect(
      client.signInWithPassword({
        email: 'student@college.edu',
        password: 'Password123!'
      })
    ).rejects.toThrow(RoleGuardError);

    // Verify session was NOT retained
    expect(storage.getSession()).toBeNull();
    expect(client.getSession()).toBeNull();
  });

  it('clears session on sign-out', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const client = new SupabaseAuthClient({
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'mock-anon-key',
      storage,
      customFetch: mockFetch
    });

    // Populate fake existing session
    storage.setSession({
      access_token: 'valid-token',
      refresh_token: 'valid-refresh',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: 'owner-1',
        email: 'owner@shop.com',
        user_metadata: { role: 'shop_owner' },
        created_at: new Date().toISOString()
      }
    });

    expect(client.getSession()).not.toBeNull();

    await client.signOut();

    expect(client.getSession()).toBeNull();
    expect(storage.getSession()).toBeNull();
  });

  it('rejects sign-in with missing credentials', async () => {
    const client = new SupabaseAuthClient({
      supabaseUrl: 'http://localhost:54321',
      supabaseAnonKey: 'mock-anon-key',
      storage
    });

    await expect(
      client.signInWithPassword({
        email: '',
        password: ''
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });
});
