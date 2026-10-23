'use client';

/**
 * Responsive Navigation Bar for CAPS Customer Web.
 * Conforms to CAPS Customer Portal UX & Mobile Responsiveness specs.
 *
 * Features:
 * - Brand logo & Customer Portal link.
 * - Reactive authentication state with `useAuth()`.
 * - Prominent "Log In" & "Register" buttons when unauthenticated.
 * - Profile avatar/name greeting & "Sign Out" when authenticated.
 * - Fully accessible mobile hamburger drawer with tap-friendly touch targets.
 * - Mobile-first quick Login CTA in the top bar.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../features/auth/auth-context';

export function Navbar() {
  const { user, profile, isAuthenticated, isLoading, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const pathname = usePathname();

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      await signOut();
      setIsMobileMenuOpen(false);
      window.location.href = '/login';
    } catch (err) {
      console.error('Failed to sign out:', err);
    } finally {
      setIsSigningOut(false);
    }
  };

  const closeMenu = () => setIsMobileMenuOpen(false);

  const isActive = (path: string) => {
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  const displayName =
    profile?.name ||
    (typeof user?.user_metadata?.name === 'string' ? user.user_metadata.name : null) ||
    user?.email?.split('@')[0] ||
    'Customer';

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md shadow-xs">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-3.5 py-3 sm:px-6 sm:py-3.5 lg:px-8">
        {/* Brand / Logo */}
        <div className="flex items-center space-x-3">
          <Link
            href="/"
            onClick={closeMenu}
            className="flex items-center space-x-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg"
          >
            <span className="flex h-8 items-center rounded-lg bg-blue-600 px-2.5 font-mono text-sm font-black tracking-tight text-white shadow-xs">
              CAPS
            </span>
            <div className="flex flex-col">
              <span className="text-base font-bold text-slate-900 leading-tight">
                Customer Portal
              </span>
              <span className="hidden xs:inline-block text-[10px] font-medium text-slate-500 tracking-wide">
                Zero-Queue Printing
              </span>
            </div>
          </Link>
        </div>

        {/* Desktop Navigation Links */}
        <nav
          aria-label="Desktop primary navigation"
          className="hidden md:flex items-center space-x-1 lg:space-x-2 text-sm font-medium"
        >
          <Link
            href="/shops"
            className={`px-3 py-2 rounded-lg transition-colors ${
              isActive('/shops')
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Find Shops
          </Link>
          <Link
            href="/orders"
            className={`px-3 py-2 rounded-lg transition-colors ${
              isActive('/orders')
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            My Orders
          </Link>
        </nav>

        {/* Desktop Right Section: Auth State */}
        <div className="hidden md:flex items-center space-x-3">
          {isLoading ? (
            <div className="flex items-center space-x-2 animate-pulse">
              <div className="h-8 w-20 bg-slate-200 rounded-lg" />
            </div>
          ) : isAuthenticated ? (
            <div className="flex items-center space-x-3">
              <Link
                href="/profile"
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive('/profile')
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                <span className="max-w-[120px] truncate">{displayName}</span>
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {isSigningOut ? 'Signing out...' : 'Sign Out'}
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Link
                href="/login"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Log In
              </Link>
              <Link
                href="/register"
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Header Right Controls: Quick Login CTA + Hamburger Button */}
        <div className="flex items-center space-x-2 md:hidden">
          {!isLoading && !isAuthenticated && (
            <Link
              href="/login"
              onClick={closeMenu}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition-colors"
            >
              Log In
            </Link>
          )}

          {isAuthenticated && (
            <Link
              href="/profile"
              onClick={closeMenu}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 border border-blue-200"
              title="My Account"
            >
              {displayName.charAt(0).toUpperCase()}
            </Link>
          )}

          {/* Hamburger Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            {isMobileMenuOpen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Dropdown Menu */}
      {isMobileMenuOpen && (
        <div
          role="dialog"
          aria-label="Mobile navigation menu"
          className="border-t border-slate-200 bg-white px-4 py-4 md:hidden shadow-lg animate-in slide-in-from-top-2 duration-200"
        >
          {/* Navigation Links */}
          <div className="space-y-1">
            <Link
              href="/shops"
              onClick={closeMenu}
              className={`flex items-center space-x-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                isActive('/shops')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-lg">🏪</span>
              <span>Find Xerox Shops</span>
            </Link>

            <Link
              href="/orders"
              onClick={closeMenu}
              className={`flex items-center space-x-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                isActive('/orders')
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="text-lg">📄</span>
              <span>My Orders & Queue</span>
            </Link>

            {isAuthenticated && (
              <Link
                href="/profile"
                onClick={closeMenu}
                className={`flex items-center space-x-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                  isActive('/profile')
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="text-lg">👤</span>
                <span>Account Profile</span>
              </Link>
            )}
          </div>

          {/* User Status / Actions in Mobile Drawer */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            {isAuthenticated ? (
              <div className="space-y-3">
                <div className="flex items-center space-x-3 px-2 py-1">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 font-bold text-white text-sm">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{displayName}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email || 'Logged in'}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {isSigningOut ? 'Signing out...' : 'Sign Out'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Link
                  href="/login"
                  onClick={closeMenu}
                  className="block w-full rounded-xl bg-blue-600 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
                >
                  Log In
                </Link>
                <Link
                  href="/register"
                  onClick={closeMenu}
                  className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Create New Account
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
