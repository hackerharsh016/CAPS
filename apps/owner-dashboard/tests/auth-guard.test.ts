import { describe, it, expect } from 'vitest';
import {
  isProtectedPath,
  isAuthPath,
  isPublicPath,
  createLoginRedirectUrl,
  resolveOwnerRouteAccess
} from '../src/features/auth/route-guard-utils';
import type { AuthSession, UserProfile } from '../src/features/auth/types';

describe('Owner Auth & Role Route Guards', () => {
  const createMockSession = (
    role: 'customer' | 'shop_owner' | 'admin',
    expired = false
  ): AuthSession => {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: 'test-token',
      refresh_token: 'test-refresh',
      expires_in: 3600,
      expires_at: expired ? now - 100 : now + 3600,
      token_type: 'bearer',
      user: {
        id: 'user-uuid-1',
        email: 'user@test.com',
        user_metadata: { role },
        created_at: new Date().toISOString()
      }
    };
  };

  const createMockProfile = (role: 'customer' | 'shop_owner' | 'admin'): UserProfile => ({
    id: 'user-uuid-1',
    role,
    name: 'Test User',
    phone: '+919876543210',
    email: 'user@test.com',
    created_at: new Date().toISOString()
  });

  describe('Path classification', () => {
    it('classifies protected owner paths', () => {
      expect(isProtectedPath('/')).toBe(true);
      expect(isProtectedPath('/queue')).toBe(true);
      expect(isProtectedPath('/printers')).toBe(true);
      expect(isProtectedPath('/pricing')).toBe(true);
      expect(isProtectedPath('/orders')).toBe(true);
      expect(isProtectedPath('/reports')).toBe(true);
      expect(isProtectedPath('/settings')).toBe(true);
      expect(isProtectedPath('/shop/00000000-0000-0000-0000-000000000001')).toBe(true);
    });

    it('classifies auth paths', () => {
      expect(isAuthPath('/login')).toBe(true);
      expect(isAuthPath('/login/')).toBe(true);
      expect(isAuthPath('/login?error=customer_not_allowed')).toBe(true);
      expect(isAuthPath('/register')).toBe(true);
      expect(isAuthPath('/register?redirect=%2Fqueue')).toBe(true);
      expect(isAuthPath('/auth/callback')).toBe(true);
      expect(isAuthPath('/queue')).toBe(false);
    });

    it('classifies public paths', () => {
      expect(isPublicPath('/api/health')).toBe(true);
      expect(isPublicPath('/favicon.ico')).toBe(true);
      expect(isPublicPath('/queue')).toBe(false);
    });

    it('creates correct login redirect URL', () => {
      expect(createLoginRedirectUrl('/queue')).toBe('/login?redirect=%2Fqueue');
      expect(createLoginRedirectUrl('/')).toBe('/login');
      expect(createLoginRedirectUrl('/login')).toBe('/login');
      expect(createLoginRedirectUrl('/login?error=customer_not_allowed')).toBe('/login');
      expect(createLoginRedirectUrl('/login?redirect=%2Fqueue')).toBe('/login');
      expect(createLoginRedirectUrl('/register')).toBe('/login');
      expect(createLoginRedirectUrl('/queue?tab=pending')).toBe('/login?redirect=%2Fqueue%3Ftab%3Dpending');
    });
  });

  describe('Route Access Resolution & Role Guards', () => {
    it('redirects unauthenticated user from protected route to login', () => {
      const result = resolveOwnerRouteAccess({
        pathname: '/queue',
        session: null
      });

      expect(result.allowed).toBe(false);
      expect(result.redirectUrl).toBe('/login?redirect=%2Fqueue');
      expect(result.reason).toBe('UNAUTHENTICATED');
    });

    it('redirects expired session to login', () => {
      const session = createMockSession('shop_owner', true);
      const result = resolveOwnerRouteAccess({
        pathname: '/queue',
        session
      });

      expect(result.allowed).toBe(false);
      expect(result.redirectUrl).toBe('/login?redirect=%2Fqueue');
      expect(result.reason).toBe('EXPIRED');
    });

    it('allows authenticated shop_owner on protected route', () => {
      const session = createMockSession('shop_owner');
      const profile = createMockProfile('shop_owner');

      const result = resolveOwnerRouteAccess({
        pathname: '/queue',
        session,
        profile
      });

      expect(result.allowed).toBe(true);
      expect(result.redirectUrl).toBeNull();
      expect(result.reason).toBe('AUTHENTICATED');
    });

    it('allows authenticated admin on protected route', () => {
      const session = createMockSession('admin');
      const profile = createMockProfile('admin');

      const result = resolveOwnerRouteAccess({
        pathname: '/settings',
        session,
        profile
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('AUTHENTICATED');
    });

    it('strictly denies customer role from accessing owner dashboard (role mismatch)', () => {
      const session = createMockSession('customer');
      const profile = createMockProfile('customer');

      const result = resolveOwnerRouteAccess({
        pathname: '/queue',
        session,
        profile
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ROLE_MISMATCH');
    });

    it('redirects authenticated shop_owner visiting /login back to dashboard', () => {
      const session = createMockSession('shop_owner');
      const profile = createMockProfile('shop_owner');

      const result = resolveOwnerRouteAccess({
        pathname: '/login',
        session,
        profile
      });

      expect(result.allowed).toBe(false);
      expect(result.redirectUrl).toBe('/');
      expect(result.reason).toBe('ALREADY_AUTHENTICATED');
    });

    it('allows unauthenticated access to public health endpoint', () => {
      const result = resolveOwnerRouteAccess({
        pathname: '/api/health',
        session: null
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('PUBLIC_ROUTE');
    });
  });

  describe('Tenant & Shop Isolation Guard', () => {
    const shopA = '00000000-0000-0000-0000-000000000001';
    const shopB = '00000000-0000-0000-0000-000000000002';

    it('allows owner to access their own shop', () => {
      const session = createMockSession('shop_owner');
      const profile = createMockProfile('shop_owner');

      const result = resolveOwnerRouteAccess({
        pathname: `/shop/${shopA}`,
        session,
        profile,
        targetShopId: shopA,
        userShopIds: [shopA]
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('AUTHENTICATED');
    });

    it('strictly denies owner from accessing another shop (cross-shop forbidden)', () => {
      const session = createMockSession('shop_owner');
      const profile = createMockProfile('shop_owner');

      const result = resolveOwnerRouteAccess({
        pathname: `/shop/${shopB}`,
        session,
        profile,
        targetShopId: shopB,
        userShopIds: [shopA] // User only owns shopA!
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('CROSS_SHOP_FORBIDDEN');
    });

    it('allows admin to access any shop', () => {
      const session = createMockSession('admin');
      const profile = createMockProfile('admin');

      const result = resolveOwnerRouteAccess({
        pathname: `/shop/${shopB}`,
        session,
        profile,
        targetShopId: shopB,
        userShopIds: [shopA]
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('AUTHENTICATED');
    });
  });
});
