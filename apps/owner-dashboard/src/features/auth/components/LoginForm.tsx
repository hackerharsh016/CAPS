'use client';

/**
 * Accessible Owner Login Form Component for CAPS Shop Owner Dashboard.
 * Includes role-based validation, error displays, and redirect support.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../auth-context';
import { isAuthPath } from '../route-guard-utils';

export interface LoginFormProps {
  redirectUrl?: string | undefined;
  onSuccess?: () => void;
}

export function LoginForm({ redirectUrl = '/', onSuccess }: LoginFormProps) {
  const { signInWithPassword, isLoading } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (): boolean => {
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }

    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await signInWithPassword({
        email: email.trim(),
        password
      });

      if (onSuccess) {
        onSuccess();
      } else if (typeof window !== 'undefined') {
        const dest =
          redirectUrl && redirectUrl.startsWith('/') && !isAuthPath(redirectUrl)
            ? redirectUrl
            : '/';
        window.location.href = dest;
      }
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string };
      if (errorObj.code === 'ROLE_NOT_AUTHORIZED') {
        setFormError(
          'Access Denied: This account has a Customer role. The Owner Dashboard requires a Shop Owner or Admin account.'
        );
      } else {
        setFormError(errorObj.message || 'Login failed. Please check your credentials.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Owner Portal Login</h1>
        <p className="mt-1 text-xs text-slate-500">
          Manage your printing queue, hardware, and shop configuration
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800"
        >
          <div className="flex items-center space-x-2">
            <svg
              className="h-4 w-4 text-rose-500 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{formError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label htmlFor="owner-email" className="block text-xs font-semibold text-slate-700">
            Email Address
          </label>
          <input
            id="owner-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={isSubmitting || isLoading}
            autoComplete="email"
            aria-required="true"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            placeholder="owner@shopname.com"
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 ${
              fieldErrors.email
                ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
            }`}
          />
          {fieldErrors.email && (
            <p id="email-error" role="alert" className="mt-1 text-xs text-rose-600">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="owner-password" className="block text-xs font-semibold text-slate-700">
              Password
            </label>
          </div>
          <input
            id="owner-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={isSubmitting || isLoading}
            autoComplete="current-password"
            aria-required="true"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            placeholder="••••••••"
            className={`mt-1 block w-full rounded-lg border px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 ${
              fieldErrors.password
                ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                : 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200'
            }`}
          />
          {fieldErrors.password && (
            <p id="password-error" role="alert" className="mt-1 text-xs text-rose-600">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting || isLoading}
          className="mt-6 flex w-full items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (
            <div className="flex items-center space-x-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Verifying credentials...</span>
            </div>
          ) : (
            'Sign In to Dashboard'
          )}
        </button>
      </form>

      <div className="mt-6 flex flex-col items-center justify-center gap-3 border-t border-slate-100 pt-4 text-xs">
        <div className="flex items-center space-x-1 text-slate-500">
          <span>New shop owner?</span>
          <Link href="/register" className="font-semibold text-emerald-600 hover:underline">
            Register your print shop
          </Link>
        </div>
      </div>
    </div>
  );
}
