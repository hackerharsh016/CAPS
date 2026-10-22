'use client';

/**
 * Printers Management Page for CAPS Shop Owner Dashboard.
 * Accessible via `/printers` and protected by RouteGuard.
 */

import React from 'react';
import { RouteGuard } from '../../../features/auth/RouteGuard';
import { PrintersManagementView } from '../../../features/printer-management/components/PrintersManagementView';
import { useShop } from '../../../features/shop-management/shop-context';
import { PrinterStatusPanel } from '../../../components/printers/printer-status-panel';

function PrintersPageContent() {
  const { activeShop } = useShop();
  return (
    <div className="space-y-8">
      <PrinterStatusPanel shopId={activeShop?.id || 'default-shop'} />
      <PrintersManagementView shopId={activeShop?.id} />
    </div>
  );
}

export default function PrintersPage() {
  return (
    <RouteGuard>
      <PrintersPageContent />
    </RouteGuard>
  );
}
