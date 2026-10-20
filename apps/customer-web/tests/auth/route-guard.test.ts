import { describe, it, expect } from 'vitest';
import {
  isProtectedPath,
  isAuthPath,
  isPublicPath,
  createLoginRedirectUrl,
  resolveRouteAccess
} from '../../src/features/auth/route-guard-utils';
import type { AuthSession, UserRole } from '../../src/features/auth/types';

describe('Route Guard and Access Control Resolution', () => {
  const createMockSession = (
    expiresInSecondsFromNow = 3600,
    role: UserRole = 'customer'
  ): AuthSession => {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: 'mock-jwt-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: now + expiresInSecondsFromNow,
      token_type: 'bearer',
      user: {
        id: 'usr-456',
        email: 'test@customer.com',
        created_at: new Date().toISOString(),
        user_metadata: { role, name: 'Test User' },
        app_metadata: { role }
      }
    };
  };

  describe('Path Classification', () => {
    it('correctly identifies protected customer paths', () => {
      expect(isProtectedPath('/orders')).toBe(true);
      expect(isProtectedPath('/orders/123')).toBe(true);
      expect(isProtectedPath('/profile')).toBe(true);
      expect(isProtectedPath('/print/new')).toBe(true);
      expect(isProtectedPath('/jobs/job-abc')).toBe(true);
      expect(isProtectedPath('/settings')).toBe(true);

      // Public or auth paths should not be protected
      expect(isProtectedPath('/')).toBe(false);
      expect(isProtectedPath('/shops')).toBe(false);
      expect(isProtectedPath('/shops/shop-1')).toBe(false);
      expect(isProtectedPath('/login')).toBe(false);
      expect(isProtectedPath('/register')).toBe(false);
    });

    it('correctly identifies auth paths', () => {
      expect(isAuthPath('/login')).toBe(true);
      expect(isAuthPath('/register')).toBe(true);
      expect(isAuthPath('/forgot-password')).toBe(true);
      expect(isAuthPath('/orders')).toBe(false);
      expect(isAuthPath('/')).toBe(false);
    });

    it('correctly identifies public paths', () => {
      expect(isPublicPath('/')).toBe(true);
      expect(isPublicPath('/shops')).toBe(true);
      expect(isPublicPath('/shops/sh-123')).toBe(true);
      expect(isPublicPath('/help')).toBe(true);
      expect(isPublicPath('/orders')).toBe(false);
      expect(isPublicPath('/profile')).toBe(false);
    });
  });

  describe('Login Redirect URL Formatting', () => {
    it('creates login redirect URL preserving destination in query param', () => {
      expect(createLoginRedirectUrl('/orders')).toBe('/login?redirect=%2Forders');
      expect(createLoginRedirectUrl('/print/new?shopId=123')).toBe(
        '/login?redirect=%2Fprint%2Fnew%3FshopId%3D123'
      );
    });

    it('returns default /login for root or empty current path', () => {
      expect(createLoginRedirectUrl('/')).toBe('/login');
      expect(createLoginRedirectUrl('')).toBe('/login');
    });

    it('does not re-encode login path', () => {
      expect(createLoginRedirectUrl('/login')).toBe('/login');
    });
  });

  describe('resolveRouteAccess Scenarios', () => {
    it('allows unauthenticated access to public shop discovery and home', () => {
      const resHome = resolveRouteAccess('/', null);
      expect(resHome.allowed).toBe(true);
      expect(resHome.reason).toBe('PUBLIC_ROUTE');

      const resShops = resolveRouteAccess('/shops', null);
      expect(resShops.allowed).toBe(true);
      expect(resShops.reason).toBe('PUBLIC_ROUTE');

      const resShopDetails = resolveRouteAccess('/shops/sp-1', null);
      expect(resShopDetails.allowed).toBe(true);
      expect(resShopDetails.reason).toBe('PUBLIC_ROUTE');
    });

    it('redirects unauthenticated user accessing protected route to login', () => {
      const resOrders = resolveRouteAccess('/orders', null);
      expect(resOrders.allowed).toBe(false);
      expect(resOrders.redirectUrl).toBe('/login?redirect=%2Forders');
      expect(resOrders.reason).toBe('UNAUTHENTICATED');

      const resProfile = resolveRouteAccess('/profile', null);
      expect(resProfile.allowed).toBe(false);
      expect(resProfile.redirectUrl).toBe('/login?redirect=%2Fprofile');

      const resPrint = resolveRouteAccess('/print/new', null);
      expect(resPrint.allowed).toBe(false);
      expect(resPrint.redirectUrl).toBe('/login?redirect=%2Fprint%2Fnew');
    });

    it('redirects expired session accessing protected route to login', () => {
      // Session expired 5 minutes ago
      const expiredSession = createMockSession(-300);

      const res = resolveRouteAccess('/orders', expiredSession);
      expect(res.allowed).toBe(false);
      expect(res.redirectUrl).toBe('/login?redirect=%2Forders');
      expect(res.reason).toBe('EXPIRED');
    });

    it('grants access to protected route when valid customer session is present', () => {
      const validSession = createMockSession(3600, 'customer');

      const res = resolveRouteAccess('/orders', validSession);
      expect(res.allowed).toBe(true);
      expect(res.redirectUrl).toBeNull();
      expect(res.reason).toBe('AUTHENTICATED');
    });

    it('redirects already-authenticated customer visiting /login to /orders', () => {
      const validSession = createMockSession(3600);

      const res = resolveRouteAccess('/login', validSession);
      expect(res.allowed).toBe(false);
      expect(res.redirectUrl).toBe('/orders');
      expect(res.reason).toBe('ALREADY_AUTHENTICATED');
    });

    it('enforces role requirements and blocks non-customer from customer views', () => {
      const ownerSession = createMockSession(3600, 'shop_owner');

      const res = resolveRouteAccess('/orders', ownerSession, 'customer');
      expect(res.allowed).toBe(false);
      expect(res.redirectUrl).toBe('/unauthorized');
      expect(res.reason).toBe('ROLE_MISMATCH');
    });
  });
});
