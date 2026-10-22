import { describe, it, expect, beforeEach } from 'vitest';
import { SupabaseAuthClient } from '../src/features/auth/supabase-auth-client';
import { MemoryStorageAdapter } from '../src/features/auth/storage';
import { ShopService } from '../src/features/shop-management/shop-service';
import type { CreateShopInput } from '../src/features/shop-management/types';

describe('Owner Self-Registration & Database Schema Validation', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
  });

  describe('SupabaseAuthClient.signUp (public.profiles & auth.users)', () => {
    it('validates that email, password, name, and phone are strictly required', async () => {
      const client = new SupabaseAuthClient({
        supabaseUrl: 'http://localhost:54321',
        supabaseAnonKey: 'mock-anon-key',
        storage
      });

      await expect(
        client.signUp({
          email: '',
          password: 'Pass',
          name: 'Owner',
          phone: '9999999999'
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/email and password/i)
      });

      await expect(
        client.signUp({
          email: 'owner@print.com',
          password: 'Pass',
          name: '',
          phone: ''
        })
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/name and phone/i)
      });
    });

    it('registers shop_owner successfully with user metadata and role assignment', async () => {
      let capturedBody: any = null;

      const mockFetch: typeof fetch = async (input, init) => {
        const url = input.toString();
        if (url.includes('/auth/v1/signup')) {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              access_token: 'jwt-owner-token-new',
              refresh_token: 'refresh-owner-token-new',
              expires_in: 3600,
              token_type: 'bearer',
              user: {
                id: 'owner-uuid-999',
                email: 'rajesh@campusprint.com',
                phone: '+919876543210',
                user_metadata: {
                  role: 'shop_owner',
                  name: 'Rajesh Sharma',
                  phone: '+919876543210'
                },
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

      const res = await client.signUp({
        email: 'rajesh@campusprint.com',
        password: 'SecurePassword123!',
        name: 'Rajesh Sharma',
        phone: '+919876543210',
        role: 'shop_owner'
      });

      expect(capturedBody).toBeDefined();
      expect(capturedBody.email).toBe('rajesh@campusprint.com');
      expect(capturedBody.data.role).toBe('shop_owner');
      expect(capturedBody.data.name).toBe('Rajesh Sharma');
      expect(capturedBody.data.phone).toBe('+919876543210');

      expect(res.user.id).toBe('owner-uuid-999');
      expect(res.profile.role).toBe('shop_owner');
      expect(res.profile.name).toBe('Rajesh Sharma');
      expect(res.session?.access_token).toBe('jwt-owner-token-new');
    });

    it('rejects registration if assigned customer role attempts to access dashboard', async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            access_token: 'jwt-customer-token',
            refresh_token: 'refresh-customer-token',
            expires_in: 3600,
            token_type: 'bearer',
            user: {
              id: 'cust-uuid-1',
              email: 'cust@college.com',
              user_metadata: { role: 'customer', name: 'Student' },
              created_at: new Date().toISOString()
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const client = new SupabaseAuthClient({
        supabaseUrl: 'http://localhost:54321',
        supabaseAnonKey: 'mock-anon-key',
        storage,
        customFetch: mockFetch
      });

      await expect(
        client.signUp({
          email: 'cust@college.com',
          password: 'Pass',
          name: 'Student',
          phone: '9999999999',
          role: 'customer'
        })
      ).rejects.toThrow(/Access denied/i);
    });
  });

  describe('ShopService.createShop (public.shops schema constraints)', () => {
    it('creates shop matching database schema and persists active shop ID', async () => {
      let insertedPayload: any = null;

      const mockFetch: typeof fetch = async (input, init) => {
        const url = input.toString();
        if (url.includes('/rest/v1/shops') && init?.method === 'POST') {
          insertedPayload = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify([
              {
                id: 'shop-created-uuid-1',
                ...insertedPayload,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
            ]),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('Not Found', { status: 404 });
      };

      const service = new ShopService({
        supabaseUrl: 'http://localhost:54321',
        supabaseAnonKey: 'mock-anon-key',
        customFetch: mockFetch
      });

      const shopInput: CreateShopInput = {
        name: 'Metro Quick Prints',
        address: '100 University Boulevard, Gate 2',
        geo_lat: 12.9716,
        geo_lng: 77.5946,
        status: 'open',
        auto_print_enabled: false,
        allow_pay_at_counter: true
      };

      const created = await service.createShop(shopInput, 'owner-uuid-999', 'jwt-owner-token');

      expect(insertedPayload).toBeDefined();
      expect(insertedPayload.owner_id).toBe('owner-uuid-999');
      expect(insertedPayload.name).toBe('Metro Quick Prints');
      expect(insertedPayload.address).toBe('100 University Boulevard, Gate 2');
      expect(insertedPayload.geo_lat).toBe(12.9716);
      expect(insertedPayload.geo_lng).toBe(77.5946);
      expect(insertedPayload.status).toBe('open');
      expect(insertedPayload.pricing_config.A4).toBeDefined();
      expect(insertedPayload.urgent_surcharge_config).toBeDefined();
      expect(insertedPayload.allow_pay_at_counter).toBe(true);

      expect(created.id).toBe('shop-created-uuid-1');
      expect(service.getActiveShopId()).toBe('shop-created-uuid-1');
    });

    it('propagates error when network fails during shop creation without creating mock data', async () => {
      const failingFetch: typeof fetch = async () => {
        throw new Error('Connection refused to localhost');
      };

      const service = new ShopService({
        supabaseUrl: 'http://localhost:54321',
        supabaseAnonKey: 'mock-anon-key',
        customFetch: failingFetch
      });

      const shopInput: CreateShopInput = {
        name: 'Campus Corner Xerox',
        address: 'Near Library Block, North Campus',
        geo_lat: 28.7041,
        geo_lng: 77.1025
      };

      await expect(service.createShop(shopInput, 'owner-offline-1')).rejects.toThrow(
        'Connection refused to localhost'
      );
    });
  });
});
