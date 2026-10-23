'use client';

/**
 * Accessible Customer Login Form for CAPS.
 * Supports email/password authentication and phone OTP sign-in with full error handling
 * and destination redirect preservation.
 */

import React, { useState, useCallback } from 'react';
import { useAuth } from '../auth-context';
import {
  validateEmail,
  validatePassword,
  validatePhone,
  validateOtp,
  normalizePhone,
  type FormFieldErrors
} from '../validation';
import type { AuthError } from '../types';

export interface LoginFormProps {
  redirectTo?: string | undefined;
  onSuccess?: (() => void) | undefined;
}

export type LoginMode = 'password' | 'otp';
export type OtpStep = 'request' | 'verify';

export function LoginForm({ redirectTo = '/orders', onSuccess }: LoginFormProps) {
  const { signInWithPassword, signInWithOtp, verifyOtp } = useAuth();

  const [mode, setMode] = useState<LoginMode>('password');
  const [otpStep, setOtpStep] = useState<OtpStep>('request');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [otpSentMessage, setOtpSentMessage] = useState<string | null>(null);

  const translateAuthError = (err: unknown): string => {
    const authErr = err as AuthError;
    if (authErr?.status === 429 || authErr?.code === 'RATE_LIMIT_EXCEEDED') {
      return 'Too many login attempts. Please wait a few moments before trying again.';
    }
    if (authErr?.code === 'INVALID_OTP') {
      return 'The verification code you entered is invalid or has expired.';
    }
    if (authErr?.status === 400 || authErr?.code === 'INVALID_CREDENTIALS') {
      return 'Invalid email or password. Please check your details and try again.';
    }
    if (
      authErr?.message?.toLowerCase().includes('timeout') ||
      authErr?.message?.toLowerCase().includes('network')
    ) {
      return 'Connection timed out. Please check your network connection and retry.';
    }
    return authErr?.message || 'Failed to sign in. Please try again.';
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);

    if (emailErr || passErr) {
      setFieldErrors({
        ...(emailErr ? { email: emailErr } : {}),
        ...(passErr ? { password: passErr } : {})
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await signInWithPassword({ email: email.trim(), password });
      if (onSuccess) {
        onSuccess();
      } else if (typeof window !== 'undefined') {
        window.location.href = redirectTo;
      }
    } catch (err) {
      setFormError(translateAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const phoneErr = validatePhone(phone);
    if (phoneErr) {
      setFieldErrors({ phone: phoneErr });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const normalized = normalizePhone(phone);
      const res = await signInWithOtp({ phone: normalized });
      setOtpSentMessage(res.message || `Code sent to ${normalized}`);
      setOtpStep('verify');
    } catch (err) {
      setFormError(translateAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const otpErr = validateOtp(otp);
    if (otpErr) {
      setFieldErrors({ otp: otpErr });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const normalized = normalizePhone(phone);
      await verifyOtp({
        phone: normalized,
        token: otp.trim(),
        type: 'sms'
      });
      if (onSuccess) {
        onSuccess();
      } else if (typeof window !== 'undefined') {
        window.location.href = redirectTo;
      }
    } catch (err) {
      setFormError(translateAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = useCallback((newMode: LoginMode) => {
    setMode(newMode);
    setFormError(null);
    setFieldErrors({});
    setOtpStep('request');
    setOtpSentMessage(null);
  }, []);

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 sm:p-8 shadow-xs">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign in to access your print jobs, orders, and saved files
        </p>
      </div>

      {/* Auth Mode Tabs */}
      <div
        role="tablist"
        aria-label="Login Methods"
        className="mt-6 flex rounded-lg bg-slate-100 p-1 text-sm font-medium"
      >
        <button
          type="button"
          role="tab"
          id="tab-password"
          aria-selected={mode === 'password'}
          aria-controls="panel-password"
          onClick={() => switchMode('password')}
          className={`flex-1 rounded-md py-2 text-center transition-colors ${
            mode === 'password'
              ? 'bg-white font-semibold text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Email & Password
        </button>
        <button
          type="button"
          role="tab"
          id="tab-otp"
          aria-selected={mode === 'otp'}
          aria-controls="panel-otp"
          onClick={() => switchMode('otp')}
          className={`flex-1 rounded-md py-2 text-center transition-colors ${
            mode === 'otp'
              ? 'bg-white font-semibold text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Mobile OTP
        </button>
      </div>

      {/* Global Error Banner */}
      {formError && (
        <div
          role="alert"
          id="login-form-error"
          className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200"
        >
          <div className="flex">
            <span className="font-semibold mr-1.5">Error:</span>
            <span>{formError}</span>
          </div>
        </div>
      )}

      {/* Global Success / Notice Banner */}
      {otpSentMessage && mode === 'otp' && (
        <div
          role="status"
          id="login-form-notice"
          className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200"
        >
          {otpSentMessage}
        </div>
      )}

      {/* Password Mode Panel */}
      {mode === 'password' && (
        <form
          id="panel-password"
          role="tabpanel"
          aria-labelledby="tab-password"
          onSubmit={handlePasswordSubmit}
          className="mt-6 space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
              Email Address
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
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
              placeholder="you@example.com"
            />
            {fieldErrors.email && (
              <p id="login-email-error" role="alert" className="mt-1.5 text-xs text-red-600">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <a
                href="/forgot-password"
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Forgot password?
              </a>
            </div>
            <div className="relative mt-1">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
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
            {fieldErrors.password && (
              <p id="login-password-error" role="alert" className="mt-1.5 text-xs text-red-600">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
          >
            {isSubmitting ? 'Signing in...' : 'Sign in with Password'}
          </button>
        </form>
      )}

      {/* OTP Mode Panel */}
      {mode === 'otp' && (
        <div id="panel-otp" role="tabpanel" aria-labelledby="tab-otp" className="mt-6">
          {otpStep === 'request' ? (
            <form onSubmit={handleRequestOtp} className="space-y-4" noValidate>
              <div>
                <label htmlFor="login-phone" className="block text-sm font-medium text-slate-700">
                  Mobile Number
                </label>
                <div className="relative mt-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-sm font-medium text-slate-500">
                    +91
                  </span>
                  <input
                    id="login-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    aria-required="true"
                    aria-invalid={!!fieldErrors.phone}
                    aria-describedby={fieldErrors.phone ? 'login-phone-error' : undefined}
                    value={phone}
                    onChange={e => {
                      setPhone(e.target.value);
                      if (fieldErrors.phone)
                        setFieldErrors(prev => ({ ...prev, phone: undefined }));
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
                  <p id="login-phone-error" role="alert" className="mt-1.5 text-xs text-red-600">
                    {fieldErrors.phone}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
              >
                {isSubmitting ? 'Sending OTP...' : 'Send Verification Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4" noValidate>
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="login-otp" className="block text-sm font-medium text-slate-700">
                    Enter 6-Digit Code
                  </label>
                  <button
                    type="button"
                    onClick={() => setOtpStep('request')}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Change phone
                  </button>
                </div>
                <input
                  id="login-otp"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  aria-required="true"
                  aria-invalid={!!fieldErrors.otp}
                  aria-describedby={fieldErrors.otp ? 'login-otp-error' : undefined}
                  value={otp}
                  onChange={e => {
                    setOtp(e.target.value);
                    if (fieldErrors.otp) setFieldErrors(prev => ({ ...prev, otp: undefined }));
                  }}
                  className={`mt-1 block w-full rounded-lg border px-3.5 py-2.5 text-center font-mono text-lg tracking-widest shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                    fieldErrors.otp
                      ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                      : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
                  }`}
                  placeholder="123456"
                />
                {fieldErrors.otp && (
                  <p id="login-otp-error" role="alert" className="mt-1.5 text-xs text-red-600">
                    {fieldErrors.otp}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-blue-300"
              >
                {isSubmitting ? 'Verifying...' : 'Verify Code & Sign In'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Switch to Register */}
      <div className="mt-6 border-t border-slate-200 pt-4 text-center">
        <p className="text-sm text-slate-600">
          New to CAPS?{' '}
          <a href="/register" className="font-semibold text-blue-600 hover:text-blue-700">
            Create an account
          </a>
        </p>
      </div>
    </div>
  );
}
