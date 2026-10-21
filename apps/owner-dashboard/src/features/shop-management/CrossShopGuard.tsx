'use client';

/**
 * Cross-Shop Access Guard Component for CAPS Owner Dashboard.
 * Intercepts requests for specific shop IDs and strictly prevents
 * unauthorized cross-tenant data leaks.
 */

import React from 'react';
import { useShop } from './shop-context';
import { useAuth } from '../auth/auth-context';

export interface CrossShopGuardProps {
  children: React.ReactNode;
  targetShopId?: string | undefined;
  fallback?: React.ReactNode | undefined;
}

export function CrossShopGuard({ children, targetShopId, fallback }: CrossShopGuardProps) {
  const { isAuthorizedForShop, isLoading } = useShop();
  const { profile } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center" role="status" aria-label="Loading">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
        <span className="sr-only">Validating shop permissions...</span>
      </div>
    );
  }

  // If no targetShopId is supplied, allow through
  if (!targetShopId) {
    return <>{children}</>;
  }

  const isAuthorized = isAuthorizedForShop(targetShopId);

  if (!isAuthorized) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div className="mx-auto max-w-lg p-6 my-12" role="alert" aria-live="assertive">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <div className="flex items-start space-x-3">
            <div className="rounded-full bg-rose-100 p-2 text-rose-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-rose-900">Cross-Shop Access Prohibited</h2>
              <p className="mt-1 text-sm text-rose-700">
                You do not have administrative or operator privileges for shop ID{' '}
                <span className="font-mono font-semibold">{targetShopId}</span>.
              </p>
              <p className="mt-2 text-xs text-rose-600">
                Account: {profile?.name ?? 'Unknown'} ({profile?.role ?? 'None'})
              </p>
              <div className="mt-4">
                <a
                  href="/"
                  className="inline-flex items-center rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700"
                >
                  Return to Authorized Dashboard
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
