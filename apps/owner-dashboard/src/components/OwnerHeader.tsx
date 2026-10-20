'use client';

/**
 * Owner Dashboard Navigation Header.
 * Displays shop switcher, online badge, current owner profile, and sign-out button.
 */

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../features/auth/auth-context';
import { ShopSelector } from '../features/shop-management/ShopSelector';
import { isAuthPath } from '../features/auth/route-guard-utils';

export function OwnerHeader() {
  const pathname = usePathname();
  const { isAuthenticated, profile, signOut } = useAuth();

  // Hide dashboard navigation on auth routes
  if (isAuthPath(pathname)) {
    return null;
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center space-x-4">
          <Link href="/" className="flex items-center space-x-2">
            <span className="rounded-lg bg-emerald-600 px-2.5 py-1 font-mono text-sm font-bold text-white">
              CAPS
            </span>
            <span className="text-base font-bold text-slate-900">Owner Portal</span>
          </Link>

          {isAuthenticated && (
            <div className="border-l border-slate-200 pl-4">
              <ShopSelector />
            </div>
          )}
        </div>

        {isAuthenticated && (
          <div className="flex items-center space-x-6 text-sm font-medium text-slate-600">
            <nav className="hidden md:flex items-center space-x-4" aria-label="Dashboard navigation">
              <Link
                href="/"
                className={`transition-colors ${
                  pathname === '/' ? 'text-emerald-700 font-bold' : 'hover:text-slate-900'
                }`}
              >
                Live Queue
              </Link>
              <Link
                href="/printers"
                className={`transition-colors ${
                  pathname === '/printers' ? 'text-emerald-700 font-bold' : 'hover:text-slate-900'
                }`}
              >
                Printers
              </Link>
              <Link
                href="/pricing"
                className={`transition-colors ${
                  pathname === '/pricing' ? 'text-emerald-700 font-bold' : 'hover:text-slate-900'
                }`}
              >
                Pricing
              </Link>
              <Link
                href="/reports"
                className={`transition-colors ${
                  pathname === '/reports' ? 'text-emerald-700 font-bold' : 'hover:text-slate-900'
                }`}
              >
                Reports
              </Link>
              <Link
                href="/settings"
                className={`transition-colors ${
                  pathname === '/settings' ? 'text-emerald-700 font-bold' : 'hover:text-slate-900'
                }`}
              >
                Settings
              </Link>
            </nav>

            <div className="flex items-center space-x-3 border-l border-slate-200 pl-4">
              <span className="text-xs font-semibold text-slate-700">
                {profile?.name ?? 'Shop Owner'}
              </span>
              <button
                onClick={() => signOut()}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Sign out of owner dashboard"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
