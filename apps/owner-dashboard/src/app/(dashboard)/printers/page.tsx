'use client';

/**
 * Printers Management Page for CAPS Shop Owner Dashboard.
 * Accessible via `/printers` and protected by RouteGuard.
 */

import React from 'react';
import { RouteGuard } from '../../../features/auth/RouteGuard';
import { PrintersManagementView } from '../../../features/printer-management/components/PrintersManagementView';
import { useShop } from '../../../features/shop-management/shop-context';

function PrintersPageContent() {
  const { activeShop } = useShop();
  return <PrintersManagementView shopId={activeShop?.id} />;
}

export default function PrintersPage() {
  return (
    <RouteGuard>
      <PrintersPageContent />
    </RouteGuard>
  );
}
