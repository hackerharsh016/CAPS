'use client';

/**
 * Main Owner Dashboard Home Page.
 * Displays real-time live queue, metrics, and print execution controls.
 */

import React from 'react';
import { RouteGuard } from '../features/auth/RouteGuard';
import { LiveQueueView } from '../features/live-queue/components/LiveQueueView';

export default function OwnerDashboardPage() {
  return (
    <RouteGuard>
      <LiveQueueView />
    </RouteGuard>
  );
}
