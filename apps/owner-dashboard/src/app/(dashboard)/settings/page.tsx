'use client';

/**
 * Shop Operations & Operational Settings Page for CAPS Shop Owner Dashboard.
 * Protected by RouteGuard.
 */

import React from 'react';
import { RouteGuard } from '../../../features/auth/RouteGuard';
import { PricingManagementView } from '../../../features/pricing-management/components/PricingManagementView';

export default function SettingsPage() {
  return (
    <RouteGuard>
      <PricingManagementView showSettingsOnly={true} />
    </RouteGuard>
  );
}
