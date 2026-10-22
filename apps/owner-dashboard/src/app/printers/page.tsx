'use client';

/**
 * Owner Dashboard Printers Management & Hardware Alerting Page (INT-D2-04).
 * Accessible via `/printers` route.
 */

import React from 'react';
import { RouteGuard } from '../../features/auth/RouteGuard';
import { useShop } from '../../features/shop-management/shop-context';
import { PrinterStatusPanel } from '../../components/printers/printer-status-panel';

function PrintersPageContent() {
  let shopId = 'default-shop';
  try {
    const { activeShop } = useShop();
    if (activeShop?.id) {
      shopId = activeShop.id;
    }
  } catch {
    // Rendered outside of ShopProvider (e.g. standalone preview or test)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PrinterStatusPanel shopId={shopId} />
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
