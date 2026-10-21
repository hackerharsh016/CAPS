'use client';

/**
 * NotificationPermissionBanner Component.
 * Opt-in prompt banner for shop owners:
 * - Appears when permission is 'default'
 * - Displays actionable button to enable browser notifications
 * - Provides instructions if permission is 'denied'
 * - Dismissable and accessible
 */

import React, { useState } from 'react';
import type { PushPermissionStatus } from '../types';

export interface NotificationPermissionBannerProps {
  permission: PushPermissionStatus;
  isSupported: boolean;
  isLoading: boolean;
  onEnable: () => Promise<boolean>;
}

export function NotificationPermissionBanner({
  permission,
  isSupported,
  isLoading,
  onEnable
}: NotificationPermissionBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed || !isSupported || permission === 'granted') {
    return null;
  }

  const isDenied = permission === 'denied';

  return (
    <aside
      className={`rounded-xl border p-4 shadow-sm transition-all ${
        isDenied
          ? 'border-amber-200 bg-amber-50/80 text-amber-900'
          : 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
      }`}
      role="region"
      aria-label="Notification Permission Banner"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start space-x-3">
          <span className="text-xl" aria-hidden="true">
            {isDenied ? '🔕' : '🔔'}
          </span>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider">
              {isDenied
                ? 'Desktop Notifications Blocked'
                : 'Enable Instant Queue & Hardware Alerts'}
            </h4>
            <p className="mt-1 text-xs text-slate-700 leading-relaxed font-medium">
              {isDenied
                ? 'Your browser has blocked push notifications for this site. To receive instant audio/visual alerts when urgent jobs arrive or paper jams occur, enable notifications in your browser settings (click lock icon in URL bar).'
                : 'Stay on top of your shop queue: receive instant real-time desktop notifications for incoming urgent priority jobs, paper jams, and printer offline errors.'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-end sm:self-auto shrink-0">
          {!isDenied && (
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void onEnable()}
              className="inline-flex items-center space-x-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            >
              {isLoading && (
                <svg
                  className="h-3 w-3 animate-spin text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              <span>Enable Notifications</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none"
            aria-label="Dismiss notification alert"
          >
            {isDenied ? 'Dismiss' : 'Later'}
          </button>
        </div>
      </div>
    </aside>
  );
}
