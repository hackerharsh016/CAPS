'use client';

/**
 * Accessible Push Notification Status & Disconnect Banner for CAPS Customer Web.
 * Conforms to CAPS SRS Section 4.5 & Master Plan Phase 6.
 * Surfaces permission opt-in, permission-denied fallback guidance,
 * and offline network disconnect warnings.
 */

import React, { useState } from 'react';
import { usePushNotifications } from '../use-push-notifications';

export function PushStatusBanner() {
  const { permission, isSubscribed, isLoading, isOnline, error, requestPermissionAndSubscribe } =
    usePushNotifications();

  const [isDismissed, setIsDismissed] = useState(false);

  // 1. Disconnect UX: Offline alert takes highest priority
  if (!isOnline) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="w-full rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm"
      >
        <div className="flex items-center space-x-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-bold">Network Disconnected — You are Offline</p>
            <p className="text-xs text-amber-800 mt-0.5">
              Live printer queue and order status updates are paused. They will automatically
              reconnect and reconcile when your internet connection is restored.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isDismissed) return null;

  // 2. Permission Denied Fallback UX
  if (permission === 'denied') {
    return (
      <div
        role="region"
        aria-label="Push notifications blocked"
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-slate-800 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <span className="text-lg">🔕</span>
            <div>
              <p className="text-xs font-bold text-slate-900">
                Push Notifications are Blocked by Browser Settings
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                To receive instant pickup alerts, enable notifications in your browser&apos;s site
                permissions. In-app order tracking remains active below.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            aria-label="Dismiss notification settings notice"
            className="text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  // 3. Permission Default: Opt-in Prompt Banner
  if (permission === 'default' && !isSubscribed) {
    return (
      <div
        role="region"
        aria-label="Push notifications opt-in prompt"
        className="w-full rounded-2xl border border-blue-200 bg-blue-50/80 p-4 text-blue-950 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start space-x-3">
            <span className="text-xl">🔔</span>
            <div>
              <p className="text-sm font-bold text-blue-900">Get Instant Order & Pickup Alerts</p>
              <p className="text-xs text-blue-800/90 mt-0.5 max-w-xl">
                Enable push notifications to know immediately when your print job is queued,
                printing, and ready for counter pickup at the photocopy shop.
              </p>
              {error && <p className="text-xs font-medium text-red-600 mt-1">{error}</p>}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={isLoading}
              onClick={requestPermissionAndSubscribe}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? 'Enabling...' : 'Enable Notifications'}
            </button>
            <button
              type="button"
              onClick={() => setIsDismissed(true)}
              className="text-xs font-semibold text-blue-800 hover:text-blue-950 px-2 py-1"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Already Subscribed Status Badge
  if (isSubscribed) {
    return (
      <div
        role="status"
        aria-label="Push notifications status"
        className="inline-flex items-center space-x-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200"
      >
        <span>✓</span>
        <span>Push Notifications Active</span>
      </div>
    );
  }

  return null;
}
