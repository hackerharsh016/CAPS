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

  if (!activeShop) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
        <h3 className="text-base font-bold text-slate-900">No Active Print Shop</h3>
        <p className="mt-1 text-sm text-slate-500">
          Please register or select a print shop to manage printers and desktop agents.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PrinterStatusPanel shopId={activeShop.id} />
      <PrintersManagementView shopId={activeShop.id} />
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
