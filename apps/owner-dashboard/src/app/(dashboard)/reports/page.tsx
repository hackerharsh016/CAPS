'use client';

/**
 * Owner Sales and Operations Reports Page (P05-M05-F01).
 * Accessible at `/reports`, protected by RouteGuard and scoped to the active shop.
 */

import React from 'react';
import { RouteGuard } from '../../../features/auth/RouteGuard';
import { ReportsView } from '../../../features/revenue-analytics';

export default function ReportsPage() {
  return (
    <RouteGuard>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ReportsView />
      </div>
    </RouteGuard>
  );
}
