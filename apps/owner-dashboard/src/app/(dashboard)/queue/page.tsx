'use client';

/**
 * Live Queue Page for CAPS Shop Owner Dashboard.
 * Protected by RouteGuard.
 */

import React from 'react';
import { RouteGuard } from '../../../features/auth/RouteGuard';
import { LiveQueueView } from '../../../features/live-queue/components/LiveQueueView';

export default function QueuePage() {
  return (
    <RouteGuard>
      <LiveQueueView />
    </RouteGuard>
  );
}
