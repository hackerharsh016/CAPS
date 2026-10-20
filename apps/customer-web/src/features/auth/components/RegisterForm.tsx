'use client';

/**
 * Accessible Customer Registration Form for CAPS.
 * Collects name, email, phone number, and password with real-time validation,
 * customer role assignment, terms agreement, and redirect support.
 */

import React, { useState } from 'react';
import { useAuth } from '../auth-context';
import {
  validateName,
  validateEmail,
  validatePhone,
  validatePassword,
  validateConfirmPassword,
  normalizePhone,
  type FormFieldErrors
} from '../validation';
import type { AuthError } from '../types';

export interface RegisterFormProps {
  redirectTo?: string | undefined;
  onSuccess?: (() => void) | undefined;
}

export function RegisterForm({ redirectTo = '/orders', onSuccess }: RegisterFormProps) {
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const translateAuthError = (err: unknown): string => {
    const authErr = err as AuthError;
    if (authErr?.status === 429 || authErr?.code === 'RATE_LIMIT_EXCEEDED') {
      return 'Too many registration attempts. Please wait a few moments before trying again.';
    }
    if (authErr?.status === 400 && authErr?.message?.toLowerCase().includes('already registered')) {
      return 'An account with this email already exists. Please sign in instead.';
    }
    if (
      authErr?.message?.toLowerCase().includes('timeout') ||
      authErr?.message?.toLowerCase().includes('network')
    ) {
      return 'Connection timed out. Please check your network connection and retry.';
    }
    return authErr?.message || 'Failed to create your account. Please try again.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nameErr = validateName(name);
    const emailErr = validateEmail(email);
    const phoneErr = validatePhone(phone);
    const passErr = validatePassword(password);
    const confirmErr = validateConfirmPassword(password, confirmPassword);
    const termsErr = !agreeTerms ? 'You must agree to the Terms of Service to continue.' : null;

    if (nameErr || emailErr || phoneErr || passErr || confirmErr || termsErr) {
      setFieldErrors({
        ...(nameErr ? { name: nameErr } : {}),
        ...(emailErr ? { email: emailErr } : {}),
        ...(phoneErr ? { phone: phoneErr } : {}),
        ...(passErr ? { password: passErr } : {}),
        ...(confirmErr ? { confirmPassword: confirmErr } : {}),
        ...(termsErr ? { terms: termsErr } : {})
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const normalizedPhone = normalizePhone(phone);
      const res = await signUp({
        name: name.trim(),
        email: email.trim(),
        phone: normalizedPhone,
        password,
        role: 'customer'
      });

      if (res.session) {
        // Instant login established
        if (onSuccess) {
          onSuccess();
        } else if (typeof window !== 'undefined') {
          window.location.href = redirectTo;
        }
      } else {
        // Email verification required
        setSignupSuccess(true);
      }
    } catch (err) {
      setFormError(translateAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (signupSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 font-bold text-xl">
          ✓
        </div>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">Account Created!</h2>
        <p className="mt-2 text-sm text-slate-600">
          We have sent a confirmation link to{' '}
          <span className="font-semibold text-slate-800">{email}</span>. Please click the link in
          your email to verify your account and start printing.
        </p>
        <div className="mt-6">
          <a
            href="/login"
            className="block w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 text-center"
          >
            Go to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Create an account</h2>
        <p className="mt-2 text-sm text-slate-600">Get started with seamless zero-queue printing</p>
      </div>

      {formError && (
        <div
          role="alert"
          id="register-form-error"
          className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200"
        >
          <div className="flex">
            <span className="font-semibold mr-1.5">Error:</span>
            <span>{formError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        {/* Full Name */}
        <div>
          <label htmlFor="register-name" className="block text-sm font-medium text-slate-700">
            Full Name
          </label>
          <input
            id="register-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            aria-required="true"
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'register-name-error' : undefined}
            value={name}
            onChange={e => {
              setName(e.target.value);
              if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: undefined }));
            }}
            className={`mt-1 block w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
              fieldErrors.name
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
            }`}
            placeholder="Rahul Sharma"
          />
          {fieldErrors.name && (
            <p id="register-name-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldErrors.name}
            </p>
          )}
        </div>

        {/* Email Address */}
        <div>
          <label htmlFor="register-email" className="block text-sm font-medium text-slate-700">
            Email Address
          </label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-required="true"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'register-email-error' : undefined}
            value={email}
            onChange={e => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: undefined }));
            }}
            className={`mt-1 block w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
              fieldErrors.email
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
            }`}
            placeholder="rahul@example.com"
          />
          {fieldErrors.email && (
            <p id="register-email-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldErrors.email}
            </p>
          )}
        </div>

        {/* Mobile Number */}
        <div>
          <label htmlFor="register-phone" className="block text-sm font-medium text-slate-700">
            Mobile Number
          </label>
          <div className="relative mt-1">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-medium text-slate-500">
              +91
            </span>
            <input
              id="register-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.phone}
              aria-describedby={fieldErrors.phone ? 'register-phone-error' : undefined}
              value={phone}
              onChange={e => {
                setPhone(e.target.value);
                if (fieldErrors.phone) setFieldErrors(prev => ({ ...prev, phone: undefined }));
              }}
              className={`block w-full rounded-lg border py-2.5 pl-12 pr-3.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                fieldErrors.phone
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
              }`}
              placeholder="9876543210"
            />
          </div>
          {fieldErrors.phone && (
            <p id="register-phone-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldErrors.phone}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="register-password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative mt-1">
            <input
              id="register-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.password}
              aria-describedby={fieldErrors.password ? 'register-password-error' : 'password-hint'}
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (fieldErrors.password)
                  setFieldErrors(prev => ({ ...prev, password: undefined }));
              }}
              className={`block w-full rounded-lg border px-3.5 py-2.5 pr-10 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                fieldErrors.password
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
              }`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-slate-500 hover:text-slate-700"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <p id="password-hint" className="mt-1 text-xs text-slate-500">
            Must be at least 8 characters with at least one letter and one number.
          </p>
          {fieldErrors.password && (
            <p id="register-password-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="register-confirm-password"
            className="block text-sm font-medium text-slate-700"
          >
            Confirm Password
          </label>
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            aria-required="true"
            aria-invalid={!!fieldErrors.confirmPassword}
            aria-describedby={fieldErrors.confirmPassword ? 'register-confirm-error' : undefined}
            value={confirmPassword}
            onChange={e => {
              setConfirmPassword(e.target.value);
              if (fieldErrors.confirmPassword) {
                setFieldErrors(prev => ({ ...prev, confirmPassword: undefined }));
              }
            }}
            className={`mt-1 block w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
              fieldErrors.confirmPassword
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
            }`}
            placeholder="••••••••"
          />
          {fieldErrors.confirmPassword && (
            <p id="register-confirm-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldErrors.confirmPassword}
            </p>
          )}
        </div>

        {/* Terms Agreement */}
        <div className="pt-2">
          <div className="flex items-start">
            <input
              id="register-terms"
              name="terms"
              type="checkbox"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.terms}
              aria-describedby={fieldErrors.terms ? 'register-terms-error' : undefined}
              checked={agreeTerms}
              onChange={e => {
                setAgreeTerms(e.target.checked);
                if (fieldErrors.terms) setFieldErrors(prev => ({ ...prev, terms: undefined }));
              }}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="register-terms" className="ml-2.5 block text-xs text-slate-600">
              I agree to the{' '}
              <a href="/terms" className="font-medium text-blue-600 hover:text-blue-700 underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="/privacy"
                className="font-medium text-blue-600 hover:text-blue-700 underline"
              >
                Privacy Policy
              </a>
              . I understand my documents are encrypted and purged after printing.
            </label>
          </div>
          {fieldErrors.terms && (
            <p id="register-terms-error" role="alert" className="mt-1.5 text-xs text-red-600">
              {fieldErrors.terms}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="mt-4 w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
        >
          {isSubmitting ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      {/* Switch to Login */}
      <div className="mt-6 border-t border-slate-200 pt-4 text-center">
        <p className="text-sm text-slate-600">
          Already have an account?{' '}
          <a href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
