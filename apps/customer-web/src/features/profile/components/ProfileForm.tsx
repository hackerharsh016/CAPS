'use client';

/**
 * Accessible Customer Profile editing and account summary component for CAPS.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/auth-context';
import { defaultProfileService } from '../profile-service';
import type { ProfileStats, ProfileUpdateInput } from '../types';
import { formatPaiseToInr } from '../../orders/orders-service';

export function ProfileForm() {
  const { user, profile, signOut } = useAuth();

  const [name, setName] = useState(profile?.name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [preferredNotification, setPreferredNotification] = useState<'sms' | 'whatsapp' | 'email'>(
    'sms'
  );

  const [fieldErrors, setFieldErrors] = useState<{
    name?: string | undefined;
    phone?: string | undefined;
  }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [stats, setStats] = useState<ProfileStats | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setPhone(profile.phone);
    }
  }, [profile]);

  useEffect(() => {
    if (user?.id) {
      defaultProfileService
        .getCustomerStats(user.id, user.created_at)
        .then(setStats)
        .catch(console.error);
    }
  }, [user?.id, user?.created_at]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);

    const input: ProfileUpdateInput = {
      name,
      phone,
      preferredNotification
    };

    const errors = defaultProfileService.validateProfileInput(input);
    if (errors) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setIsSaving(true);

    try {
      const normalized = defaultProfileService.normalizeInput(input);
      // Simulate profile update via customer API/Supabase user metadata
      await new Promise(resolve => setTimeout(resolve, 500));
      setName(normalized.name);
      setPhone(normalized.phone);
      setSaveSuccess(true);
    } catch {
      setSaveError('Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    if (window.confirm('Are you sure you want to sign out of your CAPS account?')) {
      await signOut();
      window.location.href = '/login';
    }
  };

  return (
    <div className="w-full max-w-3xl space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Customer Profile & Account
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage your contact details, notification preferences, and review your account activity.
        </p>
      </div>

      {/* Account Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Total Orders
            </p>
            <p className="mt-2 text-2xl font-extrabold text-blue-600">{stats.totalOrders}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Completed</p>
            <p className="mt-2 text-2xl font-extrabold text-emerald-600">{stats.completedOrders}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Total Printed
            </p>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">
              {formatPaiseToInr(stats.totalSpentPaise)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Member Since
            </p>
            <p className="mt-2 text-xl font-bold text-slate-700">{stats.memberSince}</p>
          </div>
        </div>
      )}

      {/* Profile Form Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-3">
          Personal Information
        </h2>

        {saveSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200"
          >
            ✓ Profile updated successfully!
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 border border-red-200"
          >
            {saveError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
          {/* Email (Read-Only) */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="profile-email" className="block text-sm font-medium text-slate-700">
                Email Address
              </label>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                ✓ Verified
              </span>
            </div>
            <input
              id="profile-email"
              type="email"
              disabled
              value={user?.email || ''}
              className="mt-1 block w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500 shadow-sm cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-slate-400">
              Email is managed by your authentication provider and cannot be modified directly.
            </p>
          </div>

          {/* Full Name */}
          <div>
            <label htmlFor="profile-name" className="block text-sm font-medium text-slate-700">
              Full Name
            </label>
            <input
              id="profile-name"
              name="name"
              type="text"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? 'profile-name-error' : undefined}
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
            />
            {fieldErrors.name && (
              <p id="profile-name-error" role="alert" className="mt-1.5 text-xs text-red-600">
                {fieldErrors.name}
              </p>
            )}
          </div>

          {/* Mobile Number */}
          <div>
            <label htmlFor="profile-phone" className="block text-sm font-medium text-slate-700">
              Mobile Number (for pickup OTP and SMS alerts)
            </label>
            <input
              id="profile-phone"
              name="phone"
              type="tel"
              required
              aria-required="true"
              aria-invalid={!!fieldErrors.phone}
              aria-describedby={fieldErrors.phone ? 'profile-phone-error' : undefined}
              value={phone}
              onChange={e => {
                setPhone(e.target.value);
                if (fieldErrors.phone) setFieldErrors(prev => ({ ...prev, phone: undefined }));
              }}
              className={`mt-1 block w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus:outline-none focus:ring-2 ${
                fieldErrors.phone
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-300 focus:border-blue-500 focus:ring-blue-200'
              }`}
              placeholder="+919876543210"
            />
            {fieldErrors.phone && (
              <p id="profile-phone-error" role="alert" className="mt-1.5 text-xs text-red-600">
                {fieldErrors.phone}
              </p>
            )}
          </div>

          {/* Preferred Notification Channel */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Preferred Order Ready Notification
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { id: 'sms', label: '📱 SMS Alert', desc: 'Standard cellular message' },
                { id: 'whatsapp', label: '💬 WhatsApp', desc: 'Instant chat notification' },
                { id: 'email', label: '📧 Email Receipt', desc: 'Detailed PDF invoice' }
              ].map(opt => (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer flex-col rounded-lg border p-3.5 transition-colors ${
                    preferredNotification === opt.id
                      ? 'border-blue-600 bg-blue-50/50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <input
                      type="radio"
                      name="preferredNotification"
                      value={opt.id}
                      checked={preferredNotification === opt.id}
                      onChange={() =>
                        setPreferredNotification(opt.id as typeof preferredNotification)
                      }
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-semibold text-slate-900">{opt.label}</span>
                  </div>
                  <span className="mt-1 text-xs text-slate-500 pl-6">{opt.desc}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-5">
            <button
              type="submit"
              disabled={isSaving}
              aria-busy={isSaving}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-300"
            >
              {isSaving ? 'Saving changes...' : 'Save Changes'}
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
