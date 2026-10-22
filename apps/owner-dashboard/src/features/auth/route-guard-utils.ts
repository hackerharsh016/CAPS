/**
 * Route protection and access resolution utilities for CAPS Owner Dashboard.
 * Pure logic shared across Next.js Edge Middleware and Client Route Guards.
 *
 * Requirements:
 * - Public: /api/health, /favicon.ico
 * - Auth: /login, /auth/*
 * - Protected: /, /queue, /printers, /pricing, /orders, /reports, /settings, /shop/*
 * - Role enforcement: Only 'shop_owner' and 'admin' are allowed. 'customer' is forbidden.
 * - Tenant isolation: Target shop ID must be owned by the user (or user is admin).
 */

import type { AuthSession, RouteAccessResult, UserProfile, UserRole } from './types';

export const PROTECTED_ROUTES = [
  '/',
  '/queue',
  '/printers',
  '/pricing',
  '/orders',
  '/reports',
  '/settings',
  '/shop'
];

export const AUTH_ROUTES = ['/login', '/auth', '/register'];

export const PUBLIC_ROUTES = ['/api/health', '/favicon.ico'];

/**
 * Normalizes a pathname by stripping query parameters, hashes, and trailing slashes.
 */
export function cleanPath(pathname: string): string {
  if (!pathname) return '/';
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '';
  const lower = withoutQuery.toLowerCase().trim();
  if (lower.length > 1 && lower.endsWith('/')) {
    return lower.slice(0, -1);
  }
  return lower || '/';
}

/**
 * Checks if a pathname requires authentication.
 */
export function isProtectedPath(pathname: string): boolean {
  const cleaned = cleanPath(pathname);
  if (cleaned === '/') {
    return true;
  }
  return PROTECTED_ROUTES.some(
    route => route !== '/' && (cleaned === route || cleaned.startsWith(`${route}/`))
  );
}

/**
 * Checks if a pathname is an auth route (e.g. login).
 */
export function isAuthPath(pathname: string): boolean {
  const cleaned = cleanPath(pathname);
  return AUTH_ROUTES.some(route => cleaned === route || cleaned.startsWith(`${route}/`));
}

/**
 * Checks if a pathname is publicly accessible without login.
 */
export function isPublicPath(pathname: string): boolean {
  const cleaned = cleanPath(pathname);
  return PUBLIC_ROUTES.some(route => cleaned === route || cleaned.startsWith(`${route}/`));
}

/**
 * Builds a login redirect URL preserving the original target in a query param.
 * Prevents recursive loops and eliminates self-redirects.
 */
export function createLoginRedirectUrl(currentPath: string, loginPath = '/login'): string {
  const cleaned = cleanPath(currentPath);
  if (!currentPath || cleaned === '/' || isAuthPath(cleaned)) {
    return loginPath;
  }
  return `${loginPath}?redirect=${encodeURIComponent(currentPath)}`;
}

export interface ResolveOwnerAccessOptions {
  pathname: string;
  session: AuthSession | null;
  profile?: UserProfile | null;
  targetShopId?: string | null;
  userShopIds?: string[];
}

/**
 * Resolves whether a route access should be allowed, redirected, or blocked.
 */
export function resolveOwnerRouteAccess(options: ResolveOwnerAccessOptions): RouteAccessResult {
  const { pathname, session, profile, targetShopId, userShopIds } = options;
  const now = Math.floor(Date.now() / 1000);

  const isExpired = session ? session.expires_at <= now : false;
  const isAuthenticated = !!session && !isExpired;

  // 1. If accessing an auth page while already authenticated with proper role
  if (isAuthPath(pathname) && isAuthenticated) {
    const role: UserRole =
      profile?.role ??
      (session.user.user_metadata?.['role'] as UserRole | undefined) ??
      (session.user.app_metadata?.['role'] as UserRole | undefined) ??
      'shop_owner';

    if (role === 'customer') {
      return {
        allowed: false,
        redirectUrl: null,
        reason: 'ROLE_MISMATCH'
      };
    }

    return {
      allowed: false,
      redirectUrl: '/',
      reason: 'ALREADY_AUTHENTICATED'
    };
  }

  // 2. If it is an auth page or public route and not authenticated, allow access
  if (isAuthPath(pathname) || isPublicPath(pathname)) {
    return {
      allowed: true,
      redirectUrl: null,
      reason: 'PUBLIC_ROUTE'
    };
  }

  // 3. If accessing a protected route without valid session
  if (isProtectedPath(pathname)) {
    if (!session) {
      return {
        allowed: false,
        redirectUrl: createLoginRedirectUrl(pathname),
        reason: 'UNAUTHENTICATED'
      };
    }

    if (isExpired) {
      return {
        allowed: false,
        redirectUrl: createLoginRedirectUrl(pathname),
        reason: 'EXPIRED'
      };
    }

    // Role check: Only shop_owner and admin are permitted
    const role: UserRole =
      profile?.role ??
      (session.user.user_metadata?.['role'] as UserRole | undefined) ??
      (session.user.app_metadata?.['role'] as UserRole | undefined) ??
      'shop_owner';

    if (role === 'customer') {
      return {
        allowed: false,
        redirectUrl: null,
        reason: 'ROLE_MISMATCH'
      };
    }

    // Tenant / Shop isolation check
    if (targetShopId && userShopIds && userShopIds.length > 0) {
      const isAdmin = role === 'admin';
      const ownsShop = userShopIds.includes(targetShopId);

      if (!isAdmin && !ownsShop) {
        return {
          allowed: false,
          redirectUrl: null,
          reason: 'CROSS_SHOP_FORBIDDEN'
        };
      }
    }

    return {
      allowed: true,
      redirectUrl: null,
      reason: 'AUTHENTICATED'
    };
  }

  // Unrecognized route defaults to allowed unless specified
  return {
    allowed: true,
    redirectUrl: null,
    reason: 'PUBLIC_ROUTE'
  };
}
