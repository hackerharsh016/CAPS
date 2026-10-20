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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
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
