'use client';

/**
 * Accessible Password Reset Form for CAPS Customer Web.
 * Sends a password recovery link to the customer's verified email.
 */

import React, { useState } from 'react';
import { validateEmail } from '../validation';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const err = validateEmail(email);
    if (err) {
      setEmailError(err);
      return;
    }

    setEmailError(null);
    setIsSubmitting(true);

    try {
      // Send reset request via mock/auth client
      // Simulate network request with timeout handling
      await new Promise(resolve => setTimeout(resolve, 600));
      setIsSubmitted(true);
    } catch {
      setFormError('Failed to send recovery email. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold text-xl">
          ✉
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Check your email</h2>
        <p className="mt-2 text-sm text-slate-600">
          If an account exists for <span className="font-semibold text-slate-800">{email}</span>, we
          have sent instructions to reset your password.
        </p>
        <div className="mt-6">
          <a
            href="/login"
            className="block w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 text-center"
          >
            Back to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Reset your password</h2>
        <p className="mt-2 text-sm text-slate-600">
          Enter your registered email address and we will send you a recovery link.
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          id="forgot-form-error"
          className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200"
        >
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label htmlFor="forgot-email" className="block text-sm font-medium text-slate-700">
            Email Address
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-required="true"
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'forgot-email-error' : undefined}
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
            className={`mt-1 block w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
              emailError
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
            }`}
            placeholder="you@example.com"
          />
          {emailError && (
            <p id="forgot-email-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {emailError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
        >
          {isSubmitting ? 'Sending...' : 'Send Recovery Link'}
        </button>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-4 text-center">
        <a href="/login" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          ← Back to Sign In
        </a>
      </div>
    </div>
  );
}
