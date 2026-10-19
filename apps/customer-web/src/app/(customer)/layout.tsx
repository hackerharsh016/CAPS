'use client';

/**
 * Customer layout wrapping authenticated customer portal views with RouteGuard.
 */

import React from 'react';
import { RouteGuard } from '../../features/auth/route-guard';

export default function CustomerPortalLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteGuard requiredRole="customer">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </div>
    </RouteGuard>
  );
}
