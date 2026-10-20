/**
 * Route protection and access resolution utilities for CAPS Customer Web.
 * Pure logic shared across Next.js Edge Middleware and Client Route Guards.
 *
 * Requirements:
 * - Public: /, /shops, /shops/:id, /help, /api/health
 * - Auth: /login, /register, /forgot-password
 * - Protected: /orders, /orders/:id, /profile, /print/*, /jobs/*, /settings
 */

import type { AuthSession, RouteAccessResult, UserRole } from './types';

export const PROTECTED_ROUTE_PREFIXES = ['/orders', '/profile', '/print', '/jobs', '/settings'];

export const AUTH_ROUTE_PREFIXES = ['/login', '/register', '/forgot-password', '/auth'];

export const PUBLIC_ROUTE_PREFIXES = ['/', '/shops', '/help', '/api/health'];

/**
 * Checks if a pathname requires authentication.
 */
export function isProtectedPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return PROTECTED_ROUTE_PREFIXES.some(
    prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

/**
 * Checks if a pathname is an auth route (login/signup/etc).
 */
export function isAuthPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return AUTH_ROUTE_PREFIXES.some(
    prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

/**
 * Checks if a pathname is publicly accessible without login.
 */
export function isPublicPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  if (normalized === '/' || normalized === '') {
    return true;
  }
  return PUBLIC_ROUTE_PREFIXES.some(
    prefix => prefix !== '/' && (normalized === prefix || normalized.startsWith(`${prefix}/`))
  );
}

/**
 * Builds a login redirect URL preserving the original target in a query param.
 */
export function createLoginRedirectUrl(currentPath: string, loginPath = '/login'): string {
  if (!currentPath || currentPath === '/' || isAuthPath(currentPath)) {
    return loginPath;
  }
  return `${loginPath}?redirect=${encodeURIComponent(currentPath)}`;
}

/**
 * Resolves whether a route access should be allowed, redirected, or blocked.
 */
export function resolveRouteAccess(
  pathname: string,
  session: AuthSession | null,
  requiredRole?: UserRole
): RouteAccessResult {
  const now = Math.floor(Date.now() / 1000);

  // Check if session exists and is not expired
  const isExpired = session ? session.expires_at <= now : false;
  const isAuthenticated = !!session && !isExpired;

  // 1. If accessing an auth page while already authenticated, redirect to /orders
  if (isAuthPath(pathname) && isAuthenticated) {
    return {
      allowed: false,
      redirectUrl: '/orders',
      reason: 'ALREADY_AUTHENTICATED'
    };
  }

  // 2. If it is an auth page or public page and not authenticated, allow access
  if (isAuthPath(pathname) || isPublicPath(pathname)) {
    return {
      allowed: true,
      redirectUrl: null,
      reason: 'PUBLIC_ROUTE'
    };
  }

  // 3. If accessing a protected route without session
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

    // Role check if requiredRole is specified
    if (requiredRole) {
      const userRole =
        session.user.user_metadata?.role || session.user.app_metadata?.role || 'customer'; // Default role is customer

      if (userRole !== requiredRole) {
        return {
          allowed: false,
          redirectUrl: '/unauthorized',
          reason: 'ROLE_MISMATCH'
        };
      }
    }

    return {
      allowed: true,
      redirectUrl: null,
      reason: 'AUTHENTICATED'
    };
  }

  // Fallback for unspecified routes
  return {
    allowed: true,
    redirectUrl: null,
    reason: 'PUBLIC_ROUTE'
  };
}
