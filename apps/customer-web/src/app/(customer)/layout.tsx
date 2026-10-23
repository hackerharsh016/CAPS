'use client';

/**
 * Customer layout wrapping customer portal views with RouteGuard,
 * push notification banner, and notification center controls.
 */

import React from 'react';
import { RouteGuard } from '../../features/auth/route-guard';
import { PushStatusBanner } from '../../features/notifications/components/PushStatusBanner';
import { NotificationCenter } from '../../features/notifications/components/NotificationCenter';

export default function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteGuard requiredRole="customer">
      <div className="mx-auto max-w-7xl px-3.5 py-4 sm:px-6 sm:py-8 space-y-4 sm:space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <PushStatusBanner />
          </div>
          <div className="shrink-0">
            <NotificationCenter />
          </div>
        </div>
        {children}
      </div>
    </RouteGuard>
  );
}
