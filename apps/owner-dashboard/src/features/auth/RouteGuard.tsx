'use client';

/**
 * Client Route Guard Component for CAPS Shop Owner Dashboard.
 * Enforces role guards and redirects unauthorized or unauthenticated sessions.
 */

import React, { useEffect } from 'react';
import { useAuth } from './auth-context';
import type { RouteGuardProps } from './types';

export function RouteGuard({ children, requiredRole = 'shop_owner', fallback }: RouteGuardProps) {
  const { status, profile, isLoading, signOut } = useAuth();

  useEffect(() => {
    if (!isLoading && status === 'unauthenticated' && typeof window !== 'undefined') {
      const currentPath = window.location.pathname;
      if (currentPath !== '/login') {
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      }
    }
  }, [isLoading, status]);

  if (isLoading) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center space-y-4"
        role="status"
        aria-label="Loading session"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
        <p className="text-sm font-medium text-slate-600">Verifying owner credentials...</p>
      </div>
    );
  }

  // Forbidden state: e.g. user logged in as customer
  if (status === 'forbidden' || (profile && profile.role === 'customer')) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div
          className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 shadow-sm text-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">Owner Access Required</h2>
          <p className="mt-2 text-sm text-slate-600">
            You are logged in with a <strong>Customer</strong> account ({profile?.email ?? 'user'}).
            The Owner Dashboard requires a registered <strong>Shop Owner</strong> or Admin account.
          </p>
          <div className="mt-6 flex flex-col space-y-2">
            <button
              onClick={() => signOut()}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              Sign Out & Switch Account
            </button>
            <a
              href="http://localhost:3000"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Go to Customer App
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated: render placeholder while redirect effect runs
  if (status === 'unauthenticated') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-2">
        <p className="text-sm text-slate-500">Redirecting to login...</p>
      </div>
    );
  }

  // Check required role if specified (e.g., admin only)
  if (requiredRole === 'admin' && profile?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md p-6 text-center" role="alert">
        <p className="text-sm font-semibold text-rose-600">Administrator role required.</p>
      </div>
    );
  }

  return <>{children}</>;
}
