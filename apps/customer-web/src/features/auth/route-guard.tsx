'use client';

/**
 * Route Guard component for CAPS Customer Web.
 * Protects client-side views from unauthenticated or expired session access.
 */

import React, { useEffect } from 'react';
import { useAuth } from './auth-context';
import { resolveRouteAccess } from './route-guard-utils';
import type { RouteGuardProps } from './types';

export function RouteGuard({
  children,
  requiredRole,
  redirectTo,
  fallback
}: RouteGuardProps) {
  const { session, isLoading } = useAuth();

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  const access = resolveRouteAccess(pathname, session, requiredRole);

  useEffect(() => {
    if (!isLoading && !access.allowed) {
      const destination = redirectTo || access.redirectUrl || '/login';
      if (typeof window !== 'undefined') {
        window.location.href = destination;
      }
    }
  }, [isLoading, access.allowed, access.redirectUrl, redirectTo]);

  // Loading state
  if (isLoading) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-slate-500"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        <span className="mt-4 text-sm font-medium">Verifying authorization...</span>
      </div>
    );
  }

  // Not allowed: show redirecting placeholder while effect redirects
  if (!access.allowed) {
    return (
      <div
        role="alert"
        className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-slate-600"
      >
        <p className="text-sm font-medium">Redirecting to sign-in...</p>
      </div>
    );
  }

  return <>{children}</>;
}
